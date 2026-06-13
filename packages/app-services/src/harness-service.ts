import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import type { AgentType, RunState, KhProjectDiscoveryReport, KhProjectPolicyProposal } from '@apc/shared'
import { KhProjectDiscoveryReportSchema } from '@apc/shared'
import { LoggingAgentRunner, type AgentRunner } from '@apc/llm-wiki'
import {
  RunArtifactStore, FeatureGate, HarnessRunner, RunLock, makeDrivers, DEFAULT_PREAMBLE,
  makeProjectDiscovery, makeWikiPolicyAdvisor,
  writeProposedPolicy, approvePolicy, revertPolicy, resolveProjectPreamble, readPolicy,
  type WikiPolicyRecord,
} from '@apc/knowledge-harness'
import { ConflictManager } from '@apc/core'
import type { AgentIngestAdapter } from '@apc/agents'
import { HarnessPromoteService, type HarnessPromoteResult, type CanonicalPromoteResult } from './harness-promote-service.js'
import { materializeProjectDocs } from './source-materializer.js'
import { materializeConversations } from './conversation-materializer.js'

/** A run always produces a runId + finalState (even FAILED); `ok` is just `finalState !== FAILED`.
 * `reason` carries the error on FAILED (the field name the CLI + IPC consumers read). */
export type HarnessRunResult = { ok: boolean; runId: string; finalState: RunState['state']; reason?: string }

/** 엔진 출력 스트리밍 이벤트 — UI live tail용. label = '<STATE>-<agent>'. */
export type EngineLogEvent = { label: string; stream: 'stdout' | 'stderr'; chunk: string }

export type HarnessServiceDeps = {
  runner: AgentRunner
  /** 대화 세션 → Q&A raw 청킹에 쓸 인제스트 어댑터들 (없으면 청킹 생략). */
  conversationAdapters?: AgentIngestAdapter[]
  vaultRoot: string
  runsRoot: string
  /** 단계별 LLM 타임아웃(ms). 미설정 시 make-drivers 기본값(600s). */
  stepTimeoutMs?: number
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

  /** Build a runner bound to one run dir (drivers close over that run's staging dir + a per-project lock).
   * 모든 엔진 호출은 LoggingAgentRunner를 거쳐 runs/<id>/logs/에 영속되고(성공·실패 불문),
   * onEngineLog가 주어지면 출력 chunk가 도착 즉시 콜백으로도 흐른다. */
  private runnerFor(runId: string, projectId: string, projectCwd?: string, onEngineLog?: (e: EngineLogEvent) => void): HarnessRunner {
    const logging = new LoggingAgentRunner(this.deps.runner, join(this.deps.runsRoot, runId, 'logs'))
    const runner: AgentRunner = !onEngineLog ? logging : {
      run: (i) => logging.run({
        ...i,
        onChunk: (stream, text) => { i.onChunk?.(stream, text); onEngineLog({ label: i.label ?? i.agent, stream, chunk: text }) },
      }),
    }
    const drivers = makeDrivers({
      runner, vaultRoot: this.deps.vaultRoot,
      stagingRoot: this.stagingDir(runId),
      preamble: resolveProjectPreamble(this.deps.vaultRoot, projectId, this.preamble),
      projectCwd,
      stepTimeoutMs: this.deps.stepTimeoutMs,
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

  async run(input: { projectId: string; engine: AgentType; materialize?: boolean; repoPaths?: string[] }, onProgress?: (rs: RunState) => void, onEngineLog?: (e: EngineLogEvent) => void): Promise<HarnessRunResult> {
    if (input.materialize && input.repoPaths?.length) {
      materializeProjectDocs(input.repoPaths, this.deps.vaultRoot)
      if (this.deps.conversationAdapters?.length) {
        await materializeConversations({
          adapters: this.deps.conversationAdapters,
          repoPaths: input.repoPaths,
          vaultRoot: this.deps.vaultRoot,
        })
      }
    }
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
    const store = new RunArtifactStore(join(this.deps.runsRoot, runId))
    const runner = this.runnerFor(runId, input.projectId, input.repoPaths?.[0], onEngineLog)
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

  /** Reuse the most recent run's ProjectDiscoveryReport for this project, if any. Newest-first by
   * runId (timestamped RUN-<iso>, so lexicographic sort == chronological). Returns null if none
   * readable — caller then runs discovery fresh. O(runs): reads run.json per run until a match;
   * fine for on-demand use — add a cache if this ever gets called on a hot path. */
  private latestDiscovery(projectId: string): KhProjectDiscoveryReport | null {
    let dirs: string[]
    try { dirs = readdirSync(this.deps.runsRoot).filter((d) => d.startsWith('RUN-')).sort().reverse() }
    catch { return null }
    for (const d of dirs) {
      try {
        const store = new RunArtifactStore(join(this.deps.runsRoot, d))
        if (!store.exists()) continue
        const rs = store.loadRunState()
        if (rs.projectId !== projectId) continue
        const rel = rs.artifacts['PROJECT_SCANNED']?.[0]
        if (!rel) continue
        return KhProjectDiscoveryReportSchema.parse(store.readArtifact(rel))
      } catch { continue }
    }
    return null
  }

  /** On-demand: ensure a discovery report, run the advisor, persist a *proposed* policy.
   * Never throws — agent/parse failures come back as { ok:false, reason }. */
  async proposeWikiPolicy(input: { projectId: string; engine: AgentType; repoPaths?: string[] }):
    Promise<{ ok: boolean; proposal?: KhProjectPolicyProposal; effectivePreview?: string; reason?: string }> {
    try {
      let discovery = this.latestDiscovery(input.projectId)
      if (!discovery) {
        discovery = await makeProjectDiscovery(this.preamble).run({
          runner: this.deps.runner, engine: input.engine,
          input: { projectId: input.projectId }, cwd: input.repoPaths?.[0], label: 'wiki-policy-discovery',
        })
      }
      const proposal = await makeWikiPolicyAdvisor(this.preamble).run({
        runner: this.deps.runner, engine: input.engine,
        input: { base_preamble: this.preamble, discovery }, cwd: input.repoPaths?.[0], label: 'wiki-policy-advisor',
      })
      const rec = writeProposedPolicy(this.deps.vaultRoot, input.projectId, proposal, this.now)
      // Preview mirrors resolveProjectPreamble's approved-path composition (base + '\n\n' + body).
      // We can't call resolveProjectPreamble here: the policy is still 'proposed', so it would return
      // base only. Keep this separator in sync with resolveProjectPreamble.
      return { ok: true, proposal, effectivePreview: `${this.preamble}\n\n${rec.body}` }
    } catch (err) {
      // Agents run on this.deps.runner directly (not the per-run LoggingAgentRunner): a proposal is not
      // a pipeline run. The LlmAgent error already embeds engine/exit/stderr head+tail, so a failed
      // proposal is still diagnosable from `reason` without a persisted logs dir.
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  approveWikiPolicy(input: { projectId: string }): { ok: boolean; record?: WikiPolicyRecord; reason?: string } {
    try { return { ok: true, record: approvePolicy(this.deps.vaultRoot, input.projectId, this.now) } }
    catch (err) { return { ok: false, reason: err instanceof Error ? err.message : String(err) } }
  }

  getWikiPolicy(input: { projectId: string }): { ok: true; record: WikiPolicyRecord | null } {
    return { ok: true, record: readPolicy(this.deps.vaultRoot, input.projectId) }
  }

  revertWikiPolicy(input: { projectId: string }): { ok: boolean; reason?: string } {
    // Wrap like the sibling methods so no exception escapes the IPC boundary (e.g. a read-only mount).
    try { revertPolicy(this.deps.vaultRoot, input.projectId); return { ok: true } }
    catch (err) { return { ok: false, reason: err instanceof Error ? err.message : String(err) } }
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
