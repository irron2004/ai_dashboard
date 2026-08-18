import { openDb, migrate, ProjectRegistry, IngestCursorStore } from '@apc/core'
import {
  migratePm,
  TaskStore,
  TaskCommandService,
  AgentRunStore,
  AgentActivityStore,
  ReviewService,
  VaultWriter,
  validateBlockedBy,
  NextNoteStore,
  NoteTaskService,
  QuestionLogStore,
  ReceiptStore,
  RetroStore,
  NextYmlStore,
  NextYmlStoreError,
} from '@apc/pm'
import { migrateHarness, TaskProfileStore } from '@apc/harness'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval, ProcessedSourceStore } from '@apc/knowledge'
import { SearchIndex } from '@apc/search'
import {
  EvidenceSourceResolver,
  KnowledgeFtsRetriever,
  RetrievalService,
  RetrievalUnavailableError,
  SessionFtsRetriever,
} from '@apc/retrieval'
import { VaultAdapter } from '@apc/vault'
import { getProjectDashboard, buildWorkspaceOverview, buildResumeCard, type WorkspaceOverview, type ResumeCard } from '@apc/dashboard-api'
import { IngestService, RunService, GenerateService, HarnessService, DevHarnessService, DevHarnessCli, KnowledgeIndexer, LocalWorkspaceVault, GitSyncService, GateService, RetroService, type WorkspaceVault, extractTasks, reconcileSessionTasks, makeSessionSummarizer, buildTaskRetrievalQuery, composeContextPackage, type ContextRetrievalDiagnostic, type WikiExcerpt } from '@apc/app-services'
import { WikiEngine, type AgentRunner } from '@apc/llm-wiki'
import { RoutingAgentRunner } from './ssh-agent-runner.js'
import { SshWorkspaceVault } from './remote-vault.js'
import { UnifiedSearch } from './unified-search.js'
import {
  ClaudeAdapter,
  CodexAdapter,
  OpenCodeAdapter,
  latestSessionDetail,
  type AgentIngestAdapter,
} from '@apc/agents'
import { readdirSync, statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { generateRemote } from './remote-generate.js'
import { readProjectWiki } from '@apc/graph-view/node'
import { fetchRemoteProjectDocs } from './remote-docs.js'
import { fetchRemoteConversations } from './remote-conversations.js'
import { fetchWslConversations, toWslProjectTarget } from './wsl-conversations.js'
import { readProjectDoc } from './project-files.js'
import {
  CONVERSATION_HISTORY_RECENT_WINDOW_MS,
  latestConversationQuestion,
  loadConversationHistory,
} from './conversation-history.js'
import { AgentRuntimeCoordinator } from './agent-runtime-coordinator.js'
import { LiveQuestionService } from './live-question-service.js'
import { LocalFilePreviewService } from './file-preview.js'
import { RemoteFilePreviewService } from './remote-file-preview.js'
import { listGitWorktrees } from './git-worktrees.js'
import { buildPtyEnvironment, localPtyEnvironmentKind } from './pty-environment.js'
import { parseSsh, sshExec, type SshExec } from './ssh-exec.js'
import type {
  GeneratePreflightCategory, GeneratePreflightReq, GeneratePreflightRes, GenerateProjectReq, GenerateProjectRes,
  GeneratePreflightCategoryId,
  HarnessRunReq, HarnessRunRes, HarnessResumeReq, HarnessConfirmNodesReq, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
  HarnessPromoteCanonicalReq, HarnessPromoteCanonicalRes, HarnessCanonicalProposalsReq, HarnessCanonicalProposalsRes,
  HarnessSetReviewDecisionsReq, HarnessSetReviewDecisionsRes,
  HarnessReadSourceExcerptReq, HarnessReadSourceExcerptRes,
  HarnessProposePolicyReq, HarnessProposePolicyRes, HarnessApprovePolicyReq, HarnessApprovePolicyRes,
  HarnessGetPolicyReq, HarnessGetPolicyRes, HarnessRevertPolicyReq, HarnessRevertPolicyRes,
  HarnessReadStagedDocReq, HarnessReadStagedDocRes, HarnessListStagedDocsReq, HarnessListStagedDocsRes,
  HarnessReadGraphEdgesReq, HarnessReadGraphEdgesRes,
  HarnessExportWikiReq, HarnessExportWikiRes,
  DevHarnessRunReq, DevHarnessRunRes, DevHarnessCancelReq, DevHarnessCancelRes, DevHarnessLogEvent,
  ReadProjectWikiReq, ReadProjectWikiRes,
  HarnessEngineLogEvent, HarnessNodesEvent,
  SearchReq, SearchEvidenceReq, SearchEvidenceRes, ResolveEvidenceSourceReq, ResolveEvidenceSourceRes,
  TaskSetBlockedByReq, TaskSetBlockedByRes,
  ComposeContextReq, ComposeContextRes,
  DevHarnessStartedEvent,
  DevHarnessReadTranscriptReq, DevHarnessReadTranscriptRes,
  ResumeCardReq, QuestionLogReq, ConversationHistoryReq, ConversationHistoryRes,
  NextNoteAddReq, NextNoteAddRes, NextNoteToggleReq, NextNoteDeleteReq, NextNoteMutRes,
  NextNotesListReq, NextNotesListRes, NextNoteUpdateReq, NextNoteSetPinnedReq,
  NextNoteSetLifecycleReq, NextNoteConvertToTaskReq, NextNoteMutationRes, NextNoteConvertToTaskRes,
  TaskCreateReq, TaskUpdateReq, TaskDeleteReq, TaskMutRes,
  SubmitReviewReq, SubmitReviewRes,
  NextActionsState, NextActionsDecisionReq, NextActionsDecisionRes, ProjectDashboardRes,
  AgentActivitySnapshotReq, AgentActivitySnapshotRes, AgentQuestionReconcileReq, AgentQuestionReconcileRes,
  HarnessListRunsReq, HarnessListRunsRes, HarnessGetProgressReq, HarnessGetProgressRes,
  HarnessReadLogReq, HarnessReadLogRes,
  FileRefsResolveReq, FileRefsResolveRes, FilePreviewReadReq, FilePreviewReadRes,
  ClipboardReadTextRes, TerminalPreferences, TerminalSetPreferencesReq, TerminalPreferencesRes,
  TerminalDiagnosticsReq, TerminalDiagnosticsRes,
} from '../shared/ipc-contract.js'
import {
  isHumanQuestionText,
  type RetrieverDiagnostic,
  type AgentActivity,
  type Task,
  type UnifiedSearchResponse,
  type QuestionLogEntry,
} from '@apc/shared'

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

function lastHumanUserTurn(turns: { role: string; text: string; timestamp?: string }[]) {
  return [...turns].reverse().find((t) => t.role === 'user' && isHumanQuestionText(t.text))
}

export type Container = {
  vaultRoot: string
  db: ReturnType<typeof openDb>
  registry: ProjectRegistry
  tasks: TaskStore
  taskCommands: TaskCommandService
  nextYml: NextYmlStore
  nextNotes: NextNoteStore
  noteTasks: NoteTaskService
  runs: AgentRunStore
  activityStore: AgentActivityStore
  activityCoordinator: AgentRuntimeCoordinator
  liveQuestions: LiveQuestionService
  reviews: ReviewService
  cursors: IngestCursorStore
  searchIndex: SearchIndex
  retrieval: RetrievalService
  searchEvidence: (req: SearchEvidenceReq) => Promise<SearchEvidenceRes>
  resolveEvidenceSource: (req: ResolveEvidenceSourceReq) => ResolveEvidenceSourceRes
  /** @deprecated Use searchEvidence. */
  search: (req: SearchReq) => Promise<UnifiedSearchResponse>
  vault: VaultAdapter
  taskProfiles: TaskProfileStore
  ingest: IngestService
  gitSync: GitSyncService
  receipts: ReceiptStore
  retroStore: RetroStore
  gate: GateService
  retroService: RetroService
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
  harnessSetReviewDecisions: (req: HarnessSetReviewDecisionsReq) => HarnessSetReviewDecisionsRes
  harnessReadSourceExcerpt: (req: HarnessReadSourceExcerptReq) => HarnessReadSourceExcerptRes
  harnessProposePolicy: (req: HarnessProposePolicyReq) => Promise<HarnessProposePolicyRes>
  harnessApprovePolicy: (req: HarnessApprovePolicyReq) => HarnessApprovePolicyRes
  harnessGetPolicy: (req: HarnessGetPolicyReq) => HarnessGetPolicyRes
  harnessRevertPolicy: (req: HarnessRevertPolicyReq) => HarnessRevertPolicyRes
  harnessReadStagedDoc: (req: HarnessReadStagedDocReq) => HarnessReadStagedDocRes
  harnessListStagedDocs: (req: HarnessListStagedDocsReq) => HarnessListStagedDocsRes
  harnessReadGraphEdges: (req: HarnessReadGraphEdgesReq) => HarnessReadGraphEdgesRes
  harnessExportWiki: (req: HarnessExportWikiReq) => Promise<HarnessExportWikiRes>
  harnessListRuns: (req: HarnessListRunsReq) => HarnessListRunsRes
  harnessGetProgress: (req: HarnessGetProgressReq) => HarnessGetProgressRes
  harnessReadLog: (req: HarnessReadLogReq) => HarnessReadLogRes
  devHarnessRun: (req: DevHarnessRunReq) => Promise<DevHarnessRunRes>
  devHarnessCancel: (req: DevHarnessCancelReq) => DevHarnessCancelRes
  composeContext: (req: ComposeContextReq) => Promise<ComposeContextRes>
  devHarnessReadTranscript: (req: DevHarnessReadTranscriptReq) => DevHarnessReadTranscriptRes
  readProjectWiki: (req: ReadProjectWikiReq) => ReadProjectWikiRes
  taskSetBlockedBy: (req: TaskSetBlockedByReq) => TaskSetBlockedByRes
  listTasks: (projectId: string) => Task[]
  dashboard: (projectId: string) => ProjectDashboardRes
  workspaceOverview: () => WorkspaceOverview
  resumeCard: (req: ResumeCardReq) => Promise<ResumeCard | null>
  /** Clears the per-project resumeCard cache (see `resumeCard`). Call after anything that changes what
   *  the card would show: project/task/note mutations or ingest (new sessions/questions/req: tasks). */
  invalidateResumeCards: (projectId?: string) => void
  questionLog: (req: QuestionLogReq) => QuestionLogEntry[]
  conversationHistory: (req: ConversationHistoryReq) => Promise<ConversationHistoryRes>
  taskCreate: (req: TaskCreateReq) => TaskMutRes
  taskUpdate: (req: TaskUpdateReq) => TaskMutRes
  taskDelete: (req: TaskDeleteReq) => TaskMutRes
  submitReview: (req: SubmitReviewReq) => SubmitReviewRes
  nextActionsApprove: (req: NextActionsDecisionReq) => NextActionsDecisionRes
  nextActionsDiscard: (req: NextActionsDecisionReq) => NextActionsDecisionRes
  nextNoteAdd: (req: NextNoteAddReq) => NextNoteAddRes
  nextNoteToggle: (req: NextNoteToggleReq) => NextNoteMutRes
  nextNoteDelete: (req: NextNoteDeleteReq) => NextNoteMutRes
  nextNotesList: (req: NextNotesListReq) => NextNotesListRes
  nextNoteUpdate: (req: NextNoteUpdateReq) => NextNoteMutationRes
  nextNoteSetPinned: (req: NextNoteSetPinnedReq) => NextNoteMutationRes
  nextNoteSetLifecycle: (req: NextNoteSetLifecycleReq) => NextNoteMutationRes
  nextNoteConvertToTask: (req: NextNoteConvertToTaskReq) => NextNoteConvertToTaskRes
  agentActivitySnapshot: (req: AgentActivitySnapshotReq) => AgentActivitySnapshotRes
  agentQuestionReconcile: (req: AgentQuestionReconcileReq) => Promise<AgentQuestionReconcileRes>
  fileRefsResolve: (req: FileRefsResolveReq) => Promise<FileRefsResolveRes>
  filePreviewRead: (req: FilePreviewReadReq) => Promise<FilePreviewReadRes>
  clipboardReadText: () => ClipboardReadTextRes
  terminalGetPreferences: () => TerminalPreferencesRes
  terminalSetPreferences: (req: TerminalSetPreferencesReq) => TerminalPreferencesRes
  terminalDiagnostics: (req: TerminalDiagnosticsReq) => Promise<TerminalDiagnosticsRes>
}

let _idCounter = 0
function nextId(): string {
  return `auto-${Date.now()}-${++_idCounter}`
}

const COMPOSE_WIKI_MAX_FILES = 6
const COMPOSE_EXCERPT_CAP = 512
const COMPOSE_RETRIEVAL_LIMIT = 12
const PERSISTENT_SESSION_INDEX_MARKER = 'desktop_persistent_session_index_v1'

/**
 * Session FTS used to live in a process-local `:memory:` database while ingest cursors lived on
 * disk. After restart, unchanged sources were therefore skipped and their searchable rows vanished.
 * Mark the storage migration and invalidate only agent-source cursors once so the next ingest
 * rebuilds the durable index. The marker and cursor invalidation commit atomically.
 */
function migratePersistentSessionIndex(db: ReturnType<typeof openDb>): void {
  const completed = db.prepare(
    'SELECT value FROM search_index_meta WHERE key = ?',
  ).get(PERSISTENT_SESSION_INDEX_MARKER) as { value: string } | undefined
  if (completed?.value === 'complete') return

  let begun = false
  try {
    db.exec('BEGIN IMMEDIATE')
    begun = true
    db.prepare(`DELETE FROM ingest_cursors
      WHERE source_id LIKE 'claude:%'
         OR source_id LIKE 'codex:%'
         OR source_id LIKE 'opencode:%'`).run()
    db.prepare(`INSERT INTO search_index_meta (key, value) VALUES (?, 'complete')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(PERSISTENT_SESSION_INDEX_MARKER)
    db.exec('COMMIT')
    begun = false
  } catch (error) {
    if (begun) db.exec('ROLLBACK')
    throw error
  }
}

/** Strip a leading YAML frontmatter block (LF or CRLF), then cap to COMPOSE_EXCERPT_CAP bytes. */
function capExcerpt(raw: string): string {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  return body.length > COMPOSE_EXCERPT_CAP ? body.slice(0, COMPOSE_EXCERPT_CAP) + '…' : body
}

function contextRetrievalDiagnostics(
  diagnostics: readonly RetrieverDiagnostic[],
): ContextRetrievalDiagnostic[] {
  return diagnostics.flatMap((diagnostic) => {
    if (!diagnostic.error) return []
    return [{
      code: diagnostic.error.code,
      retrieverId: diagnostic.id,
      message: diagnostic.error.code === 'invalid-candidate'
        ? '검색 소스가 유효하지 않은 근거를 반환해 제외했습니다.'
        : '검색 소스를 사용할 수 없어 해당 결과를 제외했습니다.',
    }]
  })
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
  emitHarnessActivity?: (e: import('@apc/shared').WikiRunEvent) => void
  emitAgentActivity?: (e: AgentActivity) => void
  emitDevHarnessLog?: (e: DevHarnessLogEvent) => void
  emitDevHarnessStarted?: (e: DevHarnessStartedEvent) => void
  emitHarnessNodes?: (e: HarnessNodesEvent) => void
  remoteConversationFetcher?: typeof fetchRemoteConversations
  wslConversationFetcher?: typeof fetchWslConversations
  readClipboardText?: () => string
  sshExecutor?: SshExec
  now?: () => number
}): Container {
  const db = openDb(opts.dbFile)
  migrate(db)
  migratePm(db)
  migrateHarness(db)
  migrateKnowledge(db)

  const now = opts.now ?? Date.now
  const nowIso = () => new Date(now()).toISOString()

  const registry = new ProjectRegistry(db, nowIso)
  const tasks = new TaskStore(db, nowIso)
  const runs = new AgentRunStore(db)
  const nextYml = new NextYmlStore(registry, tasks, {
    now: () => new Date(now()),
  })
  const readTaskSurface = (projectId: string): { tasks: Task[]; nextActions: NextActionsState } => {
    try {
      const snapshot = nextYml.readProject(projectId)
      if (!snapshot.managed) {
        return { tasks: tasks.listByProject(projectId), nextActions: { mode: 'legacy' } }
      }
      return {
        tasks: snapshot.tasks,
        nextActions: {
          mode: 'managed',
          filePath: snapshot.filePath,
          canonicalUpdated: snapshot.document.updated,
          projectStatus: snapshot.document.status,
          focus: snapshot.document.focus,
          proposal: snapshot.proposal ? {
            proposalHash: snapshot.proposal.proposalHash,
            tasks: snapshot.proposal.tasks,
            conflict: snapshot.proposal.conflict,
          } : undefined,
          error: snapshot.proposalError,
        },
      }
    } catch (error) {
      const reason = error instanceof NextYmlStoreError ? error.code : 'invalid-next-yml'
      return { tasks: [], nextActions: { mode: 'error', reason } }
    }
  }
  const listTasks = (projectId: string): Task[] => readTaskSurface(projectId).tasks
  const findTask = (taskId: string): Task | undefined => {
    for (const project of registry.list()) {
      const found = listTasks(project.id).find((task) => task.id === taskId)
      if (found) return found
    }
    return undefined
  }
  const dashboard = (projectId: string): ProjectDashboardRes => {
    const surface = readTaskSurface(projectId)
    return {
      ...getProjectDashboard({
        registry,
        tasks,
        runs,
        listTasks: () => surface.tasks,
      }, projectId),
      nextActions: surface.nextActions,
    }
  }
  const nextNotes = new NextNoteStore(db, nowIso)
  const questionLog = new QuestionLogStore(db)
  // Resume cards are cached per project. The agents package additionally shares short-lived source listings
  // and size/mtime-keyed JSONL metadata so switching projects does not re-read every transcript prefix.
  const resumeCardCache = new Map<string, ResumeCard | null>()
  const invalidateResumeCards = (projectId?: string): void => {
    if (projectId) resumeCardCache.delete(projectId)
    else resumeCardCache.clear()
  }
  const projectExists = (projectId: string) => Boolean(registry.get(projectId))
  const taskCommands = new TaskCommandService(tasks, projectExists, undefined, nowIso)
  const noteTasks = new NoteTaskService(
    db,
    nextNotes,
    tasks,
    projectExists,
    (projectId, noteId) => `task:${projectId}:note:${noteId}`,
    nowIso,
  )
  const activityStore = new AgentActivityStore(db, nowIso)
  const activityCoordinator = new AgentRuntimeCoordinator(activityStore, {
    now: nowIso,
    emit: opts.emitAgentActivity,
  })
  activityCoordinator.normalizeStartup()
  activityCoordinator.pruneInactive(
    new Date(now() - 30 * 24 * 60 * 60 * 1_000).toISOString(),
    registry.list().map((project) => project.id),
  )
  const liveQuestions = new LiveQuestionService(activityCoordinator, { now: nowIso })
  const reviews = new ReviewService(db, tasks, nextId)
  const cursors = new IngestCursorStore(db)
  const searchIndex = new SearchIndex(db)
  migratePersistentSessionIndex(db)
  const knowledgeStore = new KnowledgeStore(db)
  const knowledgeRetrieval = new KnowledgeRetrieval(db)
  const processedSources = new ProcessedSourceStore(db)
  const retrieval = new RetrievalService({
    registry,
    retrievers: [
      new SessionFtsRetriever(searchIndex),
      new KnowledgeFtsRetriever(knowledgeRetrieval),
    ],
  })
  const unifiedSearch = new UnifiedSearch({
    retrieval,
    projectIds: () => registry.list().map((p) => p.id),
  })
  const searchEvidence = (req: SearchEvidenceReq): Promise<SearchEvidenceRes> =>
    unifiedSearch.searchEvidence(req)
  const search = (req: SearchReq): Promise<UnifiedSearchResponse> => unifiedSearch.search(req)
  const sourceResolver = new EvidenceSourceResolver({
    registry,
    projectRoots: (projectId) => {
      const project = registry.get(projectId)
      if (!project) return []
      return [
        join(opts.vaultRoot, 'projects', projectId),
        ...project.repoPaths.filter((path) => !path.startsWith('ssh://')),
        ...project.vaultPaths.filter((path) => !path.startsWith('ssh://')),
      ]
    },
    knowledge: knowledgeStore,
    sessions: searchIndex,
  })
  const resolveEvidenceSource = (req: ResolveEvidenceSourceReq): ResolveEvidenceSourceRes =>
    sourceResolver.resolve(req)
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
      if (!projectId) return { accepted: true }
      try {
        const fileManaged = nextYml.isManaged(projectId)
        const existing = fileManaged ? undefined : tasks.get(`req:${projectId}:${session.id}`)
        const { request, todos } = await extractTasks(session, projectId, { summarize, existingTitle: existing?.title })
        if (fileManaged) {
          const proposed = nextYml.proposeDerivedTasks(
            projectId,
            [request, ...todos],
            `chat:${session.id}`,
            { replaceSource: true },
          )
          if (!proposed.ok) return { accepted: false }
        } else {
          reconcileSessionTasks(tasks, projectId, session.id, request, todos)
        }
        return { accepted: true }
      } catch {
        return { accepted: false }
      }
    },
  })
  const gitSync = new GitSyncService()
  const receipts = new ReceiptStore(db)
  const retroStore = new RetroStore(db)
  const gate = new GateService()
  const retroService = new RetroService({ registry, gitSync, gate, receipts, retros: retroStore })
  const ingestAdapters =
    opts.ingestAdapters ?? [new ClaudeAdapter(), new CodexAdapter(), new OpenCodeAdapter()]
  const remoteConversationFetcher = opts.remoteConversationFetcher ?? fetchRemoteConversations
  const wslConversationFetcher = opts.wslConversationFetcher ?? fetchWslConversations
  const vaultWriter = new VaultWriter(vault)
  const wiki = new WikiEngine(opts.agentRunner ?? new RoutingAgentRunner())
  const runService = new RunService({
    wiki,
    vaultWriter,
    tasks: {
      updateStatus: (taskId, status, reviewStatus) => {
        const task = findTask(taskId)
        if (task) {
          try {
            if (nextYml.isManaged(task.projectId)) return
          } catch {
            return
          }
        }
        tasks.updateStatus(taskId, status, reviewStatus)
      },
    },
    runs,
  })
  const generate = new GenerateService({ adapters: ingestAdapters, registry, vault, vaultWriter, wiki })
  const generatePreflight = async (req: GeneratePreflightReq): Promise<GeneratePreflightRes> => {
    const project = registry.get(req.projectId)
    if (!project) return { ok: false, reason: 'project not found' }

    const allTasks = listTasks(project.id)
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
    remoteConversationFetcher,
  })
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => {
    const project = registry.get(req.projectId)
    return harness.run(
      { projectId: req.projectId, engine: req.engine, materialize: req.materialize, repoPaths: project?.repoPaths ?? [], engineOptions: req.engineOptions, workerConcurrency: req.workerConcurrency, fullRegen: req.fullRegen, interactive: req.interactive, domain: project?.domain, projectContext: req.projectContext },
      (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }),
      batchEngineLog(opts.emitHarnessEngineLog),
      (e) => opts.emitHarnessNodes?.(e),
      (e) => opts.emitHarnessActivity?.(e),
    )
  }
  const harnessResume = (req: HarnessResumeReq): Promise<HarnessRunRes> => harness.resume(
    req,
    (e) => opts.emitHarnessActivity?.(e),
    (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }),
    batchEngineLog(opts.emitHarnessEngineLog),
    (e) => opts.emitHarnessNodes?.(e),
  )
  const harnessConfirmNodes = (req: HarnessConfirmNodesReq): Promise<HarnessRunRes> => harness.confirmNodes(
    req,
    (e) => opts.emitHarnessActivity?.(e),
    (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }),
    batchEngineLog(opts.emitHarnessEngineLog),
    (e) => opts.emitHarnessNodes?.(e),
  )
  const harnessGetRun = (req: HarnessGetRunReq): HarnessGetRunRes => harness.show(req)
  const harnessListRuns = (req: HarnessListRunsReq): HarnessListRunsRes => harness.listRuns(req)
  const harnessGetProgress = (req: HarnessGetProgressReq): HarnessGetProgressRes => harness.getProgress(req)
  const harnessReadLog = (req: HarnessReadLogReq): HarnessReadLogRes => harness.readLog(req)
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
  const harnessSetReviewDecisions = (req: HarnessSetReviewDecisionsReq): HarnessSetReviewDecisionsRes => harness.setReviewDecisions(req)
  const harnessReadSourceExcerpt = (req: HarnessReadSourceExcerptReq): HarnessReadSourceExcerptRes => harness.readSourceExcerpt(req)
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

  const composeContext = async (req: ComposeContextReq): Promise<ComposeContextRes> => {
    const project = registry.get(req.projectId)
    if (!project) return { ok: false, reason: 'project not found' }
    const allTasks = listTasks(project.id)
    const task = allTasks.find((candidate) => candidate.id === req.taskId)
    if (!task || task.projectId !== req.projectId) return { ok: false, reason: 'task not found' }
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
    let retrievedEvidence: Awaited<ReturnType<RetrievalService['search']>>['evidence'] = []
    let retrievalDiagnostics: ContextRetrievalDiagnostic[] = []
    try {
      const response = await retrieval.search({
        text: buildTaskRetrievalQuery(task),
        scope: { projectIds: [project.id] },
        limit: COMPOSE_RETRIEVAL_LIMIT,
      })
      retrievedEvidence = response.evidence
      retrievalDiagnostics = contextRetrievalDiagnostics(response.diagnostics.retrievers)
    } catch (error) {
      if (error instanceof RetrievalUnavailableError) {
        retrievalDiagnostics = contextRetrievalDiagnostics(error.diagnostics)
      }
      if (retrievalDiagnostics.length === 0) {
        retrievalDiagnostics = [{
          code: 'retrieval-unavailable',
          message: '자동 검색을 사용할 수 없어 연결된 문서만 사용합니다.',
        }]
      }
    }
    return {
      ok: true,
      prompt: composeContextPackage({
        task,
        allTasks,
        wikiExcerpts,
        sessionSummary,
        retrievedEvidence,
        retrievalDiagnostics,
      }),
      diagnostics: retrievalDiagnostics,
    }
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
    const projectId = req.projectId ?? findTask(req.taskId)?.projectId
    if (projectId) {
      try {
        if (nextYml.isManaged(projectId)) {
          const result = nextYml.setBlockedBy(projectId, req.taskId, req.blockedBy)
          if (result.ok) invalidateResumeCards(projectId)
          return result.ok
            ? {
              ok: true,
              pendingApproval: result.pendingApproval,
              proposalHash: result.proposalHash,
            }
            : result
        }
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof NextYmlStoreError ? error.code : 'invalid-next-yml',
        }
      }
    }
    const check = validateBlockedBy((id) => tasks.get(id), req.taskId, req.blockedBy)
    if (!check.ok) return { ok: false, reason: check.reason }
    tasks.setBlockedBy(req.taskId, req.blockedBy)
    invalidateResumeCards(projectId)
    return { ok: true }
  }

  const conversationHistory = async (req: ConversationHistoryReq): Promise<ConversationHistoryRes> => {
    const project = registry.get(req.projectId)
    if (!project) throw new Error(`Project not found: ${req.projectId}`)
    const safeProjectId = project.id.replace(/[^a-z0-9._-]+/gi, '_')
    const cacheRoot = join(opts.vaultRoot, '..', 'apc-conversation-cache', safeProjectId, req.agent)
    const adapters: AgentIngestAdapter[] = []
    const repoPaths = [...project.repoPaths]
    const nowMs = now()
    const fetchOptions = req.includeOlder
      ? {}
      : { sinceMs: nowMs - CONVERSATION_HISTORY_RECENT_WINDOW_MS }
    const hasLocalRepo = project.repoPaths.some((repoPath) => !repoPath.startsWith('ssh://'))
    if (hasLocalRepo) adapters.push(...ingestAdapters)

    for (const [index, repoPath] of project.repoPaths.entries()) {
      const ssh = parseSsh(repoPath)
      if (ssh) {
        adapters.push(...await remoteConversationFetcher(
          repoPath,
          join(cacheRoot, `ssh-${index}`),
          [req.agent],
          fetchOptions,
        ))
        repoPaths.push(ssh.path)
        continue
      }

      const wslTarget = toWslProjectTarget(repoPath)
      if (!wslTarget) continue
      repoPaths.push(wslTarget.path)
      try {
        adapters.push(...await wslConversationFetcher(
          repoPath,
          join(cacheRoot, `wsl-${index}`),
          [req.agent],
          fetchOptions,
        ))
      } catch {
        // WSL is optional. A stopped/unavailable distro must not hide Windows-native history.
      }
    }

    return loadConversationHistory({
      adapters,
      projectId: project.id,
      repoPaths,
      agent: req.agent,
      includeOlder: req.includeOlder,
      limit: req.limit,
      nowMs,
    })
  }

  const invalidateResumeOnSuccess = <T extends { ok: boolean }>(projectId: string, result: T): T => {
    if (result.ok) invalidateResumeCards(projectId)
    return result
  }
  const taskCreate = (req: TaskCreateReq): TaskMutRes => {
    try {
      const result = nextYml.isManaged(req.projectId)
        ? nextYml.createTask(req.projectId, req)
        : taskCommands.create(req)
      return invalidateResumeOnSuccess(req.projectId, result)
    } catch (error) {
      return { ok: false, reason: error instanceof NextYmlStoreError ? error.code : 'invalid-next-yml' }
    }
  }
  const taskUpdate = (req: TaskUpdateReq): TaskMutRes => {
    try {
      const result = nextYml.isManaged(req.projectId)
        ? nextYml.updateTask(req.projectId, req)
        : taskCommands.update(req)
      return invalidateResumeOnSuccess(req.projectId, result)
    } catch (error) {
      return { ok: false, reason: error instanceof NextYmlStoreError ? error.code : 'invalid-next-yml' }
    }
  }
  const taskDelete = (req: TaskDeleteReq): TaskMutRes => {
    try {
      const result = nextYml.isManaged(req.projectId)
        ? nextYml.deleteTask(req.projectId, req.taskId)
        : taskCommands.delete(req)
      return invalidateResumeOnSuccess(req.projectId, result)
    } catch (error) {
      return { ok: false, reason: error instanceof NextYmlStoreError ? error.code : 'invalid-next-yml' }
    }
  }
  const submitReview = (req: SubmitReviewReq): SubmitReviewRes => {
    const parent = findTask(req.review.taskId)
    if (!parent) return { ok: false, reason: 'task-not-found' }
    try {
      if (nextYml.isManaged(parent.projectId)) {
        const result = nextYml.applyReview(parent.projectId, req.review)
        if (!result.ok) return result
        reviews.recordReview(req.review)
        invalidateResumeCards(parent.projectId)
        return result
      }
      const created = reviews.applyReview(req.review)
      invalidateResumeCards(parent.projectId)
      return { ok: true, tasks: created }
    } catch (error) {
      return { ok: false, reason: error instanceof NextYmlStoreError ? error.code : 'invalid-next-yml' }
    }
  }
  const nextActionsApprove = (req: NextActionsDecisionReq): NextActionsDecisionRes => {
    const result = nextYml.approve(req.projectId, req.proposalHash)
    if (result.ok) {
      for (const action of result.noteConversions ?? []) {
        const taskId = `next:${req.projectId}:${action.nextTaskId}`
        if (result.tasks.some((task) => task.id === taskId)) {
          nextNotes.markConverted(req.projectId, action.noteId, taskId, nowIso())
        }
      }
      invalidateResumeCards(req.projectId)
    }
    return result.ok ? { ok: true } : result
  }
  const nextActionsDiscard = (req: NextActionsDecisionReq): NextActionsDecisionRes => {
    const result = nextYml.discard(req.projectId, req.proposalHash)
    if (result.ok) invalidateResumeCards(req.projectId)
    return result.ok ? { ok: true } : result
  }
  const nextNoteAdd = (req: NextNoteAddReq): NextNoteAddRes => {
    if (!projectExists(req.projectId)) return { ok: false, reason: 'project-not-found' }
    const text = req.text.trim()
    if (!text) return { ok: false, reason: 'empty-text' }
    const note = nextNotes.add(req.projectId, text)
    invalidateResumeCards(req.projectId)
    return { ok: true, note }
  }
  const nextNoteToggle = (req: NextNoteToggleReq): NextNoteMutRes => {
    const result = nextNotes.setLifecycle(req.projectId, req.id, req.done ? 'completed' : 'active')
    if (result.ok) invalidateResumeCards(req.projectId)
    return result.ok ? { ok: true } : result
  }
  const nextNoteDelete = (req: NextNoteDeleteReq): NextNoteMutRes => {
    const result = nextNotes.deleteForProject(req.projectId, req.id)
    if (result.ok) invalidateResumeCards(req.projectId)
    return result.ok ? { ok: true } : result
  }
  const nextNotesList = (req: NextNotesListReq): NextNotesListRes => projectExists(req.projectId)
    ? { ok: true, notes: nextNotes.listByProject(req.projectId, req) }
    : { ok: false, reason: 'project-not-found' }
  const nextNoteUpdate = (req: NextNoteUpdateReq): NextNoteMutationRes => (
    invalidateResumeOnSuccess(req.projectId, nextNotes.updateText(req.projectId, req.noteId, req.text))
  )
  const nextNoteSetPinned = (req: NextNoteSetPinnedReq): NextNoteMutationRes => (
    invalidateResumeOnSuccess(req.projectId, nextNotes.setPinned(req.projectId, req.noteId, req.pinned))
  )
  const nextNoteSetLifecycle = (req: NextNoteSetLifecycleReq): NextNoteMutationRes => (
    invalidateResumeOnSuccess(req.projectId, nextNotes.setLifecycle(req.projectId, req.noteId, req.lifecycle))
  )
  const nextNoteConvertToTask = (req: NextNoteConvertToTaskReq): NextNoteConvertToTaskRes => {
    try {
      if (nextYml.isManaged(req.projectId)) {
        const note = nextNotes.get(req.noteId)
        if (!note) return { ok: false, reason: 'note-not-found' }
        if (note.projectId !== req.projectId) return { ok: false, reason: 'project-mismatch' }
        const result = nextYml.proposeNoteTask(req.projectId, {
          noteId: note.id,
          title: req.title?.trim() || note.text,
          priority: req.priority,
          dueDate: req.dueDate,
        })
        if (!result.ok) return result
        invalidateResumeCards(req.projectId)
        return {
          ok: true,
          note,
          task: result.task,
          pendingApproval: true,
          proposalHash: result.proposalHash,
        }
      }
      const result = invalidateResumeOnSuccess(req.projectId, noteTasks.convert(req))
      return result.ok
        ? { ok: true, note: result.note, task: result.task }
        : result
    } catch (error) {
      return { ok: false, reason: error instanceof NextYmlStoreError ? error.code : 'conversion-failed' }
    }
  }

  const agentActivitySnapshot = (req: AgentActivitySnapshotReq): AgentActivitySnapshotRes => ({
    activities: activityCoordinator.list(req.projectId),
    asOf: nowIso(),
  })
  const agentQuestionReconcile = async (req: AgentQuestionReconcileReq): Promise<AgentQuestionReconcileRes> => {
    const activity = activityCoordinator.get(req.paneId)
    if (!activity || activity.launchId !== req.launchId) return { ok: false, reason: 'stale-launch' }
    const sessionId = req.sessionId ?? activity.pane.sessionId ?? activity.lastQuestion?.sessionId
    if (!sessionId) return { ok: false, reason: 'session-id-required' }
    const history = await conversationHistory({
      projectId: activity.pane.projectId,
      agent: activity.pane.agent,
      includeOlder: true,
    })
    const service = new LiveQuestionService(activityCoordinator, {
      now: nowIso,
      findConfirmedQuestion: async (requestedSessionId) => latestConversationQuestion(history, requestedSessionId),
    })
    const result = await service.reconcile(req.paneId, req.launchId, sessionId)
    return result.ok ? { ok: true, activity: result.activity } : result
  }

  const localFilePreview = new LocalFilePreviewService({
    getProject: (projectId) => registry.get(projectId),
    listWorktrees: listGitWorktrees,
    now,
  })
  const sshExecutor = opts.sshExecutor ?? sshExec
  const remoteFilePreview = new RemoteFilePreviewService({
    getProject: (projectId) => registry.get(projectId),
    exec: sshExecutor,
    now,
  })
  const fileRefsResolve = async (req: FileRefsResolveReq): Promise<FileRefsResolveRes> => {
    const project = registry.get(req.projectId)
    if (!project) return localFilePreview.resolve(req)
    const hasLocal = [...project.repoPaths, ...project.vaultPaths].some((path) => !path.startsWith('ssh://'))
    const hasRemote = project.repoPaths.some((path) => path.startsWith('ssh://'))
    if (hasLocal && !hasRemote) return localFilePreview.resolve(req)
    if (hasRemote && !hasLocal) return remoteFilePreview.resolve(req)

    const local = await localFilePreview.resolve(req)
    if (!hasRemote || local.unresolved.length === 0) return local
    const remote = await remoteFilePreview.resolve({
      ...req,
      candidates: local.unresolved.map(({ candidate }) => candidate),
    })
    return { resolved: [...local.resolved, ...remote.resolved], unresolved: remote.unresolved }
  }
  const filePreviewRead = async (req: FilePreviewReadReq): Promise<FilePreviewReadRes> => {
    const project = registry.get(req.projectId)
    if (!project) return { ok: false, reason: '프로젝트를 찾을 수 없습니다.' }
    const hasLocal = [...project.repoPaths, ...project.vaultPaths].some((path) => !path.startsWith('ssh://'))
    const hasRemote = project.repoPaths.some((path) => path.startsWith('ssh://'))
    if (hasLocal) {
      const local = await localFilePreview.read(req)
      if (local.ok || !hasRemote) return local
    }
    return hasRemote
      ? remoteFilePreview.read(req)
      : { ok: false, reason: '등록된 파일 미리보기 경로가 없습니다.' }
  }

  db.exec('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT)')
  const terminalPreferenceKey = 'terminal_preferences_v1'
  const defaultTerminalPreferences: TerminalPreferences = {
    fontFamily: '"Cascadia Mono", "D2Coding", "Noto Sans Mono CJK KR", "NanumGothicCoding", "Consolas", monospace',
    fontSize: 13,
  }
  const terminalGetPreferences = (): TerminalPreferencesRes => {
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(terminalPreferenceKey) as { value: string } | undefined
    if (!row) return { ok: true, preferences: defaultTerminalPreferences }
    try {
      const saved = JSON.parse(row.value) as Partial<TerminalPreferences>
      return {
        ok: true,
        preferences: {
          fontFamily: typeof saved.fontFamily === 'string' && saved.fontFamily.trim()
            ? saved.fontFamily
            : defaultTerminalPreferences.fontFamily,
          fontSize: typeof saved.fontSize === 'number' && Number.isFinite(saved.fontSize)
            ? Math.min(32, Math.max(8, Math.round(saved.fontSize)))
            : defaultTerminalPreferences.fontSize,
        },
      }
    } catch {
      return { ok: true, preferences: defaultTerminalPreferences }
    }
  }
  const terminalSetPreferences = (req: TerminalSetPreferencesReq): TerminalPreferencesRes => {
    const current = terminalGetPreferences().preferences ?? defaultTerminalPreferences
    const preferences: TerminalPreferences = {
      fontFamily: req.fontFamily?.trim() || current.fontFamily,
      fontSize: req.fontSize === undefined ? current.fontSize : Math.min(32, Math.max(8, Math.round(req.fontSize))),
    }
    db.prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(terminalPreferenceKey, JSON.stringify(preferences))
    return { ok: true, preferences }
  }
  const terminalDiagnostics = async (req: TerminalDiagnosticsReq): Promise<TerminalDiagnosticsRes> => {
    const target = parseSsh(req.cwd)
    const remoteCharmap = target
      ? await sshExecutor(target, 'locale charmap', { timeoutMs: 8_000 }).then((result) => (
          result.ok ? result.stdout.trim() : undefined
        )).catch(() => undefined)
      : undefined
    const diagnostic = buildPtyEnvironment({
      kind: target ? 'ssh' : localPtyEnvironmentKind(process.env),
      env: process.env,
      remoteCharmap,
    }).diagnostic
    return {
      ok: true,
      environment: {
        kind: diagnostic.kind,
        term: diagnostic.term,
        colorTerm: diagnostic.colorTerm,
        locale: diagnostic.locale,
        utf8: diagnostic.utf8,
      },
      warnings: diagnostic.warnings,
    }
  }
  const clipboardReadText = (): ClipboardReadTextRes => {
    if (!opts.readClipboardText) return { ok: false, reason: '클립보드를 읽을 수 없습니다.' }
    try { return { ok: true, text: opts.readClipboardText() } }
    catch { return { ok: false, reason: '클립보드를 읽을 수 없습니다.' } }
  }

  return {
    vaultRoot: opts.vaultRoot,
    db, registry, tasks, taskCommands, nextYml, nextNotes, noteTasks, runs,
    activityStore, activityCoordinator, liveQuestions,
    reviews, cursors, searchIndex, retrieval, searchEvidence, resolveEvidenceSource, search, vault, taskProfiles,
    ingest, gitSync, receipts, retroStore, gate, retroService,
    ingestAdapters, runService, generate, generatePreflight, generateProject,
    harness, harnessRun, harnessResume, harnessConfirmNodes, harnessGetRun, harnessPromote, harnessPromoteCanonical, harnessCanonicalProposals,
    harnessSetReviewDecisions, harnessReadSourceExcerpt,
    harnessProposePolicy, harnessApprovePolicy, harnessGetPolicy, harnessRevertPolicy,
    harnessReadStagedDoc, harnessListStagedDocs, harnessReadGraphEdges, harnessExportWiki,
    harnessListRuns, harnessGetProgress, harnessReadLog,
    devHarnessRun, devHarnessCancel, composeContext, devHarnessReadTranscript,
    readProjectWiki: readProjectWikiQuery,
    taskSetBlockedBy,
    listTasks,
    dashboard,
    workspaceOverview: () => buildWorkspaceOverview({ registry, tasks, runs, nextNotes, listTasks }),
    resumeCard: async (req) => {
      if (resumeCardCache.has(req.projectId)) return resumeCardCache.get(req.projectId)!
      const card = await buildResumeCard({
        registry, tasks: { listByProject: listTasks }, nextNotes,
        latestSession: async (repoPath) => {
          const found = await latestSessionDetail(['claude', 'codex', 'opencode'], repoPath)
          if (!found) return null
          const lastUser = lastHumanUserTurn(found.session.turns)
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
    invalidateResumeCards,
    questionLog: (req) => questionLog.listRecent(req),
    conversationHistory,
    taskCreate, taskUpdate, taskDelete, submitReview, nextActionsApprove, nextActionsDiscard,
    nextNoteAdd, nextNoteToggle, nextNoteDelete, nextNotesList,
    nextNoteUpdate, nextNoteSetPinned, nextNoteSetLifecycle, nextNoteConvertToTask,
    agentActivitySnapshot, agentQuestionReconcile,
    fileRefsResolve, filePreviewRead,
    clipboardReadText, terminalGetPreferences, terminalSetPreferences, terminalDiagnostics,
  }
}
