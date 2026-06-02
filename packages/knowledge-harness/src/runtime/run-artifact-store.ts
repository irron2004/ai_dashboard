import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs'
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

  /** Write to a sibling .tmp then rename — rename is atomic on the same filesystem, so a reader
   * (or a crash) never observes a half-written file. The .tmp name is pid-qualified to avoid
   * collisions between concurrent writers in the same dir. */
  private writeAtomic(abs: string, data: string): void {
    const tmp = `${abs}.${process.pid}.tmp`
    writeFileSync(tmp, data)
    renameSync(tmp, abs)
  }

  saveRunState(state: RunState): void {
    mkdirSync(this.runDir, { recursive: true })
    this.writeAtomic(join(this.runDir, 'run.json'), JSON.stringify(state, null, 2))
  }

  loadRunState(): RunState {
    return RunStateSchema.parse(JSON.parse(readFileSync(join(this.runDir, 'run.json'), 'utf8')))
  }

  /** Persist one artifact as artifacts/<STATE>/<name>.json; returns its path relative to runDir. */
  writeArtifact(state: KhState, name: string, data: unknown): string {
    mkdirSync(join(this.runDir, 'artifacts', state), { recursive: true })
    const rel = join('artifacts', state, `${name}.json`)
    this.writeAtomic(join(this.runDir, rel), JSON.stringify(data, null, 2))
    return rel
  }

  readArtifact<T = unknown>(rel: string): T {
    return JSON.parse(readFileSync(join(this.runDir, rel), 'utf8')) as T
  }

  exists(): boolean {
    return existsSync(join(this.runDir, 'run.json'))
  }

  /** Resume validation: which of the run's indexed artifact paths are absent on disk.
   * An empty result means the persisted state is self-consistent and safe to resume. */
  missingArtifacts(state: RunState): string[] {
    const missing: string[] = []
    for (const paths of Object.values(state.artifacts)) {
      for (const rel of paths) {
        if (!existsSync(join(this.runDir, rel))) missing.push(rel)
      }
    }
    return missing
  }
}
