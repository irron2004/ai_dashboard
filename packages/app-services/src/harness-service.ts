import { join } from 'node:path'
import type { AgentType, RunState } from '@apc/shared'
import type { AgentRunner } from '@apc/llm-wiki'
import {
  RunArtifactStore, FeatureGate, HarnessRunner, makeDrivers, loadPreamble, DEFAULT_GATES_PATH,
} from '@apc/knowledge-harness'
import { HarnessPromoteService, type HarnessPromoteResult } from './harness-promote-service.js'

export type HarnessRunResult =
  | { ok: true; runId: string; finalState: RunState['state']; error?: string }
  | { ok: false; reason: string }

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

  async run(input: { projectId: string; engine: AgentType }): Promise<HarnessRunResult> {
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
    const store = new RunArtifactStore(join(this.deps.runsRoot, runId))
    const drivers = makeDrivers({
      runner: this.deps.runner, vaultRoot: this.deps.vaultRoot,
      stagingRoot: this.stagingDir(runId), preamble: this.preamble,
    })
    const runner = new HarnessRunner({ gates: FeatureGate.fromFile(this.gatesPath), drivers, now: this.now })
    runner.createRun(store, { runId, projectId: input.projectId, engine: input.engine })
    const rs = await runner.advance(store)
    return { ok: rs.state !== 'FAILED', runId, finalState: rs.state, error: rs.error }
  }

  show(input: { runId: string }): { ok: true; runState: RunState } | { ok: false; reason: string } {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    return { ok: true, runState: store.loadRunState() }
  }

  promote(input: { runId: string }): HarnessPromoteResult {
    return new HarnessPromoteService({ runsRoot: this.deps.runsRoot, vaultRoot: this.deps.vaultRoot })
      .promote(input)
  }
}
