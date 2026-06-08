import { join } from 'node:path'
import type { AgentType, RunState } from '@apc/shared'
import type { AgentRunner } from '@apc/llm-wiki'
import {
  RunArtifactStore, FeatureGate, HarnessRunner, RunLock, makeDrivers, DEFAULT_PREAMBLE,
} from '@apc/knowledge-harness'
import { ConflictManager } from '@apc/core'
import { HarnessPromoteService, type HarnessPromoteResult, type CanonicalPromoteResult } from './harness-promote-service.js'
import { materializeProjectDocs } from './source-materializer.js'

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
  private readonly gatesPath?: string
  constructor(private readonly deps: HarnessServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
    // Defaults are compiled-in (fs-free): a bundled app boots even if no harness/ file is reachable.
    this.preamble = deps.preamble ?? DEFAULT_PREAMBLE
    this.gatesPath = deps.gatesPath
  }

  /** Fail-safe gate source: read the override file if given & readable, else the embedded defaults. */
  private featureGate(): FeatureGate {
    if (this.gatesPath) {
      try { return FeatureGate.fromFile(this.gatesPath) }
      catch { /* missing/unreadable override → embedded defaults (never block boot on a missing file) */ }
    }
    return FeatureGate.default()
  }

  private stagingDir(runId: string): string { return join(this.deps.runsRoot, runId, 'vault-staging') }

  /** Build a runner bound to one run dir (drivers close over that run's staging dir + a per-project lock). */
  private runnerFor(runId: string, projectId: string, projectCwd?: string): HarnessRunner {
    const drivers = makeDrivers({
      runner: this.deps.runner, vaultRoot: this.deps.vaultRoot,
      stagingRoot: this.stagingDir(runId), preamble: this.preamble, projectCwd,
    })
    const lock = new RunLock(join(this.deps.runsRoot, '.locks'), projectId)
    return new HarnessRunner({ gates: this.featureGate(), drivers, now: this.now, lock })
  }

  /** advance() the run, mapping a thrown lock-contention error to a structured failure result. */
  private async advanceSafely(runId: string, runner: HarnessRunner, store: RunArtifactStore, onProgress?: (rs: RunState) => void): Promise<HarnessRunResult> {
    try {
      const rs = await runner.advance(store, onProgress)
      return { ok: rs.state !== 'FAILED', runId, finalState: rs.state, reason: rs.error }
    } catch (err) {
      let reason = err instanceof Error ? err.message : String(err)
      // A crashed prior run can leave an orphaned project lockfile (no stale-lock TTL in the MVP);
      // tell the operator how to recover manually rather than leaving the run permanently un-resumable.
      if (/already in progress/.test(reason)) {
        reason += ` — if a prior run crashed, delete the stale lock at ${join(this.deps.runsRoot, '.locks')}/<projectId>.lock and retry`
      }
      return { ok: false, runId, finalState: 'FAILED', reason }
    }
  }

  async run(input: { projectId: string; engine: AgentType; materialize?: boolean; repoPaths?: string[] }, onProgress?: (rs: RunState) => void): Promise<HarnessRunResult> {
    if (input.materialize && input.repoPaths?.length) {
      materializeProjectDocs(input.repoPaths, this.deps.vaultRoot)
    }
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
    const store = new RunArtifactStore(join(this.deps.runsRoot, runId))
    const runner = this.runnerFor(runId, input.projectId, input.repoPaths?.[0])
    runner.createRun(store, { runId, projectId: input.projectId, engine: input.engine })
    return this.advanceSafely(runId, runner, store, onProgress)
  }

  /** Resume an existing run from its persisted state — e.g. after a paused gate is reopened. Re-reads
   * the gates file, so a previously-closed gate that is now open lets the walk continue. (Acceptance #6.) */
  async resume(input: { runId: string }): Promise<HarnessRunResult> {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, runId: input.runId, finalState: 'FAILED', reason: `run not found: ${input.runId}` }
    const prev = store.loadRunState()
    // Terminal runs are no-ops at the runtime level — give a clear "nothing to resume" message instead of
    // reusing the generic failure shape (MERGED has no rs.error, which would otherwise print "unknown").
    if (prev.state === 'FAILED' || prev.state === 'MERGED') {
      return { ok: false, runId: input.runId, finalState: prev.state, reason: `run ${input.runId} is already ${prev.state} — nothing to resume${prev.error ? ` (original error: ${prev.error})` : ''}` }
    }
    // Fail fast with a clear reason if the on-disk artifact index references files that are gone.
    const missing = store.missingArtifacts(prev)
    if (missing.length) {
      return { ok: false, runId: input.runId, finalState: 'FAILED', reason: `cannot resume ${input.runId}: missing artifacts ${missing.join(', ')}` }
    }
    const runner = this.runnerFor(input.runId, prev.projectId)
    return this.advanceSafely(input.runId, runner, store)
  }

  show(input: { runId: string }): { ok: true; runState: RunState; artifacts: Array<{ state: RunState['state']; name: string; path: string; data: unknown }> } | { ok: false; reason: string } {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const runState = store.loadRunState()
    const artifacts = Object.entries(runState.artifacts).flatMap(([state, paths]) => paths.map((path) => ({
      state: state as RunState['state'],
      // Split on both separators so a Windows-authored rel path (back-slashes) displays correctly.
      name: path.split(/[\\/]/).pop()?.replace(/\.json$/, '') ?? path,
      path,
      data: store.readArtifact(path),
    })))
    return { ok: true, runState, artifacts }
  }

  promote(input: { runId: string; allowSecrets?: boolean; allowInvalid?: boolean }): HarnessPromoteResult {
    return new HarnessPromoteService({ runsRoot: this.deps.runsRoot, vaultRoot: this.deps.vaultRoot })
      .promote(input)
  }

  /** Hash-gated promotion of one canonical proposal into the real vault (acceptance #7). */
  promoteCanonical(input: { runId: string; proposalRelPath: string; lastReadHash: string; allowSecrets?: boolean; allowInvalid?: boolean }): CanonicalPromoteResult {
    return new HarnessPromoteService({
      runsRoot: this.deps.runsRoot, vaultRoot: this.deps.vaultRoot,
      // full timestamp (not date-only) so two same-day conflicts on the same canonical don't clobber each other
      conflict: new ConflictManager(), stamp: this.now().replace(/[:.]/g, '-'),
    }).promoteCanonical(input)
  }

  // (promoteCanonical input type widened to accept allowSecrets — see below)
  /** Canonical proposals + current vault hashes, for the UI to drive hash-gated promotion. */
  canonicalProposals(input: { runId: string }): Array<{ proposalRelPath: string; canonicalPath: string; currentHash: string | null }> {
    return new HarnessPromoteService({ runsRoot: this.deps.runsRoot, vaultRoot: this.deps.vaultRoot, conflict: new ConflictManager() })
      .canonicalProposals(input.runId)
  }
}
