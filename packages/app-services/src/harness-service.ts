import { dirname, join } from 'node:path'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import type {
  AgentType,
  RunState,
  KhProjectDiscoveryReport,
  KhProjectPolicyProposal,
  KhApprovedNodes,
  WikiProgressSummary,
  WikiRunEvent,
} from '@apc/shared'
import { KhProjectDiscoveryReportSchema, KhApprovedNodesSchema, RunStateSchema } from '@apc/shared'
import { LoggingAgentRunner, type AgentRunner, type EngineOptions } from '@apc/llm-wiki'
import {
  RunArtifactStore, FeatureGate, HarnessRunner, RunLock, makeDrivers, DEFAULT_PREAMBLE, ARTIFACTS,
  makeProjectDiscovery, makeWikiPolicyAdvisor,
  writeProposedPolicy, approvePolicy, revertPolicy, resolveProjectPreamble, readPolicy,
  resolveInside,
  domainPackFor,
  type WikiPolicyRecord,
  type SourceLedger,
  type DomainId,
  type DomainPack,
  type ProjectStructureHint,
} from '@apc/knowledge-harness'
import { ConflictManager } from '@apc/core'
import type { AgentIngestAdapter } from '@apc/agents'
import { HarnessPromoteService, type HarnessPromoteResult, type CanonicalPromoteResult } from './harness-promote-service.js'
import { collectStagedDocs, type StagedDocEntry } from './staged-docs.js'
import { materializeProjectDocs, type RemoteDocFetcher } from './source-materializer.js'
import { materializeConversations } from './conversation-materializer.js'
import type { WorkspaceVault, WorkspaceExportResult } from './workspace-vault.js'
import { buildPipelineTranscript, transcriptToJsonl } from './pipeline-transcript.js'
import { PythonKernelAdapter, type WikiSubstrate } from '@apc/wiki-substrate'

/** A run always produces a runId + finalState (even FAILED); `ok` is just `finalState !== FAILED`.
 * `reason` carries the error on FAILED (the field name the CLI + IPC consumers read). */
export type HarnessRunResult = { ok: boolean; runId: string; finalState: RunState['state']; reason?: string }

/** Resolve the domain pack for a run; missing domain = the legacy project-docs pack. */
export function resolveDomainPack(domain: DomainId | undefined): DomainPack {
  return domainPackFor(domain ?? 'project-docs')
}

/** Build the kernel-lint substrate from core.lock's venv python, or undefined if unavailable
 *  (no lock, missing python, or a non-Windows venv on win32). Paper VALIDATED needs this. */
export function buildVenvSubstrate(repoRoot: string): WikiSubstrate | undefined {
  const lock = join(repoRoot, 'core.lock')
  if (!existsSync(lock)) return undefined
  const venvPython: string | undefined = JSON.parse(readFileSync(lock, 'utf8')).venv_python
  if (!venvPython) return undefined  // malformed lock (no venv_python) — don't resolve to repoRoot itself
  const python = join(repoRoot, venvPython)
  const winRunnable = process.platform !== 'win32' || /[\\/]scripts[\\/]/i.test(python)
  if (!existsSync(python) || !winRunnable) return undefined
  return new PythonKernelAdapter({ python, cwd: repoRoot })
}

/** 엔진 출력 스트리밍 이벤트 — UI live tail용. label = '<STATE>-<agent>'. */
export type EngineLogEvent = { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }

/** 생성 도중 발견된 노드 미리보기 스트림 — Knowledge 탭의 점진적 그래프 표시용. */
export type HarnessNodesEvent = { runId: string; folder: string; nodes: Array<{ id: string; title: string; type: string; scope: string }> }

/** Durable progress is the live event contract too: a sink only receives an event after append succeeds. */
export type HarnessActivitySink = (event: WikiRunEvent) => void | Promise<void>

export type HarnessRunProgress = {
  runId: string
  projectId: string
  summary: WikiProgressSummary
  active: boolean
}

export type HarnessListRunsResult = { ok: true; runs: HarnessRunProgress[] } | { ok: false; reason: string }
export type HarnessGetProgressResult = {
  ok: true
  summary: WikiProgressSummary
  events: WikiRunEvent[]
  active: boolean
} | { ok: false; reason: string }
export type HarnessReadLogResult = {
  ok: true
  content: string
  nextOffset: number
  truncated: boolean
} | { ok: false; reason: string }

type RunnerOptions = {
  runId: string
  projectId: string
  vaultRoot: string
  projectCwd?: string
  onEngineLog?: (event: EngineLogEvent) => void
  engineOptions?: EngineOptions
  workerConcurrency?: number
  onNodes?: (event: HarnessNodesEvent) => void
  ignoreLedger?: boolean
  interactive?: boolean
  domainPack?: DomainPack
  substrate?: WikiSubstrate
  projectContext?: ProjectStructureHint
  onActivity?: HarnessActivitySink
}

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const LOG_RESPONSE_DEFAULT = 64 * 1024
const LOG_RESPONSE_MAX = 256 * 1024
const LOG_SOURCE_MAX = 1024 * 1024

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
  private readonly activeRuns = new Set<string>()
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

  /** Run ids are opaque directory names, never relative paths. */
  private runDir(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`invalid run id: ${runId}`)
    return resolveInside(this.deps.runsRoot, runId)
  }

  private storeFor(runId: string): RunArtifactStore {
    return new RunArtifactStore(this.runDir(runId))
  }

  private stagingDir(runId: string): string {
    return resolveInside(this.runDir(runId), 'vault-staging')
  }

  private runError(runId: string, error: unknown): HarnessRunResult {
    return {
      ok: false,
      runId,
      finalState: 'FAILED',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  private eventDiagnostic(runId: string, onEngineLog: RunnerOptions['onEngineLog'], stage: string, error: unknown): void {
    const chunk = `progress ${stage} failed: ${error instanceof Error ? error.message : String(error)}\n`
    try { onEngineLog?.({ runId, label: 'progress', stream: 'stderr', chunk }) }
    catch { /* a diagnostic callback must never alter a run */ }
  }

  /** Create the durable run envelope before workspace I/O. The real driver runner is built after pull. */
  private initializeRun(
    store: RunArtifactStore,
    input: { runId: string; projectId: string; engine: AgentType },
    onActivity?: HarnessActivitySink,
    onEngineLog?: RunnerOptions['onEngineLog'],
  ): void {
    const bootstrap = new HarnessRunner({
      gates: this.featureGate(),
      drivers: {},
      now: this.now,
      eventSink: onActivity,
      onEventError: ({ stage, error }) => this.eventDiagnostic(input.runId, onEngineLog, stage, error),
    })
    bootstrap.createRun(store, input)
  }

  /** Persist failures that happen before/around HarnessRunner.advance (materialization, lock, wiring). */
  private async failRun(
    store: RunArtifactStore,
    runId: string,
    reason: string,
    onActivity?: HarnessActivitySink,
    onEngineLog?: RunnerOptions['onEngineLog'],
  ): Promise<HarnessRunResult> {
    try {
      const previous = store.loadRunState()
      if (previous.state !== 'FAILED') {
        const at = this.now()
        const failed = RunStateSchema.parse({
          ...previous,
          state: 'FAILED',
          history: [...previous.history, { state: 'FAILED', at }],
          awaiting: undefined,
          error: reason,
        })
        store.saveRunState(failed)
        try {
          const event = await store.appendProgressEvent({
            runId,
            projectId: previous.projectId,
            at,
            kind: 'run_failed',
            message: reason,
          })
          try { await onActivity?.(event) }
          catch (error) { this.eventDiagnostic(runId, onEngineLog, 'sink', error) }
        } catch (error) {
          this.eventDiagnostic(runId, onEngineLog, 'journal', error)
        }
      }
    } catch (error) {
      this.eventDiagnostic(runId, onEngineLog, 'journal', error)
    }
    return { ok: false, runId, finalState: 'FAILED', reason }
  }

  /** Reconcile the user's final selection against discovered nodes before deterministic resume. */
  private async recordNodeConfirmation(
    store: RunArtifactStore,
    runId: string,
    approved: KhApprovedNodes,
    onActivity?: HarnessActivitySink,
  ): Promise<void> {
    try {
      const state = store.loadRunState()
      const nodes = this.progressSummary(store)?.nodes ?? []
      const accepted = new Set(approved.nodes.flatMap((node) => [node.source_proposal_id, node.id].filter(Boolean)))
      for (const node of nodes) {
        const event = await store.appendProgressEvent({
          runId,
          projectId: state.projectId,
          at: this.now(),
          kind: accepted.has(node.proposalId) ? 'node_accepted' : 'node_dropped',
          workerId: node.workerId,
          proposalId: node.proposalId,
          title: node.title,
          nodeType: node.nodeType,
          sourceFolder: node.sourceFolder,
        })
        try { await onActivity?.(event) }
        catch (error) { this.eventDiagnostic(runId, undefined, 'sink', error) }
      }
    } catch (error) {
      // Confirmation itself is authoritative in approved-nodes.json; replay enrichment is diagnostic-only.
      this.eventDiagnostic(runId, undefined, 'journal', error)
    }
  }

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
    try { return this.storeFor(runId).loadRunState().projectId }
    catch { return '' }
  }

  /** Build a runner bound to one run dir (drivers close over that run's staging dir + a per-project lock).
   * 모든 엔진 호출은 LoggingAgentRunner를 거쳐 runs/<id>/logs/에 영속되고(성공·실패 불문),
   * onEngineLog가 주어지면 출력 chunk가 도착 즉시 콜백으로도 흐른다. */
  private runnerFor(options: RunnerOptions): HarnessRunner {
    const {
      runId, projectId, vaultRoot, projectCwd, onEngineLog, engineOptions, workerConcurrency,
      onNodes, ignoreLedger, interactive, domainPack, substrate, projectContext, onActivity,
    } = options
    const logging = new LoggingAgentRunner(this.deps.runner, resolveInside(this.runDir(runId), 'logs'))
    const runner: AgentRunner = !onEngineLog ? logging : {
      run: (i) => logging.run({
        ...i,
        onChunk: (stream, text) => {
          i.onChunk?.(stream, text)
          onEngineLog({ runId, label: i.label ?? i.agent, stream, chunk: text })
        },
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
      projectContext,
      now: this.now,
      // Forward each folder worker's nodes to the live stream, stamped with this run's id.
      onNodesDiscovered: onNodes ? (ev) => onNodes({ runId, folder: ev.folder, nodes: ev.nodes }) : undefined,
      domainPack,
      substrate,
    })
    const lock = new RunLock(join(this.deps.runsRoot, '.locks'), projectId)
    return new HarnessRunner({
      gates: this.featureGate(),
      drivers,
      now: this.now,
      lock,
      eventSink: onActivity,
      onEventError: ({ stage, error }) => this.eventDiagnostic(runId, onEngineLog, stage, error),
    })
  }

  /** advance() the run, mapping a thrown lock-contention error to a structured failure result. */
  private async advanceSafely(
    runId: string,
    runner: HarnessRunner,
    store: RunArtifactStore,
    onProgress?: (rs: RunState) => void,
    onActivity?: HarnessActivitySink,
    onEngineLog?: RunnerOptions['onEngineLog'],
  ): Promise<HarnessRunResult> {
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
      return this.failRun(store, runId, reason, onActivity, onEngineLog)
    }
  }

  async run(
    input: { projectId: string; engine: AgentType; materialize?: boolean; repoPaths?: string[]; engineOptions?: EngineOptions; workerConcurrency?: number; fullRegen?: boolean; interactive?: boolean; domain?: DomainId; projectContext?: ProjectStructureHint },
    onProgress?: (rs: RunState) => void,
    onEngineLog?: (event: EngineLogEvent) => void,
    onNodes?: (event: HarnessNodesEvent) => void,
    onActivity?: HarnessActivitySink,
  ): Promise<HarnessRunResult> {
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
    let store: RunArtifactStore
    try { store = this.storeFor(runId) }
    catch (error) { return this.runError(runId, error) }

    const log = (chunk: string, stream: EngineLogEvent['stream'] = 'stdout') => {
      try { onEngineLog?.({ runId, label: 'workspace', stream, chunk }) }
      catch { /* renderer live-tail failure must not alter the durable run */ }
    }
    const pack = resolveDomainPack(input.domain)
    let wv: WorkspaceVault | undefined

    // Mark active before createRun: a synchronous run_started subscriber can immediately query `active`.
    this.activeRuns.add(runId)
    try {
      this.initializeRun(store, { runId, projectId: input.projectId, engine: input.engine }, onActivity, onEngineLog)
    } catch (error) {
      this.activeRuns.delete(runId)
      return this.runError(runId, error)
    }

    let result: HarnessRunResult
    try {
      wv = this.vaultFor(input.projectId)
      log(`domain: ${pack.id}\n`)
      // The journal already exists when pull begins, so a crash or early setup failure remains replayable.
      try { await wv.pull() }
      catch (error) { log(`pull failed: ${String(error)}\n`, 'stderr') }
      const vaultRoot = wv.localRoot
      this.ensureVaultGitignore(vaultRoot)

      // SSH projects MUST materialize every run: raw/ is derived state and is not synced.
      const sshRepoPath = input.repoPaths?.find((path) => path.startsWith('ssh://'))
      const doMaterialize = (input.materialize || !!sshRepoPath) && !!input.repoPaths?.length
      if (sshRepoPath && !input.materialize) {
        log('ssh project — forcing full materialize (raw/ is not persisted for ssh).\n')
      }

      if (doMaterialize && input.repoPaths?.length) {
        const docs = await materializeProjectDocs(input.repoPaths, vaultRoot, {
          fetchRemoteDocs: this.deps.fetchRemoteDocs,
        })
        log(`project-docs: ${docs.files.length} file(s) materialized (scanned ${docs.scanned}).` +
          (docs.skipped.length ? ` skipped ${docs.skipped.length}: ${docs.skipped.slice(0, 5).join(' | ')}` : '') + '\n')

        let convAdapters = this.deps.conversationAdapters ?? []
        if (sshRepoPath) {
          convAdapters = []
          if (this.deps.remoteConversationFetcher) {
            try {
              convAdapters = await this.deps.remoteConversationFetcher(
                sshRepoPath,
                join(this.deps.runsRoot, '.remote-conv'),
              )
            } catch (error) {
              log(`conversations: remote fetch failed: ${String(error)}\n`)
            }
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

      // Prefer the selected project's structured-document runtime, then the dashboard's dev runtime.
      const substrate = buildVenvSubstrate(input.repoPaths?.[0] ?? '') ?? buildVenvSubstrate(process.cwd())
      const runner = this.runnerFor({
        runId,
        projectId: input.projectId,
        vaultRoot,
        projectCwd: input.repoPaths?.[0],
        onEngineLog,
        engineOptions: input.engineOptions,
        workerConcurrency: input.workerConcurrency,
        onNodes,
        ignoreLedger: input.fullRegen,
        interactive: input.interactive,
        domainPack: pack,
        substrate,
        projectContext: input.projectContext,
        onActivity,
      })
      result = await this.advanceSafely(runId, runner, store, onProgress, onActivity, onEngineLog)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      result = await this.failRun(store, runId, reason, onActivity, onEngineLog)
    }

    try {
      // Failed runs are particularly useful for diagnosis, so transcript persistence is best-effort for all outcomes.
      if (wv) {
        this.persistTranscript(runId, input.projectId, result.finalState, wv)
        if (result.finalState !== 'FAILED') {
          await wv.pushInternal()
          log('internal state synced to workspace.\n')
        } else {
          await wv.pushRuns()
        }
      }
    } catch (error) {
      log(`push failed: ${String(error)}\n`, 'stderr')
    } finally {
      this.activeRuns.delete(runId)
    }
    return result
  }

  /** Resume an existing run from its persisted state — e.g. after a paused gate is reopened. Re-reads
   * the gates file, so a previously-closed gate that is now open lets the walk continue. (Acceptance #6.) */
  async resume(input: { runId: string }, onActivity?: HarnessActivitySink): Promise<HarnessRunResult> {
    let store: RunArtifactStore
    try { store = this.storeFor(input.runId) }
    catch (error) { return this.runError(input.runId, error) }
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
    this.activeRuns.add(input.runId)
    let result: HarnessRunResult
    try {
      const wv = this.vaultFor(prev.projectId)
      try { await wv.pull() } catch { /* best-effort; the local working copy still holds the run's state */ }
      const runner = this.runnerFor({
        runId: input.runId,
        projectId: prev.projectId,
        vaultRoot: wv.localRoot,
        onActivity,
      })
      result = await this.advanceSafely(input.runId, runner, store, undefined, onActivity)
      this.persistTranscript(input.runId, prev.projectId, result.finalState, wv)
      try {
        if (result.finalState !== 'FAILED') { await wv.pushInternal() }
        else { await wv.pushRuns() }
      } catch { /* non-fatal */ }
    } catch (error) {
      result = await this.failRun(
        store,
        input.runId,
        error instanceof Error ? error.message : String(error),
        onActivity,
      )
    } finally {
      this.activeRuns.delete(input.runId)
    }
    return result
  }

  /** 사용자가 확정한 노드 목록을 LEAD_MERGED 키 아티팩트로 저장하고(artifactByName이 찾도록 인덱스에도 추가),
   *  run을 재개한다. LEAD_MERGED는 재개 시 재실행되지 않아 인덱스가 안정적이다. */
  async confirmNodes(input: { runId: string; approvedNodes: KhApprovedNodes }, onActivity?: HarnessActivitySink): Promise<HarnessRunResult> {
    let store: RunArtifactStore
    try { store = this.storeFor(input.runId) }
    catch (error) { return this.runError(input.runId, error) }
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
    await this.recordNodeConfirmation(store, input.runId, approved, onActivity)
    return this.resume({ runId: input.runId }, onActivity)
  }

  show(input: { runId: string }): { ok: true; runState: RunState; artifacts: Array<{ state: RunState['state']; name: string; path: string; data: unknown }> } | { ok: false; reason: string } {
    let store: RunArtifactStore
    try { store = this.storeFor(input.runId) }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
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

  /** Project-scoped, newest-first replay index. A malformed historic run is skipped, not fatal. */
  listRuns(input: { projectId: string; limit?: number }): HarnessListRunsResult {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200)
    let entries: string[]
    try { entries = readdirSync(this.deps.runsRoot).filter((entry) => RUN_ID_PATTERN.test(entry)) }
    catch { return { ok: true, runs: [] } }

    const runs: HarnessRunProgress[] = []
    for (const runId of entries) {
      try {
        const store = this.storeFor(runId)
        if (!store.exists()) continue
        const state = store.loadRunState()
        if (state.projectId !== input.projectId) continue
        const summary = this.progressSummary(store)
        if (!summary) continue
        const active = this.activeRuns.has(runId)
        runs.push({ runId, projectId: state.projectId, summary: this.visibleSummary(summary, active), active })
      } catch { /* one corrupt legacy run must not hide the rest of the history */ }
    }
    runs.sort((left, right) => {
      const byStarted = right.summary.startedAt.localeCompare(left.summary.startedAt)
      return byStarted || right.runId.localeCompare(left.runId)
    })
    return { ok: true, runs: runs.slice(0, limit) }
  }

  /** Returns the persisted snapshot plus journal so renderer replay never depends on localStorage. */
  getProgress(input: { runId: string }): HarnessGetProgressResult {
    let store: RunArtifactStore
    try { store = this.storeFor(input.runId) }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    try {
      const events = store.readProgressEvents()
      const summary = this.progressSummary(store)
      if (!summary) return { ok: false, reason: `progress not found: ${input.runId}` }
      const active = this.activeRuns.has(input.runId)
      return { ok: true, summary: this.visibleSummary(summary, active), events, active }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Lazy, output-only engine log reader. prompt.txt/meta.json are intentionally excluded. */
  readLog(input: { runId: string; offset?: number; limit?: number }): HarnessReadLogResult {
    let runDir: string
    try { runDir = this.runDir(input.runId) }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
    if (!existsSync(join(runDir, 'run.json'))) return { ok: false, reason: `run not found: ${input.runId}` }

    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? LOG_RESPONSE_DEFAULT), 1), LOG_RESPONSE_MAX)
    try {
      const source = this.readOutputLogs(runDir)
      const content = source.text.slice(offset, offset + limit)
      const nextOffset = offset + content.length
      return {
        ok: true,
        content,
        nextOffset,
        truncated: source.sourceTruncated || nextOffset < source.text.length,
      }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private progressSummary(store: RunArtifactStore): WikiProgressSummary | undefined {
    try { return store.loadProgressSummary() ?? store.rebuildProgressSummary() }
    catch { return store.rebuildProgressSummary() }
  }

  private visibleSummary(summary: WikiProgressSummary, active: boolean): WikiProgressSummary {
    const terminal = summary.status === 'completed' || summary.status === 'failed'
    return !active && !terminal ? { ...summary, health: 'interrupted' } : summary
  }

  private readOutputLogs(runDir: string): { text: string; sourceTruncated: boolean } {
    const logsRoot = resolveInside(runDir, 'logs')
    if (!existsSync(logsRoot)) return { text: '', sourceTruncated: false }

    const files: Array<{ abs: string; rel: string }> = []
    const visit = (dir: string, relDir = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = relDir ? join(relDir, entry.name) : entry.name
        const abs = resolveInside(logsRoot, rel)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) visit(abs, rel)
        else if (entry.isFile() && /(?:^|[\\/])(stdout|stderr)\.log$/.test(rel)) files.push({ abs, rel })
      }
    }
    visit(logsRoot)
    files.sort((left, right) => left.rel.localeCompare(right.rel))

    let text = ''
    let remaining = LOG_SOURCE_MAX
    let sourceTruncated = false
    for (const file of files) {
      const header = `${text ? '\n' : ''}== ${file.rel.replaceAll('\\', '/')} ==\n`
      if (header.length >= remaining) { sourceTruncated = true; break }
      text += header
      remaining -= header.length

      const stat = lstatSync(file.abs)
      const bytesToRead = Math.min(stat.size, remaining)
      const buffer = Buffer.alloc(bytesToRead)
      const fd = openSync(file.abs, 'r')
      let bytesRead = 0
      try {
        while (bytesRead < bytesToRead) {
          const read = readSync(fd, buffer, bytesRead, bytesToRead - bytesRead, bytesRead)
          if (read === 0) break
          bytesRead += read
        }
      } finally {
        closeSync(fd)
      }
      text += buffer.subarray(0, bytesRead).toString('utf8')
      remaining = LOG_SOURCE_MAX - text.length
      if (stat.size > bytesRead || remaining <= 0) { sourceTruncated = true; break }
    }
    return { text, sourceTruncated }
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
        const store = this.storeFor(d)
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

  /** Read a paper run's typed knowledge-graph edges from vault-staging/wiki/graph/edges.jsonl (one JSON
   * object per line — the kernel's edge_storage). Empty for project-docs runs (no such file). The graph
   * view draws these so the rendered graph is autosci's actual knowledge graph. Never throws. */
  readGraphEdges(input: { runId: string }): { edges: Array<{ from: string; to: string; type: string } & Record<string, unknown>> } {
    let abs: string
    try {
      abs = resolveInside(this.deps.runsRoot, join(input.runId, 'vault-staging', 'wiki', 'graph', 'edges.jsonl'))
    } catch { return { edges: [] } }
    if (!existsSync(abs)) return { edges: [] }
    try {
      const edges: Array<{ from: string; to: string; type: string } & Record<string, unknown>> = []
      for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const e = JSON.parse(trimmed)
          if (e && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.type === 'string') edges.push(e)
        } catch { /* skip a malformed line rather than failing the whole read */ }
      }
      return { edges }
    } catch { return { edges: [] } }
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
      const store = this.storeFor(runId)
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
