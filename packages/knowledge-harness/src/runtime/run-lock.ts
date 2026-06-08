import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type RunLockOpts = {
  /** A lock older than this is treated as stale and reclaimable (default 30 min). */
  ttlMs?: number
  /** Injectable clock (ms) for tests. */
  now?: () => number
  /** Owning process id stamped into the lock (injectable for tests). */
  pid?: number
  /** Liveness probe for the owning pid; default uses `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean
}

function defaultIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }       // signal 0 = existence check
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }  // EPERM = exists but not ours; ESRCH = dead
}

/**
 * One run per project: an exclusive lockfile holding `runId\npid\ntimestamp`. A crashed run must not block
 * a project forever (#38), so a contended acquire RECLAIMS the lock when the existing owner is provably gone
 * — its pid is no longer alive OR the lock is older than `ttlMs`. A live, fresh lock still blocks.
 */
export class RunLock {
  private readonly file: string
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly pid: number
  private readonly isAlive: (pid: number) => boolean

  constructor(lockDir: string, projectId: string, opts: RunLockOpts = {}) {
    this.file = join(lockDir, `${projectId}.lock`)
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000
    this.now = opts.now ?? (() => Date.now())
    this.pid = opts.pid ?? process.pid
    this.isAlive = opts.isAlive ?? defaultIsAlive
  }

  private payload(runId: string): string { return `${runId}\n${this.pid}\n${this.now()}` }

  /** True when the existing lock's owner is provably gone (dead pid or past TTL). Unparsable → stale. */
  private isStale(): boolean {
    if (!existsSync(this.file)) return true
    const [, pidStr, tsStr] = readFileSync(this.file, 'utf8').split('\n')
    const pid = Number(pidStr), ts = Number(tsStr)
    if (!Number.isFinite(pid) || !Number.isFinite(ts)) return true   // legacy/garbage lock → reclaimable
    if (this.now() - ts > this.ttlMs) return true
    return !this.isAlive(pid)
  }

  acquire(runId: string): void {
    mkdirSync(dirname(this.file), { recursive: true })
    try {
      writeFileSync(this.file, this.payload(runId), { flag: 'wx' })  // wx: fail if it already exists (atomic)
      return
    } catch {
      if (this.isStale()) {
        // Owner is gone — reclaim. Best-effort: re-create exclusively; if a third party raced us, surface it.
        rmSync(this.file, { force: true })
        try { writeFileSync(this.file, this.payload(runId), { flag: 'wx' }); return }
        catch { /* lost the race to reclaim — fall through to the in-progress error */ }
      }
      const owner = existsSync(this.file) ? readFileSync(this.file, 'utf8').split('\n')[0] : 'unknown'
      throw new Error(`run already in progress for this project (owner=${owner})`)
    }
  }

  release(): void {
    if (existsSync(this.file)) rmSync(this.file)
  }
}
