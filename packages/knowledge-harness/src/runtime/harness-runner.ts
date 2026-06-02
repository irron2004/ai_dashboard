import { RunStateSchema, type RunState } from '@apc/shared'
import { PIPELINE, assertTransition } from './run-state-machine.js'
import type { FeatureGate } from './feature-gate.js'
import type { RunArtifactStore } from './run-artifact-store.js'

export type DriverArtifact = { name: string; data: unknown }
export type DriverResult = { artifacts: DriverArtifact[] }
export type RunnerContext = { runId: string; projectId: string; engine: string; store: RunArtifactStore; runState: RunState }
export type Driver = (ctx: RunnerContext) => Promise<DriverResult>

export type HarnessRunnerDeps = {
  gates: FeatureGate
  drivers: Partial<Record<RunState['state'], Driver>>
  now: () => string
}

export class HarnessRunner {
  constructor(private readonly deps: HarnessRunnerDeps) {}

  /** Create and persist a fresh run in the CREATED state. */
  createRun(store: RunArtifactStore, input: { runId: string; projectId: string; engine: string }): RunState {
    const rs = RunStateSchema.parse({
      runId: input.runId, projectId: input.projectId, engine: input.engine,
      state: 'CREATED', history: [{ state: 'CREATED', at: this.deps.now() }], artifacts: {},
    })
    store.init()
    store.saveRunState(rs)
    return rs
  }

  /** Walk PIPELINE from the run's current state to HUMAN_REVIEW_REQUIRED, a closed gate, or FAILED. Resumable. */
  async advance(store: RunArtifactStore): Promise<RunState> {
    let runState = store.loadRunState()
    const ctx: RunnerContext = {
      runId: runState.runId, projectId: runState.projectId, engine: runState.engine, store, runState,
    }

    // runState.state is the last COMPLETED state; resume from the next pipeline step.
    const startIdx = PIPELINE.findIndex(s => s.to === runState.state)
    for (let i = startIdx + 1; i < PIPELINE.length; i++) {
      const step = PIPELINE[i]
      if (step.gate && !this.deps.gates.gate(step.gate)) return runState  // gate closed → stop here
      try {
        const result = (await this.deps.drivers[step.to]?.(ctx)) ?? { artifacts: [] }
        assertTransition(runState.state, step.to)
        const paths = result.artifacts.map(a => store.writeArtifact(step.to, a.name, a.data))
        runState = {
          ...runState,
          state: step.to,
          history: [...runState.history, { state: step.to, at: this.deps.now() }],
          artifacts: { ...runState.artifacts, [step.to]: paths },
        }
        store.saveRunState(runState)
        ctx.runState = runState
      } catch (err) {
        runState = {
          ...runState,
          state: 'FAILED',
          history: [...runState.history, { state: 'FAILED', at: this.deps.now() }],
          error: err instanceof Error ? err.message : String(err),
        }
        store.saveRunState(runState)
        return runState
      }
    }
    return runState
  }
}
