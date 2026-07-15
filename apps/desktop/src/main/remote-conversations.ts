import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { parseSsh, sshExec, type SshExecResult } from './ssh-exec.js'
import { parseRemoteFileBlocks, type RemoteFile } from './remote-docs.js'
import { ClaudeAdapter, CodexAdapter, OpenCodeAdapter, type AgentIngestAdapter } from '@apc/agents'
import type { AgentType } from '@apc/shared'

const DOC_MARKER = '@@APCDOC@@'
const END_MARKER = '@@APCEND@@'
const ALL_AGENTS: readonly AgentType[] = ['claude', 'codex', 'opencode']

/** Run a bash script in the environment that owns the conversation stores (SSH host or WSL distro). */
export type BashScriptRunner = (script: string, timeoutMs: number) => Promise<SshExecResult>

// Remote python that exports ONLY this project's recent opencode sessions (+messages/parts/project)
// into a small /tmp/apc-oc-export/opencode.db. The full db is multi-GB, so we never fetch it whole;
// we filter by session.directory (the real cwd) so it matches the configured workspace folder. argv:
// [project-path, since-ms-or-zero]. Prints EXPORT_OK (ignored by the framed parser).
const OPENCODE_EXPORT_PY = `import sqlite3, os, sys
REPO = sys.argv[1]; SINCE = int(sys.argv[2])
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
where = "(directory=? or directory like ?)"
args = [REPO, REPO + "/%"]
if SINCE:
    where += " and (case when coalesce(time_updated,time_created,0) < 10000000000 then coalesce(time_updated,time_created,0) * 1000 else coalesce(time_updated,time_created,0) end) >= ?"
    args.append(SINCE)
sess = con.execute("select id, project_id from session where " + where + " order by time_updated desc", args).fetchall()
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

export type ConversationFetchOptions = { sinceMs?: number }

/**
 * Run a bash script (via `bash -s` over stdin — bash-forced, quoting-safe) whose `listSnippet` prints
 * absolute file paths on stdout; fetch each file's RAW BYTES (base64-framed). Reused for every engine.
 */
async function fetchFiles(runBash: BashScriptRunner, listSnippet: string): Promise<RemoteFile[]> {
  const script = [
    `emit() { printf '${DOC_MARKER}%s\\n' "$1"; base64 "$1" 2>/dev/null; printf '${END_MARKER}\\n'; }`,
    `( ${listSnippet} ) | while IFS= read -r f; do [ -f "$f" ] && emit "$f"; done`,
  ].join('\n')
  const res = await runBash(script, 120_000)
  if (!res.ok) throw new Error(res.stderr?.trim() || `remote conversation fetch failed (exit ${res.exitCode ?? 'none'})`)
  return parseRemoteFileBlocks(res.stdout)
}

/** Build a small filtered opencode db on the remote (python) and fetch it. The real db is multi-GB,
 *  so we export only this project's recent sessions remotely and fetch the small result. */
async function fetchRemoteOpencode(repoPath: string, runBash: BashScriptRunner, sinceMs?: number): Promise<RemoteFile[]> {
  const repo = repoPath.replace(/'/g, `'\\''`)
  const script = [
    `emit() { printf '${DOC_MARKER}%s\\n' "$1"; base64 "$1" 2>/dev/null; printf '${END_MARKER}\\n'; }`,
    `command -v python3 >/dev/null 2>&1 || exit 0`,
    `[ -f "$HOME/.local/share/opencode/opencode.db" ] || exit 0`,
    `python3 - '${repo}' ${Math.max(0, Math.trunc(sinceMs ?? 0))} <<'PYEOF'`,
    OPENCODE_EXPORT_PY,
    `PYEOF`,
    `[ -f /tmp/apc-oc-export/opencode.db ] && emit /tmp/apc-oc-export/opencode.db`,
    `rm -rf /tmp/apc-oc-export`,
  ].join('\n')
  const res = await runBash(script, 180_000)
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

/** Fetch recent project conversations through bash and expose compact local copies as adapters. */
export async function fetchConversationsWithRunner(
  repoPath: string,
  destDir: string,
  runBash: BashScriptRunner,
  agents: readonly AgentType[] = ALL_AGENTS,
  options: ConversationFetchOptions = {},
): Promise<AgentIngestAdapter[]> {
  rmSync(destDir, { recursive: true, force: true })
  const adapters: AgentIngestAdapter[] = []
  const wanted = new Set(agents)
  const failures: Error[] = []
  let attempted = 0

  const attempt = async (agent: AgentType, fetch: () => Promise<void>): Promise<void> => {
    if (!wanted.has(agent)) return
    attempted += 1
    try {
      await fetch()
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  // Shell-single-quote the project path for safe interpolation into the scripts below.
  const q = repoPath.replace(/'/g, `'\\''`)
  const newerThan = Number.isFinite(options.sinceMs)
    ? ` -newermt '@${Math.floor(options.sinceMs! / 1000)}'`
    : ''

  // Claude: each cwd has its own encoded directory. Include directories below the registered root
  // as well, then let the adapter's parsed cwd enforce the exact project/subdirectory boundary.
  await attempt('claude', async () => {
    // Claude Code replaces path separators and punctuation (including `_`) with `-`.
    const enc = repoPath.replace(/[^a-zA-Z0-9-]/g, '-')
    const claudeFiles = await fetchFiles(
      runBash,
      `for d in "$HOME/.claude/projects/${enc}" "$HOME/.claude/projects/${enc}-"*; do ` +
      `[ -d "$d" ] || continue; find "$d" -maxdepth 1 -name '*.jsonl' -type f${newerThan} -printf '%T@\\t%p\\n' 2>/dev/null; ` +
      `done | sort -rn | cut -f2-`,
    )
    if (claudeFiles.length) {
      const projectsDir = join(destDir, 'claude', 'projects')
      writeUnder(claudeFiles, projectsDir)
      adapters.push(new ClaudeAdapter(projectsDir))
    }
  })

  // Codex: ~/.codex/sessions/<date>/rollout-*.jsonl — NOT dir-scoped, so list recent rollouts that
  // reference this project's path (newest first); sessionMatchesProject filters precisely by cwd after.
  await attempt('codex', async () => {
    const codexList =
      `find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -type f${newerThan} -printf '%T@\\t%p\\n' 2>/dev/null ` +
      `| sort -rn | cut -f2- | while IFS= read -r f; do grep -lF '${q}' "$f" >/dev/null 2>&1 && echo "$f"; done`
    const codexFiles = await fetchFiles(runBash, codexList)
    if (codexFiles.length) {
      const sessionsDir = join(destDir, 'codex', 'sessions')
      writeUnder(codexFiles, sessionsDir)
      adapters.push(new CodexAdapter(sessionsDir))
    }
  })

  // OpenCode: the db can be multi-GB, so export only this project's recent sessions on the remote
  // (filtered by session.directory) and fetch the small result; point OpenCodeAdapter at it.
  await attempt('opencode', async () => {
    const ocFiles = await fetchRemoteOpencode(repoPath, runBash, options.sinceMs)
    if (ocFiles.length) {
      const ocDir = join(destDir, 'opencode')
      writeUnder(ocFiles, ocDir)
      adapters.push(new OpenCodeAdapter(ocDir))
    }
  })

  if (adapters.length === 0 && attempted > 0 && failures.length === attempted) {
    throw failures[0]
  }

  return adapters
}

/**
 * For an ssh:// project, fetch the remote host's agent logs into <destDir>. Passing `agents` keeps an
 * interactive history read to the selected engine instead of scanning all three stores.
 */
export async function fetchRemoteConversations(
  sshRepoPath: string,
  destDir: string,
  agents?: readonly AgentType[],
  options?: ConversationFetchOptions,
): Promise<AgentIngestAdapter[]> {
  const ssh = parseSsh(sshRepoPath)
  if (!ssh) return []
  return fetchConversationsWithRunner(
    ssh.path,
    destDir,
    (script, timeoutMs) => sshExec(ssh, 'bash -s', { stdin: script, timeoutMs }),
    agents,
    options,
  )
}
