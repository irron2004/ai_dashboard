import { join } from 'node:path'
import type { AgentType, RunState } from '@apc/shared'
import type { AgentRunner } from '@apc/llm-wiki'
import {
  RunArtifactStore, FeatureGate, HarnessRunner, RunLock, makeDrivers, loadPreamble, DEFAULT_GATES_PATH,
} from '@apc/knowledge-harness'
import { ConflictManager } from '@apc/core'
import { HarnessPromoteService, type HarnessPromoteResult, type CanonicalPromoteResult } from './harness-promote-service.js'

/** A run always produces a runId + finalState (even FAILED); `ok` is just `finalState !== FAILED`.
 * `reason` carries the error on FAILED (the field name the CLI + IPC consumers read). */
export type HarnessRunResult = { ok: boolean; runId: string; finalState: RunState['state']; reason?: string }

export type HarnessServiceDeps = {
  runner: AgentRunner
  vaultRoot: string
  runsRoot: string
  /** path to feature-gates.yml; defaults to the shipped harness/feature-gates.yml. */
  gatesPath?: string
  preamble?: string
  now?: () => string
}

/**
 * Orchestration surface for the knowledge harness, mirroring GenerateService's shape.
 * Builds a per-run RunArtifactStore + driver map + runner, advances the pipeline, and exposes
 * show/promote. The LLM backend is injected (CliAgentRunner in prod, FakeAgentRunner in tests).
 */
export class HarnessService {
  private readonly now: () => string
  private readonly preamble: string
  private readonly gatesPath: string
  constructor(private readonly deps: HarnessServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.preamble = deps.preamble ?? loadPreamble()
    this.gatesPath = deps.gatesPath ?? DEFAULT_GATES_PATH
  }

  private stagingDir(runId: string): string { return join(this.deps.runsRoot, runId, 'vault-staging') }

  /** Build a runner bound to one run dir (drivers close over that run's staging dir + a per-project lock). */
  private runnerFor(runId: string, projectId: string): HarnessRunner {
    const drivers = makeDrivers({
      runner: this.deps.runner, vaultRoot: this.deps.vaultRoot,
      stagingRoot: this.stagingDir(runId), preamble: this.preamble,
    })
    const lock = new RunLock(join(this.deps.runsRoot, '.locks'), projectId)
    return new HarnessRunner({ gates: FeatureGate.fromFile(this.gatesPath), drivers, now: this.now, lock })
  }

  /** advance() the run, mapping a thrown lock-contention error to a structured failure result. */
  private async advanceSafely(runId: string, runner: HarnessRunner, store: RunArtifactStore): Promise<HarnessRunResult> {
    try {
      const rs = await runner.advance(store)
      return { ok: rs.state !== 'FAILED', runId, finalState: rs.state, reason: rs.error }
    } catch (err) {
      return { ok: false, runId, finalState: 'FAILED', reason: err instanceof Error ? err.message : String(err) }
    }
  }

  async run(input: { projectId: string; engine: AgentType }): Promise<HarnessRunResult> {
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
    const store = new RunArtifactStore(join(this.deps.runsRoot, runId))
    const runner = this.runnerFor(runId, input.projectId)
    runner.createRun(store, { runId, projectId: input.projectId, engine: input.engine })
    return this.advanceSafely(runId, runner, store)
  }

  /** Resume an existing run from its persisted state — e.g. after a paused gate is reopened. Re-reads
   * the gates file, so a previously-closed gate that is now open lets the walk continue. (Acceptance #6.) */
  async resume(input: { runId: string }): Promise<HarnessRunResult> {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, runId: input.runId, finalState: 'FAILED', reason: `run not found: ${input.runId}` }
    const prev = store.loadRunState()
    const runner = this.runnerFor(input.runId, prev.projectId)
    return this.advanceSafely(input.runId, runner, store)
  }

  show(input: { runId: string }): { ok: true; runState: RunState; artifacts: Array<{ state: RunState['state']; name: string; path: string; data: unknown }> } | { ok: false; reason: string } {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const runState = store.loadRunState()
    const artifacts = Object.entries(runState.artifacts).flatMap(([state, paths]) => paths.map((path) => ({
      state: state as RunState['state'],
      name: path.split('/').pop()?.replace(/\.json$/, '') ?? path,
      path,
      data: store.readArtifact(path),
    })))
    return { ok: true, runState, artifacts }
  }

  promote(input: { runId: string; allowSecrets?: boolean }): HarnessPromoteResult {
    return new HarnessPromoteService({ runsRoot: this.deps.runsRoot, vaultRoot: this.deps.vaultRoot })
      .promote(input)
  }

  /** Hash-gated promotion of one canonical proposal into the real vault (acceptance #7). */
  promoteCanonical(input: { runId: string; proposalRelPath: string; lastReadHash: string }): CanonicalPromoteResult {
    return new HarnessPromoteService({
      runsRoot: this.deps.runsRoot, vaultRoot: this.deps.vaultRoot,
      conflict: new ConflictManager(), stamp: this.now().slice(0, 10),
    }).promoteCanonical(input)
  }
}
