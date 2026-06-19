import { join } from 'node:path'
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { AgentType, RunState, KhProjectDiscoveryReport, KhProjectPolicyProposal, KhApprovedNodes } from '@apc/shared'
import { KhProjectDiscoveryReportSchema, KhApprovedNodesSchema } from '@apc/shared'
import { LoggingAgentRunner, type AgentRunner, type EngineOptions } from '@apc/llm-wiki'
import {
  RunArtifactStore, FeatureGate, HarnessRunner, RunLock, makeDrivers, DEFAULT_PREAMBLE, ARTIFACTS,
  makeProjectDiscovery, makeWikiPolicyAdvisor,
  writeProposedPolicy, approvePolicy, revertPolicy, resolveProjectPreamble, readPolicy,
  resolveInside,
  type WikiPolicyRecord,
  type SourceLedger,
} from '@apc/knowledge-harness'
import { ConflictManager } from '@apc/core'
import type { AgentIngestAdapter } from '@apc/agents'
import { HarnessPromoteService, type HarnessPromoteResult, type CanonicalPromoteResult } from './harness-promote-service.js'
import { collectStagedDocs, type StagedDocEntry } from './staged-docs.js'
import { materializeProjectDocs, type RemoteDocFetcher } from './source-materializer.js'
import { materializeConversations } from './conversation-materializer.js'
import type { WorkspaceVault, WorkspaceExportResult } from './workspace-vault.js'
import { buildPipelineTranscript, transcriptToJsonl } from './pipeline-transcript.js'
import { dirname } from 'node:path'

/** A run always produces a runId + finalState (even FAILED); `ok` is just `finalState !== FAILED`.
 * `reason` carries the error on FAILED (the field name the CLI + IPC consumers read). */
export type HarnessRunResult = { ok: boolean; runId: string; finalState: RunState['state']; reason?: string }

/** 엔진 출력 스트리밍 이벤트 — UI live tail용. label = '<STATE>-<agent>'. */
export type EngineLogEvent = { label: string; stream: 'stdout' | 'stderr'; chunk: string }

/** 생성 도중 발견된 노드 미리보기 스트림 — Knowledge 탭의 점진적 그래프 표시용. */
export type HarnessNodesEvent = { runId: string; folder: string; nodes: Array<{ id: string; title: string; type: string; scope: string }> }

export type HarnessServiceDeps = {
  runner: AgentRunner
  /** 대화 세션 → Q&A raw 청킹에 쓸 인제스트 어댑터들 (없으면 청킹 생략). */
  conversationAdapters?: AgentIngestAdapter[]
  /** Idempotency ledger for source documents: skip already-processed sources, re-do only changed ones.
   *  Omitted in tests/CLI without a DB → every source is processed each run (legacy behavior). */
  sourceLedger?: SourceLedger
  /** Fetches docs from ssh:// repoPaths into raw/ (desktop wires the ssh-backed impl). Without it,
   *  SSH projects materialize no project docs (recorded in the manifest's skipped list). */
  fetchRemoteDocs?: RemoteDocFetcher
  /** For ssh:// projects, fetches the REMOTE host's agent conversation logs into `destDir` and returns
   *  adapters pointed there — so conversations come from the remote workspace, never the local machine.
   *  Desktop wires the ssh-backed impl; absent → ssh projects get no conversations. */
  remoteConversationFetcher?: (sshRepoPath: string, destDir: string) => Promise<AgentIngestAdapter[]>
  vaultRoot: string
  runsRoot: string
  /** Resolve the per-project workspace vault — the wiki's home lives IN the project's workspace
   *  (`<repo>/.apc-wiki`), local for local projects and ssh-backed for ssh:// projects. When omitted
   *  (tests/CLI), the service falls back to the single `vaultRoot` with no-op pull/push (legacy). */
  workspaceVaultFor?: (projectId: string) => WorkspaceVault | undefined
  /** 단계별 LLM 타임아웃(ms). 미설정 시 make-drivers 기본값(600s). */
  stepTimeoutMs?: number
  /** reader/extractor 프롬프트에 넣는 소스 텍스트의 char 예산 — 엔진/모델의 토큰 윈도에 맞춘다.
   *  미설정 시 make-drivers 기본값(200K). 큰 윈도 모델은 올릴 수 있다. */
  maxPromptChars?: number
  /** 서비스 전역 기본 엔진 옵션. run()의 per-call engineOptions가 우선한다. */
  engineOptions?: EngineOptions
  /** 폴더 워커 동시 실행 개수. 기본 1(순차). 레이트리밋 여유가 있으면 올린다. */
  workerConcurrency?: number
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

  /** The wiki vault for a project: its workspace-backed home if a resolver is wired, else a fallback
   *  bound to the single `deps.vaultRoot` with no-op sync (preserves legacy/test behavior). */
  private vaultFor(projectId: string): WorkspaceVault {
    const wv = this.deps.workspaceVaultFor?.(projectId)
    if (wv) return wv
    const localRoot = this.deps.vaultRoot
    return {
      localRoot,
      pull: async () => {},
      pushInternal: async () => {},
      pushRuns: async () => {},
      exportWiki: async () => ({ ok: false, reason: 'no workspace configured for this project' }),
    }
  }

  /** Save the agent-pipeline transcript (one JSONL line per agent step) for later study/training. Writes
   *  the run dir copy always, plus a copy under the workspace `runs/` so it travels. Best-effort. */
  private persistTranscript(runId: string, projectId: string, finalState: string, wv: WorkspaceVault): void {
    try {
      const runDir = join(this.deps.runsRoot, runId)
      const steps = buildPipelineTranscript(runDir, { runId, projectId, finalState })
      if (!steps.length) return
      const jsonl = transcriptToJsonl(steps)
      writeFileSync(join(runDir, 'pipeline-transcript.jsonl'), jsonl)
      const dest = join(wv.localRoot, 'runs', `${runId}.jsonl`)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, jsonl)
    } catch { /* logging/learning artifact — never fail the run over it */ }
  }

  /** Keep the internal vault out of the user's git: a self-ignoring `.gitignore` inside `.apc-wiki`
   *  makes git treat the whole dir as ignored (the published `wiki/` sibling stays tracked). It lives
   *  IN the vault, so pushInternal carries it to the remote workspace's `.apc-wiki` too. Best-effort. */
  private ensureVaultGitignore(localRoot: string): void {
    try {
      const gi = join(localRoot, '.gitignore')
      if (!existsSync(gi)) { mkdirSync(localRoot, { recursive: true }); writeFileSync(gi, '*\n') }
    } catch { /* non-fatal */ }
  }

  /** Read a run's projectId from its persisted state (for promote/export, which receive only a runId). */
  private projectIdOf(runId: string): string {
    try { return new RunArtifactStore(join(this.deps.runsRoot, runId)).loadRunState().projectId }
    catch { return '' }
  }

  /** Build a runner bound to one run dir (drivers close over that run's staging dir + a per-project lock).
   * 모든 엔진 호출은 LoggingAgentRunner를 거쳐 runs/<id>/logs/에 영속되고(성공·실패 불문),
   * onEngineLog가 주어지면 출력 chunk가 도착 즉시 콜백으로도 흐른다. */
  private runnerFor(runId: string, projectId: string, vaultRoot: string, projectCwd?: string, onEngineLog?: (e: EngineLogEvent) => void, engineOptions?: EngineOptions, workerConcurrency?: number, onNodes?: (e: HarnessNodesEvent) => void, ignoreLedger?: boolean, interactive?: boolean): HarnessRunner {
    const logging = new LoggingAgentRunner(this.deps.runner, join(this.deps.runsRoot, runId, 'logs'))
    const runner: AgentRunner = !onEngineLog ? logging : {
      run: (i) => logging.run({
        ...i,
        onChunk: (stream, text) => { i.onChunk?.(stream, text); onEngineLog({ label: i.label ?? i.agent, stream, chunk: text }) },
      }),
    }
    const drivers = makeDrivers({
      runner, vaultRoot,
      stagingRoot: this.stagingDir(runId),
      preamble: resolveProjectPreamble(vaultRoot, projectId, this.preamble),
      projectCwd,
      stepTimeoutMs: this.deps.stepTimeoutMs,
      maxPromptChars: this.deps.maxPromptChars,
      engineOptions: engineOptions ?? this.deps.engineOptions,
      workerConcurrency: workerConcurrency ?? this.deps.workerConcurrency,
      sourceLedger: this.deps.sourceLedger,
      ignoreLedger,
      interactive,
      now: this.now,
      // Forward each folder worker's nodes to the live stream, stamped with this run's id.
      onNodesDiscovered: onNodes ? (ev) => onNodes({ runId, folder: ev.folder, nodes: ev.nodes }) : undefined,
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

  async run(input: { projectId: string; engine: AgentType; materialize?: boolean; repoPaths?: string[]; engineOptions?: EngineOptions; workerConcurrency?: number; fullRegen?: boolean; interactive?: boolean }, onProgress?: (rs: RunState) => void, onEngineLog?: (e: EngineLogEvent) => void, onNodes?: (e: HarnessNodesEvent) => void): Promise<HarnessRunResult> {
    const log = (chunk: string) => onEngineLog?.({ label: 'workspace', stream: 'stdout', chunk })
    // The wiki lives in the project's workspace. Bring the canonical internal state (graph/proposals/
    // runs/projects) into the local working vault before the run; raw/ is re-materialized below.
    const wv = this.vaultFor(input.projectId)
    try { await wv.pull() }
    catch (e) { onEngineLog?.({ label: 'workspace', stream: 'stderr', chunk: `pull failed: ${String(e)}\n` }) }
    const vaultRoot = wv.localRoot
    this.ensureVaultGitignore(vaultRoot)

    // SSH projects MUST materialize every run: their working vault is wiped and re-pulled, and raw/ is
    // never synced (re-derived each run), so skipping materialize would leave raw/ empty → the extractor
    // has nothing real to cite → EvidenceVerifier path_escape. Local projects keep raw/ across runs (the
    // workspace IS the local fs, pull is a no-op), so "최근 세션" can legitimately skip the doc sweep.
    const sshRepoPath = input.repoPaths?.find((p) => p.startsWith('ssh://'))
    const doMaterialize = (input.materialize || !!sshRepoPath) && !!input.repoPaths?.length
    if (sshRepoPath && !input.materialize) log('ssh project — forcing full materialize (raw/ is not persisted for ssh).\n')

    if (doMaterialize && input.repoPaths?.length) {
      // Emit the manifest so an empty/failed source pull (e.g. an ssh fetch that returned nothing) is
      // VISIBLE in the live log instead of silently producing an empty raw/ that fails downstream.
      const docs = await materializeProjectDocs(input.repoPaths, vaultRoot, { fetchRemoteDocs: this.deps.fetchRemoteDocs })
      log(`project-docs: ${docs.files.length} file(s) materialized (scanned ${docs.scanned}).` +
        (docs.skipped.length ? ` skipped ${docs.skipped.length}: ${docs.skipped.slice(0, 5).join(' | ')}` : '') + '\n')

      // Conversations: for an ssh:// project pull them FROM THE REMOTE host (never read the local
      // machine — the user works on the remote box; local ~/.claude is the wrong machine). Local
      // projects use the injected local adapters as before.
      let convAdapters = this.deps.conversationAdapters ?? []
      if (sshRepoPath) {
        convAdapters = []
        if (this.deps.remoteConversationFetcher) {
          try { convAdapters = await this.deps.remoteConversationFetcher(sshRepoPath, join(this.deps.runsRoot, '.remote-conv')) }
          catch (e) { log(`conversations: remote fetch failed: ${String(e)}\n`) }
        }
      }
      if (convAdapters.length) {
        const conv = await materializeConversations({
          adapters: convAdapters,
          repoPaths: input.repoPaths,
          vaultRoot,
        })
        log(`conversations: ${conv.files} Q&A file(s) from ${conv.sessions} session(s).` +
          (conv.skipped.length ? ` skipped ${conv.skipped.length}` : '') + '\n')
      }
    }
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
    const store = new RunArtifactStore(join(this.deps.runsRoot, runId))
    const runner = this.runnerFor(runId, input.projectId, vaultRoot, input.repoPaths?.[0], onEngineLog, input.engineOptions, input.workerConcurrency, onNodes, input.fullRegen, input.interactive)
    runner.createRun(store, { runId, projectId: input.projectId, engine: input.engine })
    const result = await this.advanceSafely(runId, runner, store, onProgress)
    // Save the agent-pipeline transcript (run dir + workspace runs/) for later study — even on failure,
    // since failed runs are the most instructive.
    this.persistTranscript(runId, input.projectId, result.finalState, wv)
    // Sync to the workspace so it persists across machines. A successful run pushes the full internal
    // state (which includes the new transcript); a FAILED run leaves the wiki untouched but still pushes
    // just the transcript so the failure is studyable from any machine.
    try {
      if (result.finalState !== 'FAILED') { await wv.pushInternal(); log('internal state synced to workspace.\n') }
      else { await wv.pushRuns() }
    } catch (e) { onEngineLog?.({ label: 'workspace', stream: 'stderr', chunk: `push failed: ${String(e)}\n` }) }
    return result
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
    const wv = this.vaultFor(prev.projectId)
    try { await wv.pull() } catch { /* best-effort; the local working copy still holds the run's state */ }
    const runner = this.runnerFor(input.runId, prev.projectId, wv.localRoot)
    const result = await this.advanceSafely(input.runId, runner, store)
    this.persistTranscript(input.runId, prev.projectId, result.finalState, wv)
    try {
      if (result.finalState !== 'FAILED') { await wv.pushInternal() }
      else { await wv.pushRuns() }
    } catch { /* non-fatal */ }
    return result
  }

  /** 사용자가 확정한 노드 목록을 LEAD_MERGED 키 아티팩트로 저장하고(artifactByName이 찾도록 인덱스에도 추가),
   *  run을 재개한다. LEAD_MERGED는 재개 시 재실행되지 않아 인덱스가 안정적이다. */
  async confirmNodes(input: { runId: string; approvedNodes: KhApprovedNodes }): Promise<HarnessRunResult> {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, runId: input.runId, finalState: 'FAILED', reason: `run not found: ${input.runId}` }
    const approved = KhApprovedNodesSchema.parse(input.approvedNodes)
    const rel = store.writeArtifact('LEAD_MERGED', ARTIFACTS.approvedNodes, approved)
    // artifactByName은 runState.artifacts 인덱스에서 읽으므로(파일만 써선 못 찾음), LEAD_MERGED 목록에 append.
    const rs = store.loadRunState()
    const lead = rs.artifacts['LEAD_MERGED'] ?? []
    store.saveRunState({
      ...rs,
      awaiting: undefined,
      artifacts: { ...rs.artifacts, ['LEAD_MERGED']: lead.includes(rel) ? lead : [...lead, rel] },
    })
    return this.resume({ runId: input.runId })
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
    Promise<{ ok: boolean; proposal?: KhProjectPolicyProposal; effectivePreview?: string; body?: string; reason?: string }> {
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
      const rec = writeProposedPolicy(this.vaultFor(input.projectId).localRoot, input.projectId, proposal, this.now)
      // Preview mirrors resolveProjectPreamble's approved-path composition (base + '\n\n' + body).
      // We can't call resolveProjectPreamble here: the policy is still 'proposed', so it would return
      // base only. Keep this separator in sync with resolveProjectPreamble. `body` is returned too so
      // the renderer store holds the real tailoring body (not '') during the proposed phase.
      return { ok: true, proposal, effectivePreview: `${this.preamble}\n\n${rec.body}`, body: rec.body }
    } catch (err) {
      // Agents run on this.deps.runner directly (not the per-run LoggingAgentRunner): a proposal is not
      // a pipeline run. The LlmAgent error already embeds engine/exit/stderr head+tail, so a failed
      // proposal is still diagnosable from `reason` without a persisted logs dir.
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  approveWikiPolicy(input: { projectId: string }): { ok: boolean; record?: WikiPolicyRecord; reason?: string } {
    try { return { ok: true, record: approvePolicy(this.vaultFor(input.projectId).localRoot, input.projectId, this.now) } }
    catch (err) { return { ok: false, reason: err instanceof Error ? err.message : String(err) } }
  }

  getWikiPolicy(input: { projectId: string }): { ok: true; record: WikiPolicyRecord | null } {
    return { ok: true, record: readPolicy(this.vaultFor(input.projectId).localRoot, input.projectId) }
  }

  revertWikiPolicy(input: { projectId: string }): { ok: boolean; reason?: string } {
    // Wrap like the sibling methods so no exception escapes the IPC boundary (e.g. a read-only mount).
    try { revertPolicy(this.vaultFor(input.projectId).localRoot, input.projectId); return { ok: true } }
    catch (err) { return { ok: false, reason: err instanceof Error ? err.message : String(err) } }
  }

  /** Read one markdown doc from a run's vault-staging dir — the unpromoted drafts a HUMAN_REVIEW run
   * produced. The graph peek uses this so clicking a draft concept/decision node shows its content
   * (run.artifacts holds only JSON reports, and readProjectDoc only searches promoted/project roots).
   * resolveInside guards both runId and relPath against path escape; never throws. */
  readStagedDoc(input: { runId: string; relPath: string }): { ok: true; content: string } | { ok: false; reason: string } {
    if (!/\.(md|mdx|txt)$/i.test(input.relPath)) return { ok: false, reason: 'md/mdx/txt만 열 수 있습니다' }
    let abs: string
    try {
      const stagingBase = resolveInside(this.deps.runsRoot, join(input.runId, 'vault-staging'))
      abs = resolveInside(stagingBase, input.relPath)
    } catch { return { ok: false, reason: '허용되지 않는 경로' } }
    try {
      const st = statSync(abs)
      if (!st.isFile()) return { ok: false, reason: '원문 없음 (staging)' }
      if (st.size > 512 * 1024) return { ok: false, reason: `파일 크기 초과 (${Math.round(st.size / 1024)}KB > 512KB)` }
      return { ok: true, content: readFileSync(abs, 'utf8') }
    } catch { return { ok: false, reason: '원문 없음 (staging)' } }
  }

  /** List staged markdown docs from disk so the renderer can show only real rendered nodes. */
  listStagedDocs(input: { runId: string }): { docs: StagedDocEntry[] } {
    return { docs: collectStagedDocs(this.deps.runsRoot, input.runId) }
  }

  promote(input: { runId: string; allowSecrets?: boolean; allowInvalid?: boolean }): HarnessPromoteResult {
    const r = new HarnessPromoteService({ runsRoot: this.deps.runsRoot, vaultRoot: this.vaultFor(this.projectIdOf(input.runId)).localRoot })
      .promote(input)
    // Mark the run's sources processed ONLY now that its wiki is committed to the vault — not at
    // HUMAN_REVIEW. An unpromoted run must not consume sources, or the next run skips them and shrinks.
    if (r.ok) this.markRunSourcesProcessed(input.runId)
    return r
  }

  /** Record a promoted run's consumed sources in the idempotency ledger (best-effort; promotion already
   * succeeded). Reads the processed-sources artifact the HUMAN_REVIEW step recorded. */
  private markRunSourcesProcessed(runId: string): void {
    const ledger = this.deps.sourceLedger
    if (!ledger) return
    try {
      const store = new RunArtifactStore(join(this.deps.runsRoot, runId))
      const rs = store.loadRunState()
      const rel = (rs.artifacts['HUMAN_REVIEW_REQUIRED'] ?? []).find((p) => p.endsWith('processed-sources.json'))
      if (!rel) return
      const data = store.readArtifact<{ sources: { sourceId: string; sourceHash: string }[] }>(rel)
      ledger.markProcessed(rs.projectId, runId, data.sources ?? [], this.now())
    } catch { /* ledger is an optimization; never fail a successful promote over it */ }
  }

  /** Hash-gated promotion of one canonical proposal into the real vault (acceptance #7). */
  promoteCanonical(input: { runId: string; proposalRelPath: string; lastReadHash: string; allowSecrets?: boolean; allowInvalid?: boolean }): CanonicalPromoteResult {
    return new HarnessPromoteService({
      runsRoot: this.deps.runsRoot, vaultRoot: this.vaultFor(this.projectIdOf(input.runId)).localRoot,
      // full timestamp (not date-only) so two same-day conflicts on the same canonical don't clobber each other
      conflict: new ConflictManager(), stamp: this.now().replace(/[:.]/g, '-'),
    }).promoteCanonical(input)
  }

  // (promoteCanonical input type widened to accept allowSecrets — see below)
  /** Canonical proposals + current vault hashes, for the UI to drive hash-gated promotion. */
  canonicalProposals(input: { runId: string }): Array<{ proposalRelPath: string; canonicalPath: string; currentHash: string | null }> {
    return new HarnessPromoteService({ runsRoot: this.deps.runsRoot, vaultRoot: this.vaultFor(this.projectIdOf(input.runId)).localRoot, conflict: new ConflictManager() })
      .canonicalProposals(input.runId)
  }

  /** Persist a run's project vault to its workspace. Call AFTER promote: promote writes into the local
   *  working copy, and for an ssh project the next run's pull() re-pulls the workspace and wipes that
   *  copy — so without this an approved draft would be lost on the next run. No-op for the fallback vault. */
  async syncWorkspaceForRun(runId: string): Promise<void> {
    await this.vaultFor(this.projectIdOf(runId)).pushInternal()
  }

  /** Publish the project's human-readable wiki into its workspace `wiki/` area (manual export). First
   *  syncs the latest internal state to the workspace, then writes the readable docs to `<repo>/wiki/`
   *  (or its ssh equivalent). Returns the target + file count, or a reason if there's nothing to export. */
  async exportWiki(input: { projectId: string }): Promise<WorkspaceExportResult> {
    const wv = this.vaultFor(input.projectId)
    try { await wv.pushInternal() } catch { /* publish still proceeds from the local working copy */ }
    return wv.exportWiki()
  }
}
