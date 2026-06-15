import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { parseSsh, sshExec, type SshTarget } from './ssh-exec.js'
import { parseRemoteFileBlocks, type RemoteFile } from './remote-docs.js'
import { ClaudeAdapter, CodexAdapter, type AgentIngestAdapter } from '@apc/agents'

const DOC_MARKER = '@@APCDOC@@'
const END_MARKER = '@@APCEND@@'

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

  return adapters
}
