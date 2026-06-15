import { parseSsh, sshExec } from './ssh-exec.js'

/** A fetched remote file, identified by its ABSOLUTE remote path so the materializer can place it
 *  under raw/project-docs (inside the repo) or raw/context (parent CLAUDE.md / Claude memory). */
export type RemoteDoc = { absPath: string; content: string }

export const DOC_MARKER = '@@APCDOC@@'
export const END_MARKER = '@@APCEND@@'

/** A fetched remote file with its raw bytes (binary-safe — sqlite dbs etc. survive intact). */
export type RemoteFile = { absPath: string; buf: Buffer }

/**
 * Parse the framed output of the remote fetch command into raw bytes per file: for each file, a
 * `@@APCDOC@@<absolute-path>` line, then base64 content lines, then `@@APCEND@@`. base64's alphabet
 * ([A-Za-z0-9+/=]) can never contain the markers, so framing is collision-free. CR (Windows ssh
 * stdout) is tolerated. Returns Buffers so binary files (e.g. an opencode sqlite db) aren't corrupted.
 */
export function parseRemoteFileBlocks(stdout: string): RemoteFile[] {
  const out: RemoteFile[] = []
  let absPath: string | null = null
  let b64: string[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith(DOC_MARKER)) {
      absPath = line.slice(DOC_MARKER.length)
      b64 = []
    } else if (line.startsWith(END_MARKER)) {
      if (absPath) out.push({ absPath, buf: Buffer.from(b64.join(''), 'base64') })
      absPath = null; b64 = []
    } else if (absPath !== null) {
      b64.push(line.trim())
    }
  }
  return out
}

/** Same framing, decoded as UTF-8 text — for the doc/source fetch (all text files). */
export function parseRemoteDocBlocks(stdout: string): RemoteDoc[] {
  return parseRemoteFileBlocks(stdout).map((f) => ({ absPath: f.absPath, content: f.buf.toString('utf8') }))
}

/**
 * Fetch the documents a remote wiki run reasons over, into memory, in ONE ssh round-trip. Three groups,
 * all emitted with their absolute remote path (framed by markers, base64'd — see parseRemoteDocBlocks):
 *
 *  1. Project docs (.md/.markdown/.txt) under the repo path — the wiki's primary sources.
 *  2. CLAUDE.md / AGENTS.md in every ANCESTOR directory — governance the agent auto-loads and cites.
 *  3. The Claude Code project memory (~/.claude/projects/<cwd-with-/-as->/memory/*.md|*.txt) — the
 *     "project memory" the agent injects and cites as evidence.
 *
 * Groups 2 & 3 live OUTSIDE the repo path, so without them the agent's evidence (parent CLAUDE.md,
 * MEMORY.md) can never resolve to a local raw/ file and EvidenceVerifier rejects it (path_escape).
 *
 * Runs via `bash -s` over stdin: forces bash regardless of the remote login shell, and feeding the
 * script on stdin avoids a second layer of Windows ssh.exe arg-quoting (the find/pipe/() in the script
 * get mangled when passed as a command argument). Each file is capped at <1MB. Throws on ssh failure so
 * the caller records it in the manifest's skipped list instead of silently shipping an empty raw/.
 */
export async function fetchRemoteProjectDocs(sshRepoPath: string): Promise<RemoteDoc[]> {
  const ssh = parseSsh(sshRepoPath)
  if (!ssh) return []
  const repo = ssh.path.replace(/'/g, `'\\''`)
  const script = [
    `REPO='${repo}'`,
    `emit() { printf '${DOC_MARKER}%s\\n' "$1"; base64 "$1" 2>/dev/null; printf '${END_MARKER}\\n'; }`,
    // 1) project docs under the repo (emit absolute paths so the materializer can relativize them)
    `if cd "$REPO" 2>/dev/null; then`,
    `  find . -type f \\( -name '*.md' -o -name '*.markdown' -o -name '*.txt' \\) \\`,
    `    -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' -not -path './build/*' \\`,
    `    -size -1048576c 2>/dev/null | head -n 200 | while IFS= read -r f; do emit "$REPO/\${f#./}"; done`,
    `fi`,
    // 2) CLAUDE.md / AGENTS.md in ancestor directories (governance the agent auto-loads)
    `d="$REPO"`,
    `while [ -n "$d" ] && [ "$d" != "/" ]; do`,
    `  d=$(dirname "$d")`,
    `  for n in CLAUDE.md AGENTS.md; do [ -f "$d/$n" ] && emit "$d/$n"; done`,
    `done`,
    // 3) Claude Code project memory for this cwd
    `enc=$(printf '%s' "$REPO" | sed 's#/#-#g')`,
    `mdir="$HOME/.claude/projects/$enc/memory"`,
    `if [ -d "$mdir" ]; then`,
    `  find "$mdir" -type f \\( -name '*.md' -o -name '*.txt' \\) -size -1048576c 2>/dev/null | head -n 50 | while IFS= read -r f; do emit "$f"; done`,
    `fi`,
  ].join('\n')
  const res = await sshExec(ssh, 'bash -s', { stdin: script, timeoutMs: 120_000 })
  if (!res.ok) throw new Error(res.stderr?.trim() || `remote doc fetch failed (exit ${res.exitCode ?? 'none'})`)
  return parseRemoteDocBlocks(res.stdout)
}
