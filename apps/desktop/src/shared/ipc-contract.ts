import type {
  Project, Task, AgentRun, AgentProfile, Review, AgentType, WikiGeneration, RunState, KhState,
  ProfileEdits, KhProjectPolicyProposal, EngineOptions, NextNote, QuestionLogEntry, GitSyncStatus,
  GitSyncResult, Retro, RetroQuestion, RetroTarget, ReviewReceipt, GateEvent,
  AgentActivity, AgentPaneIdentity, WikiProgressSummary, WikiRunEvent,
  FileRefsResolveReq, FileRefsResolveRes, FilePreviewReadReq, FilePreviewReadRes,
} from '@apc/shared'

/** Wiki authoring is intentionally single-engine. Keep this runtime constant shared by renderer and
 * main so stale localStorage or an older renderer cannot silently route a wiki run to another CLI. */
export const WIKI_GENERATION_ENGINE = 'codex' as const

export const CH = {
  // queries
  listProjects: 'q:listProjects',
  projectDashboard: 'q:projectDashboard',
  search: 'q:search',
  listProfiles: 'q:listProfiles',
  tasksList: 'q:tasksList',
  workspaceOverview: 'q:workspaceOverview',
  // dialogs
  selectFolder: 'd:selectFolder',
  projectImport: 'c:projectImport',
  testSsh: 'd:testSsh',
  // app self-update
  appUpdate: 'c:appUpdate',
  appRestart: 'c:appRestart',
  // commands
  registerProject: 'c:registerProject',
  updateProject: 'c:updateProject',
  projectContextConfirm: 'c:projectContextConfirm',
  deleteProject: 'c:deleteProject',
  ingestAll: 'c:ingestAll',
  generatePreflight: 'c:generatePreflight',
  generateRun: 'c:generateRun',
  generateProject: 'c:generateProject',
  harnessRun: 'c:harnessRun',
  harnessResume: 'c:harnessResume',
  harnessConfirmNodes: 'c:harnessConfirmNodes',
  harnessGetRun: 'c:harnessGetRun',
  harnessPromote: 'c:harnessPromote',
  harnessPromoteCanonical: 'c:harnessPromoteCanonical',
  harnessCanonicalProposals: 'c:harnessCanonicalProposals',
  harnessProposePolicy: 'c:harnessProposePolicy',
  harnessApprovePolicy: 'c:harnessApprovePolicy',
  harnessGetPolicy: 'c:harnessGetPolicy',
  harnessRevertPolicy: 'c:harnessRevertPolicy',
  harnessSetReviewDecisions: 'c:harnessSetReviewDecisions',
  harnessOpenSourceFile: 'c:harnessOpenSourceFile',
  harnessReadStagedDoc: 'c:harnessReadStagedDoc',
  harnessListStagedDocs: 'c:harnessListStagedDocs',
  harnessReadGraphEdges: 'c:harnessReadGraphEdges',
  harnessExportWiki: 'c:harnessExportWiki',
  // dev-harness (S3): console drives the multi-agent coding harness via the CLI contract.
  devHarnessRun: 'c:devHarnessRun',
  devHarnessCancel: 'c:devHarnessCancel',
  // context package composer (P2): task → LLM-handoff prompt (assembled in main).
  composeContext: 'q:composeContext',
  devHarnessReadTranscript: 'q:devHarnessReadTranscript',
  readProjectWiki: 'c:readProjectWiki',
  submitReview: 'c:submitReview',
  promoteCurrent: 'c:promoteCurrent',
  selectProfile: 'c:selectProfile',
  taskSetBlockedBy: 'c:taskSetBlockedBy',
  taskCreate: 'c:taskCreate',
  taskUpdate: 'c:taskUpdate',
  taskDelete: 'c:taskDelete',
  resumeCard: 'q:resumeCard',
  questionLog: 'q:questionLog',
  conversationHistory: 'q:conversationHistory',
  nextNoteAdd: 'c:nextNoteAdd',
  nextNoteToggle: 'c:nextNoteToggle',
  nextNoteDelete: 'c:nextNoteDelete',
  nextNotesList: 'q:nextNotesList',
  nextNoteUpdate: 'c:nextNoteUpdate',
  nextNoteSetPinned: 'c:nextNoteSetPinned',
  nextNoteSetLifecycle: 'c:nextNoteSetLifecycle',
  nextNoteConvertToTask: 'c:nextNoteConvertToTask',
  agentActivitySnapshot: 'q:agentActivitySnapshot',
  agentQuestionReconcile: 'c:agentQuestionReconcile',
  // Learning Gate: server-owned daily review targets and push authorization.
  retroPrepare: 'c:retroPrepare',
  retroAnswer: 'c:retroAnswer',
  retroTargetNotes: 'c:retroTargetNotes',
  retroComplete: 'c:retroComplete',
  receiptIssue: 'c:receiptIssue',
  gateStatus: 'q:gateStatus',
  gateInstall: 'c:gateInstall',
  // pty: renderer → main commands; main → renderer launch-scoped V2 events
  ptyStart: 'pty:start',
  ptyInput: 'pty:input',
  ptyKill: 'pty:kill',
  ptyResize: 'pty:resize',
  ptyDataV2: 'pty:data:v2',
  ptyExitV2: 'pty:exit:v2',
  agentActivity: 'agent:activity',
  harnessProgress: 'harness:progress',
  harnessEngineLog: 'harness:engineLog',
  harnessNodes: 'harness:nodes',
  harnessActivity: 'harness:activity',
  devHarnessLog: 'devHarness:log',
  devHarnessStarted: 'devHarness:started',
  configPreview: 'c:configPreview',
  configApply: 'c:configApply',
  configRollback: 'c:configRollback',
  // read-only project file access (Knowledge/Home tabs)
  fsReadDoc: 'q:fsReadDoc',
  fsListDocs: 'q:fsListDocs',
  fileRefsResolve: 'q:fileRefsResolve',
  filePreviewRead: 'q:filePreviewRead',
  harnessListRuns: 'q:harnessListRuns',
  harnessGetProgress: 'q:harnessGetProgress',
  harnessReadLog: 'q:harnessReadLog',
  harnessReadSourceExcerpt: 'q:harnessReadSourceExcerpt',
  clipboardReadText: 'q:clipboardReadText',
  terminalGetPreferences: 'q:terminalGetPreferences',
  terminalSetPreferences: 'c:terminalSetPreferences',
  terminalDiagnostics: 'q:terminalDiagnostics',
  // project working-tree changes (Changes tab)
  changesList: 'q:changesList',
  changesDiff: 'q:changesDiff',
  gitStatus: 'q:gitStatus',
  gitWorktrees: 'q:gitWorktrees',
  gitFetch: 'c:gitFetch',
  gitPull: 'c:gitPull',
  gitCommit: 'c:gitCommit',
  gitPush: 'c:gitPush',
  // workspace session persistence (main→renderer restore, renderer→main reports)
  workspaceRestore: 'workspace:restore',
  paneOpened: 'pane:opened',
  paneClosed: 'pane:closed',
  selectProject: 'workspace:select-project',
} as const

export type TestSshReq = { host: string; port: number; username: string; remotePath: string }
export type ProjectContextInput = { goal?: string; currentFocus?: string }
export type RegisterProjectReq = { name: string; projectType: string; repoPath: string; domain?: string } & ProjectContextInput
export type UpdateProjectReq = { id: string; name: string; projectType: string; repoPath: string; domain?: string } & ProjectContextInput
export type ProjectContextConfirmReq = { projectId: string; field: 'goal' | 'currentFocus' }
export type ProjectContextMutRes = { ok: boolean; project?: Project; reason?: string }
export type DeleteProjectReq = { id: string }
export type ProjectDashboardReq = { projectId: string }
export type ProjectDashboardRes = { project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[]; allTasks: Task[] }
export type SearchReq = { query: string; projectId?: string }
export type ListProfilesReq = { projectPath: string }
export type TasksListReq = { projectId: string }
export type SubmitReviewReq = { review: Review }
export type PromoteCurrentReq = { projectId: string; lastReadHash: string }
export type SelectProfileReq = { taskId: string; profileId: string }
export type TaskSetBlockedByReq = { taskId: string; blockedBy: string[]; projectId?: string }
export type TaskSetBlockedByRes = { ok: boolean; reason?: string }
export type TaskCreateReq = {
  projectId: string
  title: string
  status?: Task['status']
  priority?: Task['priority']
  dueDate?: string
}
export type TaskUpdateReq = {
  projectId: string
  taskId: string
  title: string
  status: Task['status']
  priority: Task['priority']
  dueDate?: string
}
export type TaskDeleteReq = { projectId: string; taskId: string }
export type TaskMutRes = { ok: boolean; task?: Task; reason?: string }

// Resume card / conversation history / next-note surface (P3): the legacy QuestionLogEntry stays in
// @apc/shared; the richer session + Q&A DTOs live here because they are desktop IPC view models.
export type ResumeCardReq = { projectId: string }
export type QuestionLogReq = { projectId?: string; limit?: number }
export type ConversationHistoryReq = {
  projectId: string
  agent: AgentType
  /** Initial reads cover the latest 72 hours. Set true after "더 불러오기" or for a direct old-session focus. */
  includeOlder?: boolean
  limit?: number
}
export type ConversationExchange = {
  id: string
  askedAt?: string
  question: string
  answer: string | null
}
export type ConversationSession = {
  id: string
  agent: AgentType
  startedAt?: string
  endedAt?: string
  branch?: string
  /** Main-process-verified base for resolving relative paths mentioned in this transcript. */
  workspacePath?: string
  preview: string
  exchanges: ConversationExchange[]
}
export type ConversationHistoryRes = {
  projectId: string
  agent: AgentType
  sessions: ConversationSession[]
  scannedSources: number
  skippedSources: number
  truncated: boolean
}
export type NextNoteAddReq = { projectId: string; text: string }
export type NextNoteAddRes = { ok: boolean; note?: NextNote; reason?: string }
export type NextNoteToggleReq = { projectId: string; id: string; done: boolean }
export type NextNoteDeleteReq = { projectId: string; id: string }
export type NextNoteMutRes = { ok: boolean; reason?: string }
export type NextNotesListReq = {
  projectId: string
  includeCompleted?: boolean
  includeArchived?: boolean
}
export type NextNotesListRes = { ok: boolean; notes?: NextNote[]; reason?: string }
export type NextNoteUpdateReq = { projectId: string; noteId: string; text: string }
export type NextNoteSetPinnedReq = { projectId: string; noteId: string; pinned: boolean }
export type NextNoteSetLifecycleReq = {
  projectId: string
  noteId: string
  lifecycle: 'active' | 'completed' | 'archived'
}
export type NextNoteConvertToTaskReq = {
  projectId: string
  noteId: string
  title?: string
  priority?: Task['priority']
  dueDate?: string
}
export type NextNoteMutationRes = { ok: boolean; note?: NextNote; reason?: string }
export type NextNoteConvertToTaskRes = { ok: boolean; note?: NextNote; task?: Task; reason?: string }

export type AgentActivitySnapshotReq = { projectId?: string }
export type AgentActivitySnapshotRes = { activities: AgentActivity[]; asOf: string }
export type AgentQuestionReconcileReq = { paneId: string; launchId: string; sessionId?: string }
export type AgentQuestionReconcileRes = { ok: boolean; activity?: AgentActivity; reason?: string }
export type AgentActivityEvent = AgentActivity

// Learning Gate (M1). A prepared target and its HEAD come from main; the renderer can only answer
// that target and ask main to issue a receipt after main re-verifies the current Git snapshot.
export type RetroProjectEvidenceDto = {
  projectId: string
  name: string
  repoPath: string
  branch: string | null
  target: RetroTarget
  headCovered: boolean
  gateEnabled: boolean
  hookInstalled: boolean
  lastReceiptSha: string | null
  commits: Array<{ sha: string; when: string; subject: string }>
  workingTreeFiles: number
  changedFiles: number
  additions: number
  deletions: number
  resetByHeadDrift: boolean
}
export type RetroPrepareReq = {
  date: string
  targets: Array<{ projectId: string; worktreePath?: string }>
}
export type RetroPrepareRes = {
  ok: boolean
  reason?: string
  retro?: Retro
  questions?: RetroQuestion[]
  projects?: RetroProjectEvidenceDto[]
  skips?: GateEvent[]
  problems?: string[]
}
export type RetroAnswerReq = { questionId: string; answer?: string; skipped?: boolean }
export type RetroAnswerRes = { ok: boolean; reason?: string }
export type RetroTargetNotesReq = { targetId: string; verificationEvidence: string; riskNotes: string }
export type RetroTargetNotesRes = { ok: boolean; reason?: string }
export type RetroCompleteReq = { retroId: string }
export type RetroCompleteRes = { ok: boolean; reason?: string }
export type ReceiptIssueReq = { targetId: string }
export type ReceiptIssueRes = { ok: boolean; reason?: string; receipt?: ReviewReceipt }
export type GateQueryReq = { projectId: string; worktreePath?: string }
export type GateStatusRes = {
  ok: boolean
  reason?: string
  enabled: boolean
  hookInstalled: boolean
  headSha: string | null
  headCovered: boolean
  reviewedCount: number
}
export type GateInstallReq = GateQueryReq
export type GateInstallRes = { ok: boolean; reason?: string }
export type GeneratePreflightReq = { projectId: string }
export type GeneratePreflightCategoryId = 'agent-conversations' | 'project-docs' | 'tasks' | 'review-runs'
export type GeneratePreflightCategory = {
  id: GeneratePreflightCategoryId
  label: string
  description: string
  count: number
  selectedByDefault: boolean
  required?: boolean
}
export type GeneratePreflightRes = {
  ok: boolean
  reason?: string
  projectId?: string
  projectName?: string
  categories?: GeneratePreflightCategory[]
  totalCount?: number
  status?: string
}
export type GenerateProjectReq = { projectId: string; engine: AgentType; selectedPreflightCategoryIds?: GeneratePreflightCategoryId[] }
export type GenerateProjectRes = {
  ok: boolean
  reason?: string
  sessionId?: string
  summaryPath?: string
  proposalPath?: string
  generation?: WikiGeneration
}

// Knowledge Harness (evidence-based multi-agent pipeline) surface.
export type HarnessProgressEvent = { runId: string; state: string }
export type HarnessEngineLogEvent = { label: string; stream: 'stdout' | 'stderr'; chunk: string }
/** Live node previews discovered mid-run (per folder worker) — for the Knowledge tab's incremental graph. */
export type HarnessLiveNode = { id: string; title: string; type: string; scope: string }
export type HarnessNodesEvent = { runId: string; folder: string; nodes: HarnessLiveNode[] }
export type ProjectStructureHintDto = {
  projectCharacter?: string
  folderClassifications?: Array<{ path: string; description?: string }>
}
export type HarnessRunReq = {
  projectId: string
  engine: AgentType
  materialize?: boolean
  engineOptions?: EngineOptions
  workerConcurrency?: number
  fullRegen?: boolean
  interactive?: boolean
  projectContext?: ProjectStructureHintDto
}
export type HarnessRunRes = { ok: boolean; runId?: string; finalState?: string; reason?: string }

// dev-harness (S3): drive the multi-agent coding harness for one task via the CLI contract.
export type DevHarnessRunReq = { projectId: string; taskId: string; workflow?: string; graphProfile?: string }
export type DevHarnessRunRes = { ok: boolean; runId?: string; exitCode?: number | null; reason?: string }
export type DevHarnessCancelReq = { runId: string }
export type DevHarnessCancelRes = { ok: boolean }
export type DevHarnessLogEvent = { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }
export type HarnessResumeReq = { runId: string }
export type HarnessConfirmNodesReq = { runId: string; approvedNodes: { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> } }
export type HarnessGetRunReq = { runId: string }
export type HarnessArtifactRes = { state: KhState; name: string; path: string; data: unknown }
export type HarnessGetRunRes = { ok: boolean; runState?: RunState; artifacts?: HarnessArtifactRes[]; reason?: string }
export type HarnessPromoteReq = { runId: string; allowSecrets?: boolean; allowInvalid?: boolean }
export type HarnessPromoteRes = {
  ok: boolean
  promoted?: string[]
  proposals?: string[]
  refusedCanonical?: string[]
  skippedByReview?: string[]
  danglingLinks?: number
  reason?: string
}
export type HarnessPromoteCanonicalReq = { runId: string; proposalRelPath: string; lastReadHash: string; allowSecrets?: boolean; allowInvalid?: boolean }
export type HarnessPromoteCanonicalRes = { ok: boolean; status?: 'promoted' | 'conflict'; canonicalPath?: string; newHash?: string; conflictPath?: string; reason?: string }
export type HarnessCanonicalProposalsReq = { runId: string }
export type HarnessCanonicalProposalsRes = Array<{ proposalRelPath: string; canonicalPath: string; currentHash: string | null }>

// Per-proposal human verdicts plus immutable-source evidence reads used by the review screen.
export type HarnessReviewDecisionDto = {
  proposal_id: string
  verdict: 'approved' | 'excluded'
  decided_at: string
}
export type HarnessSetReviewDecisionsReq = { runId: string; decisions: HarnessReviewDecisionDto[] }
export type HarnessSetReviewDecisionsRes = { ok: boolean; reason?: string }
export type HarnessReadSourceExcerptReq = { runId: string; sourcePath: string; quote?: string }
export type HarnessReadSourceExcerptRes = {
  ok: boolean
  matched?: boolean
  excerpt?: string
  line?: number
  reason?: string
}
export type HarnessOpenSourceFileReq = { runId: string; sourcePath: string }
export type HarnessOpenSourceFileRes = { ok: boolean; reason?: string }

export type WikiPolicyRecordDto = {
  status: 'proposed' | 'approved'
  proposal: KhProjectPolicyProposal
  generatedAt: string
  approvedAt?: string
  body: string
}
export type HarnessProposePolicyReq = { projectId: string; engine: AgentType; repoPaths?: string[] }
export type HarnessProposePolicyRes = { ok: boolean; proposal?: KhProjectPolicyProposal; effectivePreview?: string; body?: string; reason?: string }
export type HarnessApprovePolicyReq = { projectId: string }
export type HarnessApprovePolicyRes = { ok: boolean; record?: WikiPolicyRecordDto; reason?: string }
export type HarnessGetPolicyReq = { projectId: string }
export type HarnessGetPolicyRes = { ok: true; record: WikiPolicyRecordDto | null }
export type HarnessRevertPolicyReq = { projectId: string }
export type HarnessRevertPolicyRes = { ok: boolean; reason?: string }
// Read an unpromoted draft doc from a run's vault-staging dir (graph peek for HUMAN_REVIEW runs).
export type HarnessReadStagedDocReq = { runId: string; relPath: string }
export type HarnessReadStagedDocRes = { ok: true; content: string } | { ok: false; reason: string }
// List a run's vault-staging .md docs, flagging which are real rendered nodes.
export type StagedDocDto = { relPath: string; isNode: boolean; nodeId?: string; nodeType?: string; title?: string }
export type HarnessListStagedDocsReq = { runId: string }
export type HarnessListStagedDocsRes = { docs: StagedDocDto[] }

/** A typed edge from a paper run's wiki/graph/edges.jsonl. `from`/`to` are qualified `<type>:<slug>` refs;
 *  attributes (e.g. confidence) ride inline. */
export type GraphEdgeDto = { from: string; to: string; type: string } & Record<string, unknown>
export type HarnessReadGraphEdgesReq = { runId: string }
export type HarnessReadGraphEdgesRes = { edges: GraphEdgeDto[] }

export type WikiGraphNodeDto = { ref: string; type: string; title: string; relPath: string }
export type ReadProjectWikiReq = { projectId: string }
export type ReadProjectWikiRes =
  | { available: true; wikiDir: string; nodes: WikiGraphNodeDto[]; edges: GraphEdgeDto[] }
  | { available: false; reason?: string }
// Publish the project's human-readable wiki into its workspace `wiki/` area (manual export).
export type HarnessExportWikiReq = { projectId: string }
export type HarnessExportWikiRes = { ok: true; target: string; files: number } | { ok: false; reason: string }

// Server-authoritative wiki run progress. Renderer localStorage is a cache, never the history source.
export type HarnessListRunsReq = { projectId: string; limit?: number }
export type HarnessRunProgressDto = {
  runId: string
  projectId: string
  summary: WikiProgressSummary
  active: boolean
}
export type HarnessListRunsRes = { ok: boolean; runs?: HarnessRunProgressDto[]; reason?: string }
export type HarnessGetProgressReq = { runId: string }
export type HarnessGetProgressRes = {
  ok: boolean
  summary?: WikiProgressSummary
  events?: WikiRunEvent[]
  active?: boolean
  reason?: string
}
export type HarnessReadLogReq = { runId: string; offset?: number; limit?: number }
export type HarnessReadLogRes = {
  ok: boolean
  content?: string
  nextOffset?: number
  truncated?: boolean
  reason?: string
}

/** Generate a work summary + current proposal from a finished agent run's transcript. */
export type GenerateRunReq = {
  runId: string
  agent: AgentType
  transcriptPath: string
  engine: AgentType
  projectId: string
  currentCanonical: string
}

type StartPtyBase = {
  id: string; command: string; args: string[]; cwd: string
  resume?: boolean            // true면 main이 resume argv를 구성(아래 agent 필요)
  agent?: 'claude' | 'codex' | 'opencode'
  sessionId?: string          // 알려진 세션 id(없으면 main이 최신 발견)
}
type ScopedPtyStart = { pane: AgentPaneIdentity; launchId: string }
type UnscopedPtyStart = { pane?: undefined; launchId: string }
/** Every start is launch-scoped; pane identity is optional only for non-workspace test/utility terminals. */
export type StartPtyReq = StartPtyBase & (ScopedPtyStart | UnscopedPtyStart)
export type PtyInputReq = {
  id: string
  data: string
  launchId?: string
  /** Submitted plain-input lines. Main sanitizes these before anything is persisted or emitted. */
  questionCandidates?: string[]
}
export type PtyKillReq = { id: string; launchId?: string; reason?: 'user' | 'restart' | 'unmount' | 'quit' }
export type PtyResizeReq = { id: string; cols: number; rows: number; launchId?: string }
export type PtyDataEvent = { id: string; launchId: string; data: string }
export type PtyExitEvent = { id: string; launchId: string; code: number; reason?: string }
export type ListProfilesResult = AgentProfile[]

export type ClipboardReadTextRes = { ok: boolean; text?: string; reason?: string }
export type TerminalPreferences = { fontFamily: string; fontSize: number }
export type TerminalSetPreferencesReq = Partial<TerminalPreferences>
export type TerminalPreferencesRes = { ok: boolean; preferences?: TerminalPreferences; reason?: string }
export type TerminalDiagnosticsReq = { cwd: string }
export type TerminalDiagnosticsRes = {
  ok: boolean
  environment?: {
    kind: 'local' | 'wsl' | 'ssh'
    term?: string
    colorTerm?: string
    locale?: string
    utf8: boolean
  }
  warnings?: string[]
  reason?: string
}

export type ConfigEditReq = { rawConfigPath: string; rawFormat: 'json' | 'markdown'; profileName: string; edits: ProfileEdits }
export type ConfigPreviewRes = { ok: boolean; errors: string[]; diff: string }
export type ConfigApplyRes = { ok: boolean; errors: string[]; snapshotPath?: string }
export type ConfigRollbackReq = { rawConfigPath: string }
export type ConfigRollbackRes = { ok: boolean; restoredFrom?: string; error?: string }

export type FsReadDocReq = { projectId: string; relPath: string }
export type FsReadDocRes = { ok: boolean; content?: string; reason?: string }
export type FsListDocsReq = { projectId: string }
export type FsListDocsRes = { docs: { relPath: string; mtimeMs: number }[] }

export type ProjectImportKind = 'files' | 'folder'
export type ProjectImportReq = {
  projectId: string
  kind: ProjectImportKind
  /** When present, main verifies this is a registered Git worktree before copying into it. */
  worktreePath?: string
}
export type ProjectImportItem = {
  sourceName: string
  relativePath: string
  kind: 'file' | 'folder'
  renamed: boolean
}
export type ProjectImportRes =
  | { ok: true; canceled: true; items: [] }
  | { ok: true; canceled: false; destination: string; items: ProjectImportItem[] }
  | { ok: false; reason: string }

// File preview request/response DTOs are defined and runtime-validated in @apc/shared.
export type { FileRefsResolveReq, FileRefsResolveRes, FilePreviewReadReq, FilePreviewReadRes }

export type ChangesListReq = { projectId: string }
export type ChangesListRes = {
  ok: boolean
  reason?: string
  files?: {
    path: string
    status: 'new' | 'modified' | 'deleted'
    isMarkdown: boolean
    mtimeMs: number
    unreflected?: boolean
    additions?: number
    deletions?: number
    binary?: boolean
  }[]
}
export type ChangesDiffReq = { projectId: string; relPath: string }
export type ChangesDiffRes = { ok: boolean; patch?: string; reason?: string }

export type GitStatusReq = { projectId: string; fetch?: boolean; worktreePath?: string }
export type GitStatusRes = GitSyncStatus
export type GitWorktreeDto = {
  path: string
  branch: string | null
  head: string
  detached: boolean
  isMain: boolean
  locked?: string
  prunable?: string
}
export type GitWorktreesReq = { projectId: string }
export type GitWorktreesRes = { ok: boolean; worktrees: GitWorktreeDto[]; reason?: string }
export type GitFetchReq = { projectId: string; worktreePath?: string }
export type GitPullReq = { projectId: string; worktreePath?: string }
export type GitCommitReq = { projectId: string; files: string[]; message: string; worktreePath?: string }
export type GitPushReq = { projectId: string; worktreePath?: string }
export type GitSyncRes = GitSyncResult

// Workspace session persistence
export type PaneRef = {
  projectId: string
  agent: 'claude' | 'codex' | 'opencode'
  paneId?: string
  worktreePath?: string
  slotId?: string
}
export type WorkspaceRestore = {
  panes: Array<PaneRef & { lastSessionId: string | null }>
  selectedProjectId: string | null
}

// context package composer (P2)
export type ComposeContextReq = { projectId: string; taskId: string }
export type ComposeContextRes = { ok: boolean; prompt?: string; reason?: string }

// dev-harness started ack (P2): fired right after the run is recorded, before any log chunk.
export type DevHarnessStartedEvent = { runId: string; taskId: string; projectId: string }

// dev-harness transcript viewer (P2)
export type DevHarnessReadTranscriptReq = { runId: string }
export type DevHarnessReadTranscriptRes = { ok: boolean; content?: string; reason?: string }
