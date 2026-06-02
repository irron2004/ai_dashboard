import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { RunStateSchema, type RunState, type KhState } from '@apc/shared'

/** Reads/writes one run directory: runs/RUN-<id>/. The only component that touches the run's filesystem. */
export class RunArtifactStore {
  /** @param runDir absolute path to the run directory. */
  constructor(private readonly runDir: string) {}

  init(): void {
    for (const d of ['inputs', 'artifacts', 'proposals', 'validation']) {
      mkdirSync(join(this.runDir, d), { recursive: true })
    }
  }

  saveRunState(state: RunState): void {
    mkdirSync(this.runDir, { recursive: true })
    writeFileSync(join(this.runDir, 'run.json'), JSON.stringify(state, null, 2))
  }

  loadRunState(): RunState {
    return RunStateSchema.parse(JSON.parse(readFileSync(join(this.runDir, 'run.json'), 'utf8')))
  }

  /** Persist one artifact as artifacts/<STATE>/<name>.json; returns its path relative to runDir. */
  writeArtifact(state: KhState, name: string, data: unknown): string {
    mkdirSync(join(this.runDir, 'artifacts', state), { recursive: true })
    const rel = join('artifacts', state, `${name}.json`)
    writeFileSync(join(this.runDir, rel), JSON.stringify(data, null, 2))
    return rel
  }

  readArtifact<T = unknown>(rel: string): T {
    return JSON.parse(readFileSync(join(this.runDir, rel), 'utf8')) as T
  }

  exists(): boolean {
    return existsSync(join(this.runDir, 'run.json'))
  }
}
