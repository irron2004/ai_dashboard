import { RunStateSchema, type RunState, type KhState, type WikiRunEvent } from '@apc/shared'
import { PIPELINE, assertTransition } from './run-state-machine.js'
import type { FeatureGate } from './feature-gate.js'
import type { RunArtifactStore, WikiRunEventInput } from './run-artifact-store.js'
import type { RunLock } from './run-lock.js'

export type DriverArtifact = { name: string; data: unknown }
export type DriverResult = { artifacts: DriverArtifact[]; status?: 'ok' | 'failed' | 'paused'; error?: string; awaiting?: string }
type WithoutRunContext<T> = T extends WikiRunEventInput
  ? Omit<T, 'runId' | 'projectId' | 'at'>
  : never
export type WikiProgressEventDetail = WithoutRunContext<WikiRunEventInput>
export type RunnerContext = {
  runId: string
  projectId: string
  engine: string
  store: RunArtifactStore
  runState: RunState
  emitProgress?: (event: WikiProgressEventDetail) => Promise<void>
}
export type Driver = (ctx: RunnerContext) => Promise<DriverResult>

export type WikiProgressEventDiagnostic = {
  stage: 'journal' | 'sink'
  event: WikiRunEventInput
  error: unknown
}

export type HarnessRunnerDeps = {
  gates: FeatureGate
  drivers: Partial<Record<RunState['state'], Driver>>
  now: () => string
  /** Optional: when present, advance() holds the project lock for the duration of the walk. */
  lock?: RunLock
  /** Receives an event only after its JSONL append succeeds. Failure is diagnostic-only. */
  eventSink?: (event: WikiRunEvent) => void | Promise<void>
  onEventError?: (diagnostic: WikiProgressEventDiagnostic) => void
}

/** Runs that are finished — advance() must never re-walk these. */
const TERMINAL: KhState[] = ['FAILED', 'MERGED', 'HUMAN_REVIEW_REQUIRED']

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
    this.recordProgressSync(store, input.runId, input.projectId, { kind: 'run_started' })
    return rs
  }

  /** Walk PIPELINE from the run's current state to HUMAN_REVIEW_REQUIRED, a closed gate, or FAILED. Resumable. */
  async advance(store: RunArtifactStore, onProgress?: (rs: RunState) => void): Promise<RunState> {
    let runState = store.loadRunState()

    // Idempotent on terminal states: a finished/failed run is never re-walked.
    // (FAILED/MERGED are not pipeline `to` states, so without this guard findIndex returns -1
    //  and the loop would restart from the top.)
    if (TERMINAL.includes(runState.state)) return runState

    // Hold the project lock for the duration of this advance (in-process concurrency guard).
    // `acquired` ensures finally never releases a lock a *different* holder owns.
    // (Cross-process exclusivity + stale-lock timeout are Phase-1-excluded; see plan.)
    let acquired = false
    if (this.deps.lock) { this.deps.lock.acquire(runState.runId); acquired = true }
    try {
      const ctx: RunnerContext = {
        runId: runState.runId, projectId: runState.projectId, engine: runState.engine, store, runState,
        emitProgress: (event) => this.recordProgress(store, runState.runId, runState.projectId, event),
      }

      // runState.state is the last COMPLETED state; resume from the next pipeline step.
      const startIdx = PIPELINE.findIndex(s => s.to === runState.state)
      for (let i = startIdx + 1; i < PIPELINE.length; i++) {
        const step = PIPELINE[i]
        if (step.gate && !this.deps.gates.gate(step.gate)) return runState  // gate closed → stop here
        await ctx.emitProgress?.({ kind: 'phase_started', phase: step.to })
        try {
          const result = (await this.deps.drivers[step.to]?.(ctx)) ?? { artifacts: [] }
          // 4a-1: 이 단계 artifacts를 항상 먼저 보존 — 실패한 검증 단계의 리포트도 살아남아야 한다.
          const paths = result.artifacts.map(a => store.writeArtifact(step.to, a.name, a.data))
          if (result.status === 'paused') {
            // 정지: 전이하지 않고 현재 상태에 머문다(FAILED 아님). 재개 시 이 단계를 다시 실행.
            runState = {
              ...runState,
              artifacts: { ...runState.artifacts, [step.to]: paths },
              awaiting: result.awaiting ?? 'paused',
            }
            store.saveRunState(runState)
            await ctx.emitProgress?.({
              kind: 'phase_paused', phase: step.to, message: result.awaiting ?? 'paused',
            })
            onProgress?.(runState)
            return runState
          }
          if (result.status === 'failed') {
            assertTransition(runState.state, 'FAILED')
            runState = {
              ...runState,
              state: 'FAILED',
              history: [...runState.history, { state: 'FAILED', at: this.deps.now() }],
              artifacts: { ...runState.artifacts, [step.to]: paths },
              error: result.error ?? `${step.to} reported failure`,
            }
            store.saveRunState(runState)
            await ctx.emitProgress?.({ kind: 'phase_failed', phase: step.to, message: runState.error })
            await ctx.emitProgress?.({ kind: 'run_failed', message: runState.error })
            onProgress?.(runState)
            return runState
          }
          assertTransition(runState.state, step.to)
          runState = {
            ...runState,
            state: step.to,
            history: [...runState.history, { state: step.to, at: this.deps.now() }],
            artifacts: { ...runState.artifacts, [step.to]: paths },
            awaiting: undefined,
          }
          store.saveRunState(runState)
          await ctx.emitProgress?.({ kind: 'phase_completed', phase: step.to })
          ctx.runState = runState
          onProgress?.(runState)
        } catch (err) {
          runState = {
            ...runState,
            state: 'FAILED',
            history: [...runState.history, { state: 'FAILED', at: this.deps.now() }],
            error: err instanceof Error ? err.message : String(err),
          }
          store.saveRunState(runState)
          await ctx.emitProgress?.({ kind: 'phase_failed', phase: step.to, message: runState.error })
          await ctx.emitProgress?.({ kind: 'run_failed', message: runState.error })
          onProgress?.(runState)
          return runState
        }
      }
      await ctx.emitProgress?.({ kind: 'run_completed' })
      return runState
    } finally {
      if (acquired) this.deps.lock?.release()
    }
  }

  private eventInput(
    runId: string,
    projectId: string,
    detail: WikiProgressEventDetail,
  ): WikiRunEventInput {
    return { runId, projectId, at: this.deps.now(), ...detail } as WikiRunEventInput
  }

  private recordProgressSync(
    store: RunArtifactStore,
    runId: string,
    projectId: string,
    detail: WikiProgressEventDetail,
  ): void {
    const input = this.eventInput(runId, projectId, detail)
    let persisted: WikiRunEvent
    try {
      persisted = store.appendProgressEventSync(input)
    } catch (error) {
      this.reportEventError({ stage: 'journal', event: input, error })
      return
    }
    try {
      const result = this.deps.eventSink?.(persisted)
      if (result) void Promise.resolve(result).catch((error) => {
        this.reportEventError({ stage: 'sink', event: input, error })
      })
    } catch (error) {
      this.reportEventError({ stage: 'sink', event: input, error })
    }
  }

  private async recordProgress(
    store: RunArtifactStore,
    runId: string,
    projectId: string,
    detail: WikiProgressEventDetail,
  ): Promise<void> {
    const input = this.eventInput(runId, projectId, detail)
    let persisted: WikiRunEvent
    try {
      persisted = await store.appendProgressEvent(input)
    } catch (error) {
      this.reportEventError({ stage: 'journal', event: input, error })
      return
    }
    try {
      await this.deps.eventSink?.(persisted)
    } catch (error) {
      this.reportEventError({ stage: 'sink', event: input, error })
    }
  }

  private reportEventError(diagnostic: WikiProgressEventDiagnostic): void {
    try { this.deps.onEventError?.(diagnostic) } catch { /* diagnostics never alter the run */ }
  }
}
