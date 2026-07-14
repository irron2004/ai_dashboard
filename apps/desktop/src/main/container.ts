import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, ProjectRegistry, IngestCursorStore } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore, ReviewService, VaultWriter, validateBlockedBy, NextNoteStore, QuestionLogStore } from '@apc/pm'
import { migrateHarness, TaskProfileStore } from '@apc/harness'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval, ProcessedSourceStore } from '@apc/knowledge'
import { SearchIndex } from '@apc/search'
import { VaultAdapter } from '@apc/vault'
import { getProjectDashboard, buildWorkspaceOverview, buildResumeCard, type WorkspaceOverview, type ResumeCard } from '@apc/dashboard-api'
import { IngestService, RunService, GenerateService, HarnessService, DevHarnessService, DevHarnessCli, KnowledgeIndexer, LocalWorkspaceVault, GitSyncService, type WorkspaceVault, extractTasks, reconcileSessionTasks, makeSessionSummarizer, composeContextPackage, type WikiExcerpt } from '@apc/app-services'
import { WikiEngine, type AgentRunner } from '@apc/llm-wiki'
import { RoutingAgentRunner } from './ssh-agent-runner.js'
import { SshWorkspaceVault } from './remote-vault.js'
import { UnifiedSearch } from './unified-search.js'
import { ClaudeAdapter, CodexAdapter, OpenCodeAdapter, latestSessionDetail, type AgentIngestAdapter } from '@apc/agents'
import { readdirSync, statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { generateRemote } from './remote-generate.js'
import { readProjectWiki } from '@apc/graph-view/node'
import { fetchRemoteProjectDocs } from './remote-docs.js'
import { fetchRemoteConversations } from './remote-conversations.js'
import { readProjectDoc } from './project-files.js'
import type {
  GeneratePreflightCategory, GeneratePreflightReq, GeneratePreflightRes, GenerateProjectReq, GenerateProjectRes,
  GeneratePreflightCategoryId,
  HarnessRunReq, HarnessRunRes, HarnessResumeReq, HarnessConfirmNodesReq, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
  HarnessPromoteCanonicalReq, HarnessPromoteCanonicalRes, HarnessCanonicalProposalsReq, HarnessCanonicalProposalsRes,
  HarnessProposePolicyReq, HarnessProposePolicyRes, HarnessApprovePolicyReq, HarnessApprovePolicyRes,
  HarnessGetPolicyReq, HarnessGetPolicyRes, HarnessRevertPolicyReq, HarnessRevertPolicyRes,
  HarnessReadStagedDocReq, HarnessReadStagedDocRes, HarnessListStagedDocsReq, HarnessListStagedDocsRes,
  HarnessReadGraphEdgesReq, HarnessReadGraphEdgesRes,
  HarnessExportWikiReq, HarnessExportWikiRes,
  DevHarnessRunReq, DevHarnessRunRes, DevHarnessCancelReq, DevHarnessCancelRes, DevHarnessLogEvent,
  ReadProjectWikiReq, ReadProjectWikiRes,
  HarnessEngineLogEvent, HarnessNodesEvent,
  SearchReq,
  TaskSetBlockedByReq, TaskSetBlockedByRes,
  ComposeContextReq, ComposeContextRes,
  DevHarnessStartedEvent,
  DevHarnessReadTranscriptReq, DevHarnessReadTranscriptRes,
  ResumeCardReq, QuestionLogReq, NextNoteAddReq, NextNoteAddRes, NextNoteToggleReq, NextNoteDeleteReq, NextNoteMutRes,
} from '../shared/ipc-contract.js'
import type { UnifiedSearchResponse, QuestionLogEntry } from '@apc/shared'

/** Coalesces chunks for the same label/stream into 50ms batches so a chatty engine cannot flood the renderer. */
function batchEngineLog(emit?: (e: HarnessEngineLogEvent) => void): ((e: HarnessEngineLogEvent) => void) | undefined {
  if (!emit) return undefined
  let pending = new Map<string, HarnessEngineLogEvent>()
  let timer: ReturnType<typeof setTimeout> | null = null
  return (e) => {
    const key = `${e.label} ${e.stream}`
    const prev = pending.get(key)
    if (prev) prev.chunk += e.chunk
    else pending.set(key, { ...e })
    if (!timer) {
      timer = setTimeout(() => {
        const batch = [...pending.values()]; pending = new Map(); timer = null
        for (const ev of batch) emit(ev)
      }, 50)
    }
  }
}

export type Container = {
  vaultRoot: string
  db: ReturnType<typeof openDb>
  registry: ProjectRegistry
  tasks: TaskStore
  runs: AgentRunStore
  reviews: ReviewService
  cursors: IngestCursorStore
  searchIndex: SearchIndex
  search: (req: SearchReq) => UnifiedSearchResponse
  vault: VaultAdapter
  taskProfiles: TaskProfileStore
  ingest: IngestService
  gitSync: GitSyncService
  ingestAdapters: AgentIngestAdapter[]
  runService: RunService
  generate: GenerateService
  /** Count selectable Generate inputs without parsing sessions or invoking an LLM. */
  generatePreflight: (req: GeneratePreflightReq) => Promise<GeneratePreflightRes>
  /** Branches on project kind: ssh:// → run the engine on the remote; local → GenerateService. */
  generateProject: (req: GenerateProjectReq) => Promise<GenerateProjectRes>
  harness: HarnessService
  harnessRun: (req: HarnessRunReq) => Promise<HarnessRunRes>
  harnessResume: (req: HarnessResumeReq) => Promise<HarnessRunRes>
  harnessConfirmNodes: (req: HarnessConfirmNodesReq) => Promise<HarnessRunRes>
  harnessGetRun: (req: HarnessGetRunReq) => HarnessGetRunRes
  harnessPromote: (req: HarnessPromoteReq) => Promise<HarnessPromoteRes>
  harnessPromoteCanonical: (req: HarnessPromoteCanonicalReq) => Promise<HarnessPromoteCanonicalRes>
  harnessCanonicalProposals: (req: HarnessCanonicalProposalsReq) => HarnessCanonicalProposalsRes
  harnessProposePolicy: (req: HarnessProposePolicyReq) => Promise<HarnessProposePolicyRes>
  harnessApprovePolicy: (req: HarnessApprovePolicyReq) => HarnessApprovePolicyRes
  harnessGetPolicy: (req: HarnessGetPolicyReq) => HarnessGetPolicyRes
  harnessRevertPolicy: (req: HarnessRevertPolicyReq) => HarnessRevertPolicyRes
  harnessReadStagedDoc: (req: HarnessReadStagedDocReq) => HarnessReadStagedDocRes
  harnessListStagedDocs: (req: HarnessListStagedDocsReq) => HarnessListStagedDocsRes
  harnessReadGraphEdges: (req: HarnessReadGraphEdgesReq) => HarnessReadGraphEdgesRes
  harnessExportWiki: (req: HarnessExportWikiReq) => Promise<HarnessExportWikiRes>
  devHarnessRun: (req: DevHarnessRunReq) => Promise<DevHarnessRunRes>
  devHarnessCancel: (req: DevHarnessCancelReq) => DevHarnessCancelRes
  composeContext: (req: ComposeContextReq) => ComposeContextRes
  devHarnessReadTranscript: (req: DevHarnessReadTranscriptReq) => DevHarnessReadTranscriptRes
  readProjectWiki: (req: ReadProjectWikiReq) => ReadProjectWikiRes
  taskSetBlockedBy: (req: TaskSetBlockedByReq) => TaskSetBlockedByRes
  dashboard: typeof getProjectDashboard
  workspaceOverview: () => WorkspaceOverview
  resumeCard: (req: ResumeCardReq) => Promise<ResumeCard | null>
  /** Clears the per-project resumeCard cache (see `resumeCard`). Call after anything that changes what
   *  the card would show: ingest (new sessions/questions/req: tasks) or a nextNote mutation. */
  invalidateResumeCards: () => void
  questionLog: (req: QuestionLogReq) => QuestionLogEntry[]
  nextNoteAdd: (req: NextNoteAddReq) => NextNoteAddRes
  nextNoteToggle: (req: NextNoteToggleReq) => NextNoteMutRes
  nextNoteDelete: (req: NextNoteDeleteReq) => NextNoteMutRes
}

let _idCounter = 0
function nextId(): string {
  return `auto-${Date.now()}-${++_idCounter}`
}

const COMPOSE_WIKI_MAX_FILES = 6
const COMPOSE_EXCERPT_CAP = 512
/** Strip a leading YAML frontmatter block (LF or CRLF), then cap to COMPOSE_EXCERPT_CAP bytes. */
function capExcerpt(raw: string): string {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  return body.length > COMPOSE_EXCERPT_CAP ? body.slice(0, COMPOSE_EXCERPT_CAP) + '…' : body
}

/** Returns true iff `candidate` resolves to a path inside `root` (or equal to it). Pure string resolution — no filesystem access, so it works even if `root` does not yet exist. */
function isWithinRoot(root: string, candidate: string): boolean {
  const r = resolve(root)
  const c = resolve(candidate)
  return c === r || c.startsWith(r + sep)
}

const TRANSCRIPT_CAP = 512 * 1024

const PREFLIGHT_MARKDOWN_SCAN_LIMIT = 2_000
const PREFLIGHT_MARKDOWN_DEPTH_LIMIT = 12
const REQUIRED_GENERATE_PREFLIGHT_CATEGORIES: GeneratePreflightCategoryId[] = ['agent-conversations']

function countMarkdownFiles(roots: readonly string[]): number {
  const seen = new Set<string>()
  const visit = (path: string, depth: number): void => {
    if (seen.size >= PREFLIGHT_MARKDOWN_SCAN_LIMIT || depth > PREFLIGHT_MARKDOWN_DEPTH_LIMIT) return
    let st: import('node:fs').Stats | undefined
    try { st = statSync(path, { throwIfNoEntry: false }) } catch { return }
    if (!st) return
    if (st.isFile()) {
      if (/\.mdx?$/i.test(path)) seen.add(path)
      return
    }
    if (!st.isDirectory()) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      visit(join(path, entry.name), depth + 1)
      if (seen.size >= PREFLIGHT_MARKDOWN_SCAN_LIMIT) return
    }
  }
  for (const root of roots) visit(root, 0)
  return seen.size
}

function missingRequiredGenerateCategories(selected: readonly GeneratePreflightCategoryId[] | undefined): GeneratePreflightCategoryId[] {
  if (!selected) return REQUIRED_GENERATE_PREFLIGHT_CATEGORIES
  return REQUIRED_GENERATE_PREFLIGHT_CATEGORIES.filter((category) => !selected.includes(category))
}

export function buildContainer(opts: {
  dbFile: string
  vaultRoot: string
  ingestAdapters?: AgentIngestAdapter[]
  agentRunner?: AgentRunner
  /** runs/ root for harness artifacts; defaults to <vaultRoot>/.harness-runs. */
  harnessRunsRoot?: string
  emitHarnessProgress?: (e: { runId: string; state: string }) => void
  emitHarnessEngineLog?: (e: HarnessEngineLogEvent) => void
  emitDevHarnessLog?: (e: DevHarnessLogEvent) => void
  emitDevHarnessStarted?: (e: DevHarnessStartedEvent) => void
  emitHarnessNodes?: (e: HarnessNodesEvent) => void
}): Container {
  const db = openDb(opts.dbFile)
  migrate(db)
  migratePm(db)
  migrateHarness(db)
  migrateKnowledge(db)

  const searchDb = new DatabaseSync(':memory:')

  const registry = new ProjectRegistry(db)
  const tasks = new TaskStore(db)
  const nextNotes = new NextNoteStore(db)
  const questionLog = new QuestionLogStore(db)
  const runs = new AgentRunStore(db)
  // resumeCard is expensive: latestSessionDetail re-discovers + parses ALL sessions for 3 engines on
  // every call (no incremental cursor). Cache per project; invalidated on ingest + note mutations below.
  const resumeCardCache = new Map<string, ResumeCard | null>()
  const reviews = new ReviewService(db, tasks, nextId)
  const cursors = new IngestCursorStore(db)
  const searchIndex = new SearchIndex(searchDb)
  const knowledgeStore = new KnowledgeStore(db)
  const knowledgeRetrieval = new KnowledgeRetrieval(db)
  const processedSources = new ProcessedSourceStore(db)
  const unifiedSearch = new UnifiedSearch({
    sessions: searchIndex,
    knowledge: knowledgeRetrieval,
    projectIds: () => registry.list().map((p) => p.id),
  })
  const search = (req: SearchReq): UnifiedSearchResponse => unifiedSearch.search(req)
  const vault = new VaultAdapter(opts.vaultRoot)
  const taskProfiles = new TaskProfileStore(db)
  const summarize = makeSessionSummarizer({ runner: opts.agentRunner ?? new RoutingAgentRunner(), engine: 'claude' })
  const ingest = new IngestService({
    registry,
    cursors,
    index: searchIndex,
    questionLog,
    knowledge: new KnowledgeIndexer({ registry, store: knowledgeStore, vaultRoot: opts.vaultRoot }),
    onSessionParsed: async (session, projectId) => {
      if (!projectId) return
      const existing = tasks.get(`req:${projectId}:${session.id}`)
      const { request, todos } = await extractTasks(session, projectId, { summarize, existingTitle: existing?.title })
      reconcileSessionTasks(tasks, projectId, session.id, request, todos)
    },
  })
  const gitSync = new GitSyncService()
  const ingestAdapters =
    opts.ingestAdapters ?? [new ClaudeAdapter(), new CodexAdapter(), new OpenCodeAdapter()]
  const vaultWriter = new VaultWriter(vault)
  const wiki = new WikiEngine(opts.agentRunner ?? new RoutingAgentRunner())
  const runService = new RunService({ wiki, vaultWriter, tasks, runs })
  const generate = new GenerateService({ adapters: ingestAdapters, registry, vault, vaultWriter, wiki })
  const generatePreflight = async (req: GeneratePreflightReq): Promise<GeneratePreflightRes> => {
    const project = registry.get(req.projectId)
    if (!project) return { ok: false, reason: 'project not found' }

    const allTasks = tasks.listByProject(project.id)
    const reviewRuns = allTasks.reduce((count, task) => count + runs.listByTask(task.id).length, 0)
    const vaultRoots = [...project.vaultPaths, join(opts.vaultRoot, 'projects', project.id)]
    const projectDocCount = countMarkdownFiles(vaultRoots)
    const agentSourceCount = await generate.countProjectSources(project.id)

    const categories: GeneratePreflightCategory[] = [
      {
        id: 'agent-conversations',
        label: 'LLM CLI conversations',
        description: 'Recent Claude, OpenCode, and Codex session sources used to build the work summary.',
        count: agentSourceCount,
        selectedByDefault: agentSourceCount > 0,
        required: true,
      },
      {
        id: 'project-docs',
        label: 'Project docs',
        description: 'Markdown documents found in this project vault area and registered vault paths.',
        count: projectDocCount,
        selectedByDefault: projectDocCount > 0,
      },
      {
        id: 'tasks',
        label: 'Tasks',
        description: 'Tracked todo, in-progress, review, and completed tasks for this project.',
        count: allTasks.length,
        selectedByDefault: allTasks.length > 0,
      },
      {
        id: 'review-runs',
        label: 'Agent runs / reviews',
        description: 'Recorded agent runs linked to this project’s tasks.',
        count: reviewRuns,
        selectedByDefault: reviewRuns > 0,
      },
    ]

    return {
      ok: true,
      projectId: project.id,
      projectName: project.name,
      categories,
      totalCount: categories.reduce((sum, category) => sum + category.count, 0),
      status: 'Scanned registered project docs, task metadata, run metadata, and available local agent sources.',
    }
  }
  const generateProject = (req: GenerateProjectReq): Promise<GenerateProjectRes> => {
    const missingRequired = missingRequiredGenerateCategories(req.selectedPreflightCategoryIds)
    if (missingRequired.length > 0) {
      return Promise.resolve({ ok: false, reason: 'Run Generate preflight and keep LLM CLI conversations selected for the current workflow.' })
    }
    const project = registry.get(req.projectId)
    if (project?.repoPaths[0]?.startsWith('ssh://')) {
      return generateRemote({ registry, vault, vaultWriter }, req)
    }
    return generate.generateForProject(req)
  }

  // Knowledge Harness — shares the injected AgentRunner (FakeAgentRunner in tests, RoutingAgentRunner in prod:
  // SSH for ssh:// projects, local CliAgentRunner otherwise).
  // runsRoot MUST live OUTSIDE the vault: StagingVault copies the whole vault into <runsRoot>/<id>/vault-staging,
  // so a runs dir nested inside the vault would make cpSync copy a directory into a subdirectory of itself.
  // The wiki's home lives IN each project's workspace: `<repo>/.apc-wiki` (internal state) +
  // `<repo>/wiki` (published). ssh:// projects keep a local working copy under this cache (verification
  // needs local files) that pull/push sync to the remote; local projects use `<repo>/.apc-wiki` directly.
  const workspaceCacheRoot = join(opts.vaultRoot, '..', 'apc-workspace-cache')
  const workspaceVaultFor = (projectId: string): WorkspaceVault | undefined => {
    const repo = registry.get(projectId)?.repoPaths?.[0]
    if (!repo) return undefined
    return repo.startsWith('ssh://')
      ? new SshWorkspaceVault(repo, projectId, workspaceCacheRoot)
      : new LocalWorkspaceVault(repo, projectId)
  }

  const harness = new HarnessService({
    runner: opts.agentRunner ?? new RoutingAgentRunner(),
    vaultRoot: opts.vaultRoot,
    runsRoot: opts.harnessRunsRoot ?? join(opts.vaultRoot, '..', 'apc-harness-runs'),
    workspaceVaultFor,
    // "전 문서로 위키 생성"의 materialize 단계가 이 프로젝트의 에이전트 대화도 Q&A 단위로 청킹하도록.
    conversationAdapters: ingestAdapters,
    // 이미 처리한 소스 문서는 재실행/재요청 시 건너뛰도록(변경된 문서만 재처리). wiki_processed_sources 테이블 기반.
    sourceLedger: processedSources,
    // ssh:// 프로젝트의 문서를 원격에서 raw/로 가져온다(로컬 fs로는 읽을 수 없으므로). 이게 없으면 SSH
    // 프로젝트는 raw/가 비어 EvidenceVerifier가 전부 막힌다.
    fetchRemoteDocs: fetchRemoteProjectDocs,
    // ssh:// 프로젝트면 대화 로그도 원격에서 가져온다(로컬 PC의 ~/.claude 등을 읽지 않도록).
    remoteConversationFetcher: fetchRemoteConversations,
  })
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => {
    const project = registry.get(req.projectId)
    return harness.run(
      { projectId: req.projectId, engine: req.engine, materialize: req.materialize, repoPaths: project?.repoPaths ?? [], engineOptions: req.engineOptions, workerConcurrency: req.workerConcurrency, fullRegen: req.fullRegen, interactive: req.interactive, domain: project?.domain, projectContext: req.projectContext },
      (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }),
      batchEngineLog(opts.emitHarnessEngineLog),
      (e) => opts.emitHarnessNodes?.(e),
    )
  }
  const harnessResume = (req: HarnessResumeReq): Promise<HarnessRunRes> => harness.resume(req)
  const harnessConfirmNodes = (req: HarnessConfirmNodesReq): Promise<HarnessRunRes> => harness.confirmNodes(req)
  const harnessGetRun = (req: HarnessGetRunReq): HarnessGetRunRes => harness.show(req)
  // Promote writes into the local working vault; persist it to the workspace so an ssh project's next
  // run (which re-pulls and wipes the working copy) doesn't lose the approved draft. Best-effort — a
  // failed sync leaves the local promote intact, and a later export retries the push.
  const harnessPromote = async (req: HarnessPromoteReq): Promise<HarnessPromoteRes> => {
    const r = harness.promote(req)
    if (r.ok) { try { await harness.syncWorkspaceForRun(req.runId) } catch { /* export will retry */ } }
    return r
  }
  const harnessPromoteCanonical = async (req: HarnessPromoteCanonicalReq): Promise<HarnessPromoteCanonicalRes> => {
    const r = harness.promoteCanonical(req)
    if (r.ok) { try { await harness.syncWorkspaceForRun(req.runId) } catch { /* export will retry */ } }
    return r
  }
  const harnessCanonicalProposals = (req: HarnessCanonicalProposalsReq): HarnessCanonicalProposalsRes => harness.canonicalProposals(req)
  const harnessProposePolicy = (req: HarnessProposePolicyReq): Promise<HarnessProposePolicyRes> => harness.proposeWikiPolicy(req)
  const harnessApprovePolicy = (req: HarnessApprovePolicyReq): HarnessApprovePolicyRes => harness.approveWikiPolicy(req)
  const harnessGetPolicy = (req: HarnessGetPolicyReq): HarnessGetPolicyRes => harness.getWikiPolicy(req)
  const harnessRevertPolicy = (req: HarnessRevertPolicyReq): HarnessRevertPolicyRes => harness.revertWikiPolicy(req)
  const harnessReadStagedDoc = (req: HarnessReadStagedDocReq): HarnessReadStagedDocRes => harness.readStagedDoc(req)
  const harnessListStagedDocs = (req: HarnessListStagedDocsReq): HarnessListStagedDocsRes => harness.listStagedDocs(req)
  const harnessReadGraphEdges = (req: HarnessReadGraphEdgesReq): HarnessReadGraphEdgesRes => harness.readGraphEdges(req)
  const harnessExportWiki = (req: HarnessExportWikiReq): Promise<HarnessExportWikiRes> => harness.exportWiki(req)

  // dev-harness (S3): drives the multi-agent coding harness via the CLI contract, recording runs in
  // AgentRunStore and streaming logs. Independent of the wiki HarnessService above.
  // Extract to a const so devHarnessReadTranscript's containment guard uses the same root.
  const devHarnessRunsRoot = opts.harnessRunsRoot ?? join(opts.vaultRoot, '..', 'apc-harness-runs')
  const devHarness = new DevHarnessService({
    cli: new DevHarnessCli(),
    runs,
    registry,
    runsRoot: devHarnessRunsRoot,
  })
  const devHarnessRun = (req: DevHarnessRunReq): Promise<DevHarnessRunRes> =>
    devHarness.run(
      req,
      opts.emitDevHarnessLog ? (e) => opts.emitDevHarnessLog!(e) : undefined,
      opts.emitDevHarnessStarted ? (e) => opts.emitDevHarnessStarted!(e) : undefined,
    )
  const devHarnessCancel = (req: DevHarnessCancelReq): DevHarnessCancelRes => devHarness.cancel(req)

  const composeContext = (req: ComposeContextReq): ComposeContextRes => {
    const project = registry.get(req.projectId)
    if (!project) return { ok: false, reason: 'project not found' }
    const task = tasks.get(req.taskId)
    if (!task || task.projectId !== req.projectId) return { ok: false, reason: 'task not found' }
    const allTasks = tasks.listByProject(project.id)
    // Wiki excerpts: reuse the realpath-guarded, size-capped reader (md/mdx/txt only; other links skipped).
    const roots = [join(opts.vaultRoot, 'projects', project.id), ...project.repoPaths, ...project.vaultPaths]
    const wikiExcerpts: WikiExcerpt[] = []
    for (const rel of task.linkedWikiPages.slice(0, COMPOSE_WIKI_MAX_FILES)) {
      const r = readProjectDoc(roots, rel)
      if (r.ok) wikiExcerpts.push({ path: rel, excerpt: capExcerpt(r.content) })
    }
    // MVP session summary: latest run for this task that has a stored summary doc (see plan notes).
    let sessionSummary: string | undefined
    const withSummary = runs.listByTask(task.id).find((run) => run.summaryPath)
    if (withSummary?.summaryPath) {
      const summaryFull = join(opts.vaultRoot, withSummary.summaryPath)
      if (isWithinRoot(opts.vaultRoot, summaryFull)) {
        try { sessionSummary = capExcerpt(readFileSync(summaryFull, 'utf8')) }
        catch { /* summary unreadable → omit */ }
      }
      // path escapes vaultRoot → skip silently (defence in depth; no error surfaced to caller)
    }
    return { ok: true, prompt: composeContextPackage({ task, allTasks, wikiExcerpts, sessionSummary }) }
  }

  const devHarnessReadTranscript = (req: DevHarnessReadTranscriptReq): DevHarnessReadTranscriptRes => {
    const run = runs.get(req.runId)
    if (!run?.transcriptPath) return { ok: false, reason: 'transcript not found' }
    // Containment guard: transcriptPath must live inside devHarnessRunsRoot (defence in depth).
    if (!isWithinRoot(devHarnessRunsRoot, run.transcriptPath)) return { ok: false, reason: 'transcript not found' }
    try {
      const st = statSync(run.transcriptPath)
      if (!st.isFile()) return { ok: false, reason: 'transcript not found' }
      if (st.size <= TRANSCRIPT_CAP) return { ok: true, content: readFileSync(run.transcriptPath, 'utf8') }
      // Oversized transcript: show the last TRANSCRIPT_CAP bytes (most recent output).
      const fd = openSync(run.transcriptPath, 'r')
      try {
        const buf = Buffer.alloc(TRANSCRIPT_CAP)
        readSync(fd, buf, 0, TRANSCRIPT_CAP, st.size - TRANSCRIPT_CAP)
        return { ok: true, content: `…(잘림 · 마지막 ${TRANSCRIPT_CAP / 1024}KB)\n` + buf.toString('utf8') }
      } finally { closeSync(fd) }
    } catch { return { ok: false, reason: 'transcript not found' } }
  }

  const readProjectWikiQuery = (req: ReadProjectWikiReq): ReadProjectWikiRes => {
    const project = registry.get(req.projectId)
    return readProjectWiki(project?.repoPaths ?? [], project?.vaultPaths ?? [])
  }

  const taskSetBlockedBy = (req: TaskSetBlockedByReq): TaskSetBlockedByRes => {
    const check = validateBlockedBy((id) => tasks.get(id), req.taskId, req.blockedBy)
    if (!check.ok) return { ok: false, reason: check.reason }
    tasks.setBlockedBy(req.taskId, req.blockedBy)
    return { ok: true }
  }

  return {
    vaultRoot: opts.vaultRoot,
    db, registry, tasks, runs, reviews, cursors, searchIndex, search, vault, taskProfiles,
    ingest, gitSync, ingestAdapters, runService, generate, generatePreflight, generateProject,
    harness, harnessRun, harnessResume, harnessConfirmNodes, harnessGetRun, harnessPromote, harnessPromoteCanonical, harnessCanonicalProposals,
    harnessProposePolicy, harnessApprovePolicy, harnessGetPolicy, harnessRevertPolicy, harnessReadStagedDoc, harnessListStagedDocs, harnessReadGraphEdges, harnessExportWiki,
    devHarnessRun, devHarnessCancel, composeContext, devHarnessReadTranscript,
    readProjectWiki: readProjectWikiQuery,
    taskSetBlockedBy,
    dashboard: getProjectDashboard,
    workspaceOverview: () => buildWorkspaceOverview({ registry, tasks, runs, nextNotes }),
    resumeCard: async (req) => {
      if (resumeCardCache.has(req.projectId)) return resumeCardCache.get(req.projectId)!
      const card = await buildResumeCard({
        registry, tasks, nextNotes,
        latestSession: async (repoPath) => {
          const found = await latestSessionDetail(['claude', 'codex', 'opencode'], repoPath)
          if (!found) return null
          const lastUser = [...found.session.turns].reverse().find((t) => t.role === 'user' && t.text.trim())
          return {
            agent: found.agent,
            sessionId: found.session.id,
            lastUserTurn: lastUser ? { text: lastUser.text, ts: lastUser.timestamp ?? found.session.startedAt ?? '' } : undefined,
          }
        },
      }, req.projectId)
      resumeCardCache.set(req.projectId, card)
      return card
    },
    invalidateResumeCards: () => resumeCardCache.clear(),
    questionLog: (req) => questionLog.listRecent(req),
    // nextNotes are embedded in resumeCard; clear the whole cache rather than tracking projectId from
    // the note id (toggle/delete only have the note id, format note:${projectId}:${ISO}:${rand}) — cache
    // is cheap to rebuild, so correctness over a micro-optimized single-project invalidation.
    nextNoteAdd: (req) => { const note = nextNotes.add(req.projectId, req.text); resumeCardCache.clear(); return { ok: true, note } },
    nextNoteToggle: (req) => { nextNotes.toggleDone(req.id, req.done); resumeCardCache.clear(); return { ok: true } },
    nextNoteDelete: (req) => { nextNotes.delete(req.id); resumeCardCache.clear(); return { ok: true } },
  }
}
