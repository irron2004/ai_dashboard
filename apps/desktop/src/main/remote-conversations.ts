import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { parseSsh, sshExec, type SshTarget } from './ssh-exec.js'
import { parseRemoteFileBlocks, type RemoteFile } from './remote-docs.js'
import { ClaudeAdapter, CodexAdapter, OpenCodeAdapter, type AgentIngestAdapter } from '@apc/agents'

const DOC_MARKER = '@@APCDOC@@'
const END_MARKER = '@@APCEND@@'

// Remote python that exports ONLY this project's recent opencode sessions (+messages/parts/project)
// into a small /tmp/apc-oc-export/opencode.db. The full db is multi-GB, so we never fetch it whole;
// we filter by session.directory (the real cwd) so it matches the configured workspace folder. argv:
// [project-path, max-sessions]. Prints EXPORT_OK (ignored by the framed parser).
const OPENCODE_EXPORT_PY = `import sqlite3, os, sys
REPO = sys.argv[1]; N = int(sys.argv[2])
src = os.path.expanduser("~/.local/share/opencode/opencode.db")
con = sqlite3.connect("file:" + src + "?mode=ro", uri=True)
out_dir = "/tmp/apc-oc-export"; os.makedirs(out_dir, exist_ok=True)
out = out_dir + "/opencode.db"
try: os.remove(out)
except OSError: pass
dst = sqlite3.connect(out)
def ddl(t):
    r = con.execute("select sql from sqlite_master where type='table' and name=?", (t,)).fetchone()
    return r[0] if r else None
for t in ("project", "session", "message", "part"):
    d = ddl(t)
    if d: dst.execute(d)
sess = con.execute("select id, project_id from session where directory=? or directory like ? order by time_updated desc limit ?", (REPO, REPO + "/%", N)).fetchall()
sids = [s[0] for s in sess]; pids = sorted({s[1] for s in sess if s[1]})
def ins(table, rows):
    rows = list(rows)
    if not rows: return
    ph = ",".join(["?"] * len(rows[0]))
    dst.executemany("insert into " + table + " values (" + ph + ")", rows)
if pids:
    ph = ",".join(["?"] * len(pids)); ins("project", con.execute("select * from project where id in (" + ph + ")", pids))
if sids:
    ph = ",".join(["?"] * len(sids))
    ins("session", con.execute("select * from session where id in (" + ph + ")", sids))
    ins("message", con.execute("select * from message where session_id in (" + ph + ")", sids))
    ins("part", con.execute("select p.* from part p where p.message_id in (select id from message where session_id in (" + ph + "))", sids))
dst.commit(); dst.close()
print("EXPORT_OK", os.path.getsize(out), len(sids))`

/**
 * Run a bash script (via `bash -s` over stdin — bash-forced, quoting-safe) whose `listSnippet` prints
 * absolute file paths on stdout; fetch each file's RAW BYTES (base64-framed). Reused for every engine.
 */
async function fetchFiles(ssh: SshTarget, listSnippet: string): Promise<RemoteFile[]> {
  const script = [
    `emit() { printf '${DOC_MARKER}%s\\n' "$1"; base64 "$1" 2>/dev/null; printf '${END_MARKER}\\n'; }`,
    `( ${listSnippet} ) | while IFS= read -r f; do [ -f "$f" ] && emit "$f"; done`,
  ].join('\n')
  const res = await sshExec(ssh, 'bash -s', { stdin: script, timeoutMs: 120_000 })
  if (!res.ok) throw new Error(res.stderr?.trim() || `remote conversation fetch failed (exit ${res.exitCode ?? 'none'})`)
  return parseRemoteFileBlocks(res.stdout)
}

/** Build a small filtered opencode db on the remote (python) and fetch it. The real db is multi-GB,
 *  so we export only this project's recent sessions remotely and fetch the small result. */
async function fetchRemoteOpencode(ssh: SshTarget, maxSessions: number): Promise<RemoteFile[]> {
  const repo = ssh.path.replace(/'/g, `'\\''`)
  const script = [
    `emit() { printf '${DOC_MARKER}%s\\n' "$1"; base64 "$1" 2>/dev/null; printf '${END_MARKER}\\n'; }`,
    `command -v python3 >/dev/null 2>&1 || exit 0`,
    `python3 - '${repo}' ${maxSessions} <<'PYEOF'`,
    OPENCODE_EXPORT_PY,
    `PYEOF`,
    `[ -f /tmp/apc-oc-export/opencode.db ] && emit /tmp/apc-oc-export/opencode.db`,
    `rm -rf /tmp/apc-oc-export`,
  ].join('\n')
  const res = await sshExec(ssh, 'bash -s', { stdin: script, timeoutMs: 180_000 })
  if (!res.ok) throw new Error(res.stderr?.trim() || `remote opencode export failed (exit ${res.exitCode ?? 'none'})`)
  return parseRemoteFileBlocks(res.stdout)
}

/** Write fetched files under `<rootDir>/<dir-named-by-parent>/<basename>` and return how many landed. */
function writeUnder(files: RemoteFile[], rootDir: string): number {
  for (const f of files) {
    const dest = join(rootDir, basename(dirname(f.absPath)), basename(f.absPath))
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, f.buf)
  }
  return files.length
}

/**
 * For an ssh:// project, fetch the REMOTE host's agent conversation logs into <destDir> and return
 * ingest adapters pointed at the fetched copies — so conversations come from the remote workspace, not
 * the local machine. Engines are added incrementally (claude → codex → opencode). A failure for one
 * engine is logged via the thrown error by the caller; here we fetch best-effort per engine.
 */
export async function fetchRemoteConversations(sshRepoPath: string, destDir: string): Promise<AgentIngestAdapter[]> {
  const ssh = parseSsh(sshRepoPath)
  if (!ssh) return []
  rmSync(destDir, { recursive: true, force: true })
  const adapters: AgentIngestAdapter[] = []

  // Shell-single-quote the remote path for safe interpolation into the scripts below.
  const q = ssh.path.replace(/'/g, `'\\''`)

  // Claude: ~/.claude/projects/<cwd-with-/-as->/*.jsonl — already scoped to this project's cwd.
  const enc = ssh.path.replace(/\//g, '-')
  const claudeFiles = await fetchFiles(ssh, `ls -1t "$HOME/.claude/projects/${enc}/"*.jsonl 2>/dev/null | head -n 12`)
  if (claudeFiles.length) {
    const projectsDir = join(destDir, 'claude', 'projects')
    writeUnder(claudeFiles, projectsDir)
    adapters.push(new ClaudeAdapter(projectsDir))
  }

  // Codex: ~/.codex/sessions/<date>/rollout-*.jsonl — NOT dir-scoped, so list recent rollouts that
  // reference this project's path (newest first); sessionMatchesProject filters precisely by cwd after.
  const codexList =
    `find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -type f -size -5242880c -printf '%T@\\t%p\\n' 2>/dev/null ` +
    `| sort -rn | cut -f2- | while IFS= read -r f; do grep -lF '${q}' "$f" >/dev/null 2>&1 && echo "$f"; done | head -n 12`
  const codexFiles = await fetchFiles(ssh, codexList)
  if (codexFiles.length) {
    const sessionsDir = join(destDir, 'codex', 'sessions')
    writeUnder(codexFiles, sessionsDir)
    adapters.push(new CodexAdapter(sessionsDir))
  }

  // OpenCode: the db can be multi-GB, so export only this project's recent sessions on the remote
  // (filtered by session.directory) and fetch the small result; point OpenCodeAdapter at it.
  const ocFiles = await fetchRemoteOpencode(ssh, 12)
  if (ocFiles.length) {
    const ocDir = join(destDir, 'opencode')
    writeUnder(ocFiles, ocDir)
    adapters.push(new OpenCodeAdapter(ocDir))
  }

  return adapters
}
