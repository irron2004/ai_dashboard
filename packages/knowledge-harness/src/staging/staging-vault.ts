import { cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { resolveInside } from '../runtime/vault-fs.js'

/**
 * A copy-on-prepare staging vault. The Writer writes ONLY here; the real vault is never touched
 * until a human promotes. `diff()` produces a `git diff --no-index` patch between the two trees.
 * (MVP: fs copy. P1 will replace with a git worktree.)
 */
export class StagingVault {
  constructor(private readonly vaultDir: string, private readonly stagingDir: string) {}

  /** Copy vault/ → vault-staging/ (recursive). Idempotent: overwrites staging contents. */
  prepare(): void {
    mkdirSync(this.stagingDir, { recursive: true })
    if (existsSync(this.vaultDir)) cpSync(this.vaultDir, this.stagingDir, { recursive: true })
  }

  /** Write a doc into the staging tree only. Rejects paths that escape the staging dir
   * (including sibling-prefix dirs — resolveInside enforces a path-separator boundary). */
  writeDoc(relPath: string, body: string): string {
    const abs = resolveInside(this.stagingDir, relPath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
    return abs
  }

  get stagingPath(): string { return this.stagingDir }

  /** git diff --no-index between the real vault and staging. git exits 1 when diffs exist — that's success.
   *  A diff larger than the buffer is degraded-but-non-fatal (the run still has the staging tree and the
   *  applied-write report): return a marker rather than throwing and failing the whole run on diff size. */
  diff(): string {
    const r = spawnSync('git', ['diff', '--no-index', '--', this.vaultDir, this.stagingDir], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS') {
      return '# diff omitted: staging diff exceeds the 256MB buffer (staging tree + applied-write report are authoritative)\n'
    }
    if (r.status !== 0 && r.status !== 1) throw new Error(`git diff failed: ${r.stderr || r.error?.message || 'unknown'}`)
    return r.stdout
  }
}
