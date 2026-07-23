import { cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { resolveInside } from '../runtime/vault-fs.js'

const DIFF_MAX_BUFFER = 32 * 1024 * 1024
const DIFF_TIMEOUT_MS = 60_000

type DiffError = Error & { code?: number | string; stdout?: string | Buffer; stderr?: string | Buffer }

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

  /** Async git diff --no-index between the real vault and staging. git exits 1 when diffs exist — that's success.
   *  A diff larger than the buffer is degraded-but-non-fatal (the run still has the staging tree and the
   *  applied-write report): return a marker rather than throwing and failing the whole run on diff size. */
  diff(options: { signal?: AbortSignal } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        execFile('git', ['diff', '--no-index', '--', this.vaultDir, this.stagingDir], {
          encoding: 'utf8',
          maxBuffer: DIFF_MAX_BUFFER,
          timeout: DIFF_TIMEOUT_MS,
          signal: options.signal,
        }, (error, stdout, stderr) => {
          if (!error) { resolve(String(stdout)); return }
          const commandError = error as DiffError
          if (commandError.code === 1) { resolve(String(stdout ?? commandError.stdout ?? '')); return }
          const bufferExceeded = commandError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            || commandError.message.includes('maxBuffer')
          if (bufferExceeded) {
            resolve('# diff omitted: staging diff exceeds the 32MB buffer (staging tree + applied-write report are authoritative)\n')
            return
          }
          reject(new Error(`git diff failed: ${String(stderr || commandError.stderr || commandError.message || 'unknown')}`))
        })
      } catch (error) {
        reject(error)
      }
    })
  }
}
