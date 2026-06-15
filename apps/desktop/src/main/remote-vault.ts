import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  type WorkspaceVault, type WorkspaceExportResult,
  internalStateFiles, publishableWikiFiles,
} from '@apc/app-services'
import { parseSsh, sshExec, type SshExec, type SshTarget } from './ssh-exec.js'
import { DOC_MARKER, END_MARKER, parseRemoteFileBlocks } from './remote-docs.js'

/** Single-quote a string for safe embedding inside a remote `'...'` shell literal. */
const sq = (s: string): string => s.replace(/'/g, `'\\''`)

/** Heredoc delimiter for pushed file bodies — contains `_`, which is NOT in the base64 alphabet, so a
 *  base64 content line can never collide with it. */
const B64_EOF = 'APC_B64_EOF'

/**
 * Pull every file under a remote directory into `localRoot` (mirrored — `localRoot` is wiped first so
 * a file deleted on the remote disappears locally). `raw/` is skipped: it is re-materialized from the
 * workspace docs each run, so transferring it would be wasted bandwidth. Uses the same collision-free
 * base64 framing as the doc fetch (see parseRemoteFileBlocks); emitted paths are RELATIVE to the dir.
 * A missing remote dir is not an error — it yields zero files (a fresh project).
 */
export async function pullDir(ssh: SshTarget, remoteDir: string, localRoot: string, exec: SshExec = sshExec): Promise<void> {
  const dir = sq(remoteDir)
  const script = [
    `DIR='${dir}'`,
    `emit() { printf '${DOC_MARKER}%s\\n' "$1"; base64 "$1" 2>/dev/null; printf '${END_MARKER}\\n'; }`,
    `if cd "$DIR" 2>/dev/null; then`,
    `  find . -type f -not -path './raw/*' -size -10485760c 2>/dev/null | while IFS= read -r f; do emit "\${f#./}"; done`,
    `fi`,
  ].join('\n')
  const res = await exec(ssh, 'bash -s', { stdin: script, timeoutMs: 120_000 })
  if (!res.ok) throw new Error(res.stderr?.trim() || `remote pull failed (exit ${res.exitCode ?? 'none'})`)
  const files = parseRemoteFileBlocks(res.stdout)
  rmSync(localRoot, { recursive: true, force: true })
  for (const f of files) {
    const dest = join(localRoot, f.absPath) // absPath here is the relative path we emitted
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, f.buf)
  }
}

/**
 * Write the given `relFiles` (relative to `localRoot`) into `remoteDir` in ONE ssh round-trip: each
 * file is base64-encoded locally and decoded on the remote via a heredoc. With `mirror`, the remote
 * dir's existing contents are cleared first (except `raw/`, which we never push) so deletions
 * propagate. Throws on ssh failure so the caller surfaces it instead of silently losing the sync.
 */
export async function pushDir(
  ssh: SshTarget, localRoot: string, remoteDir: string, relFiles: string[],
  opts: { mirror?: boolean; exec?: SshExec } = {},
): Promise<void> {
  const exec = opts.exec ?? sshExec
  const remote = sq(remoteDir)
  const lines: string[] = ['set -e', `mkdir -p '${remote}'`]
  if (opts.mirror) {
    // Clear existing contents but keep a remote raw/ (we never transfer raw/, so don't delete it).
    lines.push(`find '${remote}' -mindepth 1 -maxdepth 1 -not -name raw -exec rm -rf {} + 2>/dev/null || true`)
  }
  for (const rel of relFiles) {
    const b64 = readFileSync(join(localRoot, rel)).toString('base64').replace(/(.{76})/g, '$1\n')
    const target = `'${remote}/${sq(rel)}'`
    lines.push(`mkdir -p "$(dirname ${target})"`)
    lines.push(`base64 -d > ${target} <<'${B64_EOF}'`)
    lines.push(b64)
    lines.push(B64_EOF)
  }
  const res = await exec(ssh, 'bash -s', { stdin: lines.join('\n') + '\n', timeoutMs: 180_000 })
  if (!res.ok) throw new Error(res.stderr?.trim() || `remote push failed (exit ${res.exitCode ?? 'none'})`)
}

/**
 * Workspace vault backed by an ssh:// repo. The canonical wiki home lives on the REMOTE host
 * (`<repo>/.apc-wiki` internal state + `<repo>/wiki` published), but runs execute against a local
 * working copy under `cacheRoot/<projectId>` because EvidenceVerifier must read cited files locally.
 * `pull` brings the remote internal state down before a run; `pushInternal` writes it back after;
 * `exportWiki` publishes the readable docs to the remote `wiki/`.
 */
export class SshWorkspaceVault implements WorkspaceVault {
  readonly localRoot: string
  private readonly ssh: SshTarget
  private readonly base: string
  constructor(sshRepoPath: string, private readonly projectId: string, cacheRoot: string, private readonly exec: SshExec = sshExec) {
    const ssh = parseSsh(sshRepoPath)
    if (!ssh) throw new Error(`SshWorkspaceVault: not an ssh path: ${sshRepoPath}`)
    this.ssh = ssh
    this.base = ssh.path.replace(/\/+$/, '')
    this.localRoot = join(cacheRoot, projectId)
  }
  private remote(sub: string): string { return `${this.base}/${sub}` }

  async pull(): Promise<void> {
    await pullDir(this.ssh, this.remote('.apc-wiki'), this.localRoot, this.exec)
  }

  async pushInternal(): Promise<void> {
    const files = internalStateFiles(this.localRoot)
    if (!files.length) return
    await pushDir(this.ssh, this.localRoot, this.remote('.apc-wiki'), files, { mirror: true, exec: this.exec })
  }

  async exportWiki(): Promise<WorkspaceExportResult> {
    if (!existsSync(this.localRoot)) return { ok: false, reason: 'no generated wiki to export (run a generation first)' }
    const rels = publishableWikiFiles(this.localRoot)
    if (!rels.length) return { ok: false, reason: 'no publishable wiki files yet' }
    await pushDir(this.ssh, this.localRoot, this.remote('wiki'), rels, { mirror: true, exec: this.exec })
    return { ok: true, target: `ssh:${this.remote('wiki')}`, files: rels.length }
  }
}
