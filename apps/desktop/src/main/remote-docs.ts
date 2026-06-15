import { parseSsh, sshExec } from './ssh-exec.js'

export type RemoteDoc = { rel: string; content: string }

const DOC_MARKER = '@@APCDOC@@'
const END_MARKER = '@@APCEND@@'

/**
 * Parse the framed output of the remote materialize command: for each doc, a `@@APCDOC@@<relpath>`
 * line, then base64 content lines, then `@@APCEND@@`. base64's alphabet ([A-Za-z0-9+/=]) can never
 * contain the markers, so framing is collision-free. CR (Windows ssh stdout) is tolerated.
 */
export function parseRemoteDocBlocks(stdout: string): RemoteDoc[] {
  const out: RemoteDoc[] = []
  let rel: string | null = null
  let b64: string[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith(DOC_MARKER)) {
      rel = line.slice(DOC_MARKER.length).replace(/^\.\//, '')
      b64 = []
    } else if (line.startsWith(END_MARKER)) {
      if (rel) out.push({ rel, content: Buffer.from(b64.join(''), 'base64').toString('utf8') })
      rel = null; b64 = []
    } else if (rel !== null) {
      b64.push(line.trim())
    }
  }
  return out
}

/**
 * Fetch project docs (.md/.markdown/.txt, each < 1MB, ≤200 files) from an ssh:// repoPath into memory.
 * One ssh round-trip: remote `find | base64` framed by markers (see parseRemoteDocBlocks). Throws on
 * ssh failure so the caller records it in the manifest's skipped list rather than silently shipping
 * an empty raw/ tree. node_modules/.git/dist/build are excluded to match the local walker.
 */
export async function fetchRemoteProjectDocs(sshRepoPath: string): Promise<RemoteDoc[]> {
  const ssh = parseSsh(sshRepoPath)
  if (!ssh) return []
  const path = ssh.path.replace(/'/g, `'\\''`)
  const cmd =
    `cd '${path}' && find . -type f \\( -name '*.md' -o -name '*.markdown' -o -name '*.txt' \\) ` +
    `-not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' -not -path './build/*' ` +
    `-size -1048576c 2>/dev/null | head -n 200 | while IFS= read -r f; do ` +
    `printf '${DOC_MARKER}%s\\n' "$f"; base64 "$f"; printf '${END_MARKER}\\n'; done`
  const res = await sshExec(ssh, cmd, { timeoutMs: 120_000 })
  if (!res.ok) throw new Error(res.stderr?.trim() || `remote doc fetch failed (exit ${res.exitCode ?? 'none'})`)
  return parseRemoteDocBlocks(res.stdout)
}
