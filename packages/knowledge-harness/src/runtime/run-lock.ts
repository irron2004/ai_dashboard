import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** One run per project: an exclusive lockfile holding the owning runId. */
export class RunLock {
  private readonly file: string
  constructor(lockDir: string, projectId: string) { this.file = join(lockDir, `${projectId}.lock`) }

  acquire(runId: string): void {
    mkdirSync(dirname(this.file), { recursive: true })
    try {
      writeFileSync(this.file, runId, { flag: 'wx' })  // wx: fail if it already exists (atomic)
    } catch {
      const owner = existsSync(this.file) ? readFileSync(this.file, 'utf8') : 'unknown'
      throw new Error(`run already in progress for this project (owner=${owner})`)
    }
  }

  release(): void {
    if (existsSync(this.file)) rmSync(this.file)
  }
}
