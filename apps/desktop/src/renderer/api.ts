import { CH } from '../shared/ipc-contract.js'
import type {
  RegisterProjectReq, UpdateProjectReq, ProjectDashboardReq, ProjectDashboardRes, SearchReq,
  SearchEvidenceReq, SearchEvidenceRes, ResolveEvidenceSourceReq, ResolveEvidenceSourceRes,
  SubmitReviewReq, SubmitReviewRes, PromoteCurrentReq, SelectProfileReq, GenerateRunReq,
  GeneratePreflightReq, GeneratePreflightRes, GenerateProjectReq, GenerateProjectRes, HarnessRunReq, HarnessRunRes, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
  HarnessResumeReq, HarnessConfirmNodesReq, HarnessPromoteCanonicalReq, HarnessPromoteCanonicalRes,
  HarnessCanonicalProposalsReq, HarnessCanonicalProposalsRes,
  HarnessSetReviewDecisionsReq, HarnessSetReviewDecisionsRes,
  HarnessReadSourceExcerptReq, HarnessReadSourceExcerptRes,
  HarnessOpenSourceFileReq, HarnessOpenSourceFileRes,
  HarnessProposePolicyReq, HarnessProposePolicyRes,
  HarnessApprovePolicyReq, HarnessApprovePolicyRes,
  HarnessGetPolicyReq, HarnessGetPolicyRes,
  HarnessRevertPolicyReq, HarnessRevertPolicyRes,
  HarnessReadStagedDocReq, HarnessReadStagedDocRes,
  HarnessListStagedDocsReq, HarnessListStagedDocsRes,
  HarnessReadGraphEdgesReq, HarnessReadGraphEdgesRes,
  HarnessExportWikiReq, HarnessExportWikiRes,
  DevHarnessRunReq, DevHarnessRunRes, DevHarnessCancelReq, DevHarnessCancelRes, DevHarnessLogEvent,
  ComposeContextReq, ComposeContextRes,
  DevHarnessStartedEvent,
  DevHarnessReadTranscriptReq, DevHarnessReadTranscriptRes,
  ReadProjectWikiReq, ReadProjectWikiRes,
  StartPtyReq, PtyInputReq, PtyKillReq, PtyResizeReq,
  ConfigEditReq, ConfigPreviewRes, ConfigApplyRes, ConfigRollbackReq, ConfigRollbackRes,
  FsReadDocReq, FsReadDocRes, FsListDocsReq, FsListDocsRes,
  ChangesListReq, ChangesListRes, ChangesDiffReq, ChangesDiffRes,
  GitStatusReq, GitStatusRes, GitWorktreesReq, GitWorktreesRes, GitFetchReq, GitPullReq, GitCommitReq, GitPushReq, GitSyncRes,
  HarnessNodesEvent,
  PaneRef, WorkspaceRestore,
  TaskSetBlockedByReq, TaskSetBlockedByRes,
  ConversationHistoryReq, ConversationHistoryRes,
  NextNoteAddReq, NextNoteAddRes, NextNoteToggleReq, NextNoteDeleteReq, NextNoteMutRes,
  RetroPrepareReq, RetroPrepareRes, RetroAnswerReq, RetroAnswerRes,
  RetroTargetNotesReq, RetroTargetNotesRes, RetroCompleteReq, RetroCompleteRes,
  ReceiptIssueReq, ReceiptIssueRes, GateQueryReq, GateStatusRes, GateInstallReq, GateInstallRes,
  ProjectContextConfirmReq, ProjectContextMutRes,
  TaskCreateReq, TaskUpdateReq, TaskDeleteReq, TaskMutRes,
  NextActionsDecisionReq, NextActionsDecisionRes,
  NextNotesListReq, NextNotesListRes, NextNoteUpdateReq, NextNoteSetPinnedReq,
  NextNoteSetLifecycleReq, NextNoteConvertToTaskReq, NextNoteMutationRes, NextNoteConvertToTaskRes,
  AgentActivitySnapshotReq, AgentActivitySnapshotRes, AgentQuestionReconcileReq, AgentQuestionReconcileRes,
  HarnessListRunsReq, HarnessListRunsRes, HarnessGetProgressReq, HarnessGetProgressRes,
  HarnessReadLogReq, HarnessReadLogRes,
  FileRefsResolveReq, FileRefsResolveRes, FilePreviewReadReq, FilePreviewReadRes,
  PtyDataEvent, PtyExitEvent, ClipboardReadTextRes,
  TerminalSetPreferencesReq, TerminalPreferencesRes, TerminalDiagnosticsReq, TerminalDiagnosticsRes,
  ProjectImportReq, ProjectImportRes,
} from '../shared/ipc-contract.js'
import type {
  Project, AgentProfile, UnifiedSearchResponse, Task, NextNote, QuestionLogEntry,
  AgentActivity, WikiRunEvent,
} from '@apc/shared'
import type { WorkspaceOverview, ResumeCard } from '@apc/dashboard-api'

declare global {
  interface Window {
    apc: {
      invoke(channel: string, payload?: unknown): Promise<unknown>
      searchEvidence(req: SearchEvidenceReq): Promise<SearchEvidenceRes>
      resolveEvidenceSource(req: ResolveEvidenceSourceReq): Promise<ResolveEvidenceSourceRes>
      importProjectItems(req: ProjectImportReq): Promise<ProjectImportRes>
      startPty(req: StartPtyReq): void
      writePty(req: PtyInputReq): void
      killPty(req: PtyKillReq): void
      resizePty(req: PtyResizeReq): void
      onPtyDataV2(id: string, cb: (event: PtyDataEvent) => void): () => void
      onPtyExitV2(id: string, cb: (event: PtyExitEvent) => void): () => void
      onAgentActivity(cb: (event: AgentActivity) => void): () => void
      onHarnessProgress(cb: (e: { runId: string; state: string }) => void): () => void
      onHarnessEngineLog(cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void
      onHarnessNodes(cb: (e: HarnessNodesEvent) => void): () => void
      onHarnessActivity(cb: (event: WikiRunEvent) => void): () => void
      onDevHarnessLog(cb: (e: DevHarnessLogEvent) => void): () => void
      onDevHarnessStarted(cb: (e: DevHarnessStartedEvent) => void): () => void
      // Workspace session persistence
      paneOpened(p: unknown): void
      paneClosed(p: unknown): void
      selectProject(id: string): void
      onWorkspaceRestore(cb: (p: unknown) => void): () => void
    }
  }
}

export const api = {
  selectFolder(): Promise<string | null> {
    return window.apc.invoke(CH.selectFolder) as Promise<string | null>
  },
  importProjectItems(req: ProjectImportReq): Promise<ProjectImportRes> {
    return window.apc.importProjectItems(req)
  },
  appUpdate(): Promise<{ ok: boolean; output: string }> {
    return window.apc.invoke(CH.appUpdate) as Promise<{ ok: boolean; output: string }>
  },
  appRestart(): Promise<void> {
    return window.apc.invoke(CH.appRestart) as Promise<void>
  },
  testSsh(req: { host: string; port: number; username: string; remotePath: string }): Promise<{ ok: boolean; error?: string }> {
    return window.apc.invoke(CH.testSsh, req) as Promise<{ ok: boolean; error?: string }>
  },
  listProjects(): Promise<Project[]> {
    return window.apc.invoke(CH.listProjects) as Promise<Project[]>
  },
  registerProject(req: RegisterProjectReq): Promise<Project> {
    return window.apc.invoke(CH.registerProject, req) as Promise<Project>
  },
  updateProject(req: UpdateProjectReq): Promise<Project> {
    return window.apc.invoke(CH.updateProject, req) as Promise<Project>
  },
  projectContextConfirm(req: ProjectContextConfirmReq): Promise<ProjectContextMutRes> {
    return window.apc.invoke(CH.projectContextConfirm, req) as Promise<ProjectContextMutRes>
  },
  deleteProject(id: string): Promise<{ ok: boolean }> {
    return window.apc.invoke(CH.deleteProject, { id }) as Promise<{ ok: boolean }>
  },
  projectDashboard(req: ProjectDashboardReq): Promise<ProjectDashboardRes> {
    return window.apc.invoke(CH.projectDashboard, req) as Promise<ProjectDashboardRes>
  },
  search(req: SearchReq): Promise<UnifiedSearchResponse> {
    return window.apc.invoke(CH.search, req) as Promise<UnifiedSearchResponse>
  },
  searchEvidence(req: SearchEvidenceReq): Promise<SearchEvidenceRes> {
    return window.apc.searchEvidence(req)
  },
  resolveEvidenceSource(req: ResolveEvidenceSourceReq): Promise<ResolveEvidenceSourceRes> {
    return window.apc.resolveEvidenceSource(req)
  },
  listProfiles(projectPath: string): Promise<AgentProfile[]> {
    return window.apc.invoke(CH.listProfiles, { projectPath }) as Promise<AgentProfile[]>
  },
  tasksList(projectId: string): Promise<Task[]> {
    return window.apc.invoke(CH.tasksList, { projectId }) as Promise<Task[]>
  },
  workspaceOverview(): Promise<WorkspaceOverview> {
    return window.apc.invoke(CH.workspaceOverview) as Promise<WorkspaceOverview>
  },
  taskSetBlockedBy(req: TaskSetBlockedByReq): Promise<TaskSetBlockedByRes> {
    return window.apc.invoke(CH.taskSetBlockedBy, req) as Promise<TaskSetBlockedByRes>
  },
  taskCreate(req: TaskCreateReq): Promise<TaskMutRes> {
    return window.apc.invoke(CH.taskCreate, req) as Promise<TaskMutRes>
  },
  taskUpdate(req: TaskUpdateReq): Promise<TaskMutRes> {
    return window.apc.invoke(CH.taskUpdate, req) as Promise<TaskMutRes>
  },
  taskDelete(req: TaskDeleteReq): Promise<TaskMutRes> {
    return window.apc.invoke(CH.taskDelete, req) as Promise<TaskMutRes>
  },
  nextActionsApprove(req: NextActionsDecisionReq): Promise<NextActionsDecisionRes> {
    return window.apc.invoke(CH.nextActionsApprove, req) as Promise<NextActionsDecisionRes>
  },
  nextActionsDiscard(req: NextActionsDecisionReq): Promise<NextActionsDecisionRes> {
    return window.apc.invoke(CH.nextActionsDiscard, req) as Promise<NextActionsDecisionRes>
  },
  resumeCard(projectId: string): Promise<ResumeCard | null> {
    return window.apc.invoke(CH.resumeCard, { projectId }) as Promise<ResumeCard | null>
  },
  questionLog(req: { projectId?: string; limit?: number } = {}): Promise<QuestionLogEntry[]> {
    return window.apc.invoke(CH.questionLog, req) as Promise<QuestionLogEntry[]>
  },
  conversationHistory(req: ConversationHistoryReq): Promise<ConversationHistoryRes> {
    return window.apc.invoke(CH.conversationHistory, req) as Promise<ConversationHistoryRes>
  },
  nextNoteAdd(req: NextNoteAddReq): Promise<NextNoteAddRes> {
    return window.apc.invoke(CH.nextNoteAdd, req) as Promise<NextNoteAddRes>
  },
  nextNoteToggle(req: NextNoteToggleReq): Promise<NextNoteMutRes> {
    return window.apc.invoke(CH.nextNoteToggle, req) as Promise<NextNoteMutRes>
  },
  nextNoteDelete(req: NextNoteDeleteReq): Promise<NextNoteMutRes> {
    return window.apc.invoke(CH.nextNoteDelete, req) as Promise<NextNoteMutRes>
  },
  nextNotesList(req: NextNotesListReq): Promise<NextNotesListRes> {
    return window.apc.invoke(CH.nextNotesList, req) as Promise<NextNotesListRes>
  },
  nextNoteUpdate(req: NextNoteUpdateReq): Promise<NextNoteMutationRes> {
    return window.apc.invoke(CH.nextNoteUpdate, req) as Promise<NextNoteMutationRes>
  },
  nextNoteSetPinned(req: NextNoteSetPinnedReq): Promise<NextNoteMutationRes> {
    return window.apc.invoke(CH.nextNoteSetPinned, req) as Promise<NextNoteMutationRes>
  },
  nextNoteSetLifecycle(req: NextNoteSetLifecycleReq): Promise<NextNoteMutationRes> {
    return window.apc.invoke(CH.nextNoteSetLifecycle, req) as Promise<NextNoteMutationRes>
  },
  nextNoteConvertToTask(req: NextNoteConvertToTaskReq): Promise<NextNoteConvertToTaskRes> {
    return window.apc.invoke(CH.nextNoteConvertToTask, req) as Promise<NextNoteConvertToTaskRes>
  },
  agentActivitySnapshot(req: AgentActivitySnapshotReq = {}): Promise<AgentActivitySnapshotRes> {
    return window.apc.invoke(CH.agentActivitySnapshot, req) as Promise<AgentActivitySnapshotRes>
  },
  agentQuestionReconcile(req: AgentQuestionReconcileReq): Promise<AgentQuestionReconcileRes> {
    return window.apc.invoke(CH.agentQuestionReconcile, req) as Promise<AgentQuestionReconcileRes>
  },
  retroPrepare(req: RetroPrepareReq): Promise<RetroPrepareRes> {
    return window.apc.invoke(CH.retroPrepare, req) as Promise<RetroPrepareRes>
  },
  retroAnswer(req: RetroAnswerReq): Promise<RetroAnswerRes> {
    return window.apc.invoke(CH.retroAnswer, req) as Promise<RetroAnswerRes>
  },
  retroTargetNotes(req: RetroTargetNotesReq): Promise<RetroTargetNotesRes> {
    return window.apc.invoke(CH.retroTargetNotes, req) as Promise<RetroTargetNotesRes>
  },
  retroComplete(req: RetroCompleteReq): Promise<RetroCompleteRes> {
    return window.apc.invoke(CH.retroComplete, req) as Promise<RetroCompleteRes>
  },
  receiptIssue(req: ReceiptIssueReq): Promise<ReceiptIssueRes> {
    return window.apc.invoke(CH.receiptIssue, req) as Promise<ReceiptIssueRes>
  },
  gateStatus(req: GateQueryReq): Promise<GateStatusRes> {
    return window.apc.invoke(CH.gateStatus, req) as Promise<GateStatusRes>
  },
  gateInstall(req: GateInstallReq): Promise<GateInstallRes> {
    return window.apc.invoke(CH.gateInstall, req) as Promise<GateInstallRes>
  },
  ingestAll(): Promise<{ sources: number; sessions: number; documents: number }> {
    return window.apc.invoke(CH.ingestAll) as Promise<{ sources: number; sessions: number; documents: number }>
  },
  generateRun(req: GenerateRunReq): Promise<unknown> {
    return window.apc.invoke(CH.generateRun, req)
  },
  generatePreflight(req: GeneratePreflightReq): Promise<GeneratePreflightRes> {
    return window.apc.invoke(CH.generatePreflight, req) as Promise<GeneratePreflightRes>
  },
  generateProject(req: GenerateProjectReq): Promise<GenerateProjectRes> {
    return window.apc.invoke(CH.generateProject, req) as Promise<GenerateProjectRes>
  },
  harnessRun(req: HarnessRunReq): Promise<HarnessRunRes> {
    return window.apc.invoke(CH.harnessRun, req) as Promise<HarnessRunRes>
  },
  harnessResume(req: HarnessResumeReq): Promise<HarnessRunRes> {
    return window.apc.invoke(CH.harnessResume, req) as Promise<HarnessRunRes>
  },
  harnessConfirmNodes(req: HarnessConfirmNodesReq): Promise<HarnessRunRes> {
    return window.apc.invoke(CH.harnessConfirmNodes, req) as Promise<HarnessRunRes>
  },
  harnessGetRun(req: HarnessGetRunReq): Promise<HarnessGetRunRes> {
    return window.apc.invoke(CH.harnessGetRun, req) as Promise<HarnessGetRunRes>
  },
  harnessListRuns(req: HarnessListRunsReq): Promise<HarnessListRunsRes> {
    return window.apc.invoke(CH.harnessListRuns, req) as Promise<HarnessListRunsRes>
  },
  harnessGetProgress(req: HarnessGetProgressReq): Promise<HarnessGetProgressRes> {
    return window.apc.invoke(CH.harnessGetProgress, req) as Promise<HarnessGetProgressRes>
  },
  harnessReadLog(req: HarnessReadLogReq): Promise<HarnessReadLogRes> {
    return window.apc.invoke(CH.harnessReadLog, req) as Promise<HarnessReadLogRes>
  },
  harnessPromote(req: HarnessPromoteReq): Promise<HarnessPromoteRes> {
    return window.apc.invoke(CH.harnessPromote, req) as Promise<HarnessPromoteRes>
  },
  harnessPromoteCanonical(req: HarnessPromoteCanonicalReq): Promise<HarnessPromoteCanonicalRes> {
    return window.apc.invoke(CH.harnessPromoteCanonical, req) as Promise<HarnessPromoteCanonicalRes>
  },
  harnessCanonicalProposals(req: HarnessCanonicalProposalsReq): Promise<HarnessCanonicalProposalsRes> {
    return window.apc.invoke(CH.harnessCanonicalProposals, req) as Promise<HarnessCanonicalProposalsRes>
  },
  harnessSetReviewDecisions(req: HarnessSetReviewDecisionsReq): Promise<HarnessSetReviewDecisionsRes> {
    return window.apc.invoke(CH.harnessSetReviewDecisions, req) as Promise<HarnessSetReviewDecisionsRes>
  },
  harnessReadSourceExcerpt(req: HarnessReadSourceExcerptReq): Promise<HarnessReadSourceExcerptRes> {
    return window.apc.invoke(CH.harnessReadSourceExcerpt, req) as Promise<HarnessReadSourceExcerptRes>
  },
  harnessOpenSourceFile(req: HarnessOpenSourceFileReq): Promise<HarnessOpenSourceFileRes> {
    return window.apc.invoke(CH.harnessOpenSourceFile, req) as Promise<HarnessOpenSourceFileRes>
  },
  harnessProposePolicy(req: HarnessProposePolicyReq): Promise<HarnessProposePolicyRes> {
    return window.apc.invoke(CH.harnessProposePolicy, req) as Promise<HarnessProposePolicyRes>
  },
  harnessApprovePolicy(req: HarnessApprovePolicyReq): Promise<HarnessApprovePolicyRes> {
    return window.apc.invoke(CH.harnessApprovePolicy, req) as Promise<HarnessApprovePolicyRes>
  },
  harnessGetPolicy(req: HarnessGetPolicyReq): Promise<HarnessGetPolicyRes> {
    return window.apc.invoke(CH.harnessGetPolicy, req) as Promise<HarnessGetPolicyRes>
  },
  harnessRevertPolicy(req: HarnessRevertPolicyReq): Promise<HarnessRevertPolicyRes> {
    return window.apc.invoke(CH.harnessRevertPolicy, req) as Promise<HarnessRevertPolicyRes>
  },
  harnessReadStagedDoc(req: HarnessReadStagedDocReq): Promise<HarnessReadStagedDocRes> {
    return window.apc.invoke(CH.harnessReadStagedDoc, req) as Promise<HarnessReadStagedDocRes>
  },
  harnessListStagedDocs(req: HarnessListStagedDocsReq): Promise<HarnessListStagedDocsRes> {
    return window.apc.invoke(CH.harnessListStagedDocs, req) as Promise<HarnessListStagedDocsRes>
  },
  harnessReadGraphEdges(req: HarnessReadGraphEdgesReq): Promise<HarnessReadGraphEdgesRes> {
    return window.apc.invoke(CH.harnessReadGraphEdges, req) as Promise<HarnessReadGraphEdgesRes>
  },
  readProjectWiki(req: ReadProjectWikiReq): Promise<ReadProjectWikiRes> {
    return window.apc.invoke(CH.readProjectWiki, req) as Promise<ReadProjectWikiRes>
  },
  harnessExportWiki(req: HarnessExportWikiReq): Promise<HarnessExportWikiRes> {
    return window.apc.invoke(CH.harnessExportWiki, req) as Promise<HarnessExportWikiRes>
  },
  devHarnessRun(req: DevHarnessRunReq): Promise<DevHarnessRunRes> {
    return window.apc.invoke(CH.devHarnessRun, req) as Promise<DevHarnessRunRes>
  },
  devHarnessCancel(req: DevHarnessCancelReq): Promise<DevHarnessCancelRes> {
    return window.apc.invoke(CH.devHarnessCancel, req) as Promise<DevHarnessCancelRes>
  },
  composeContext(req: ComposeContextReq): Promise<ComposeContextRes> {
    return window.apc.invoke(CH.composeContext, req) as Promise<ComposeContextRes>
  },
  devHarnessReadTranscript(req: DevHarnessReadTranscriptReq): Promise<DevHarnessReadTranscriptRes> {
    return window.apc.invoke(CH.devHarnessReadTranscript, req) as Promise<DevHarnessReadTranscriptRes>
  },
  onDevHarnessLog(cb: (e: DevHarnessLogEvent) => void): () => void {
    // Tolerate a missing preload bridge (e.g. a component test that renders DevHarnessPanel inside a
    // larger tree without stubbing window.apc): no bridge → no live logs, but the panel still mounts.
    return window.apc?.onDevHarnessLog?.(cb) ?? (() => {})
  },
  onDevHarnessStarted(cb: (e: DevHarnessStartedEvent) => void): () => void {
    // Tolerate a missing preload bridge (component tests without a stubbed window.apc).
    return window.apc?.onDevHarnessStarted?.(cb) ?? (() => {})
  },
  submitReview(req: SubmitReviewReq): Promise<SubmitReviewRes> {
    return window.apc.invoke(CH.submitReview, req) as Promise<SubmitReviewRes>
  },
  promoteCurrent(req: PromoteCurrentReq): Promise<unknown> {
    return window.apc.invoke(CH.promoteCurrent, req)
  },
  selectProfile(req: SelectProfileReq): Promise<unknown> {
    return window.apc.invoke(CH.selectProfile, req)
  },
  configPreview(req: ConfigEditReq): Promise<ConfigPreviewRes> {
    return window.apc.invoke(CH.configPreview, req) as Promise<ConfigPreviewRes>
  },
  configApply(req: ConfigEditReq): Promise<ConfigApplyRes> {
    return window.apc.invoke(CH.configApply, req) as Promise<ConfigApplyRes>
  },
  configRollback(req: ConfigRollbackReq): Promise<ConfigRollbackRes> {
    return window.apc.invoke(CH.configRollback, req) as Promise<ConfigRollbackRes>
  },
  fsReadDoc(req: FsReadDocReq): Promise<FsReadDocRes> {
    return window.apc.invoke(CH.fsReadDoc, req) as Promise<FsReadDocRes>
  },
  fsListDocs(req: FsListDocsReq): Promise<FsListDocsRes> {
    return window.apc.invoke(CH.fsListDocs, req) as Promise<FsListDocsRes>
  },
  fileRefsResolve(req: FileRefsResolveReq): Promise<FileRefsResolveRes> {
    return window.apc.invoke(CH.fileRefsResolve, req) as Promise<FileRefsResolveRes>
  },
  filePreviewRead(req: FilePreviewReadReq): Promise<FilePreviewReadRes> {
    return window.apc.invoke(CH.filePreviewRead, req) as Promise<FilePreviewReadRes>
  },
  clipboardReadText(): Promise<ClipboardReadTextRes> {
    return window.apc.invoke(CH.clipboardReadText) as Promise<ClipboardReadTextRes>
  },
  terminalGetPreferences(): Promise<TerminalPreferencesRes> {
    return window.apc.invoke(CH.terminalGetPreferences) as Promise<TerminalPreferencesRes>
  },
  terminalSetPreferences(req: TerminalSetPreferencesReq): Promise<TerminalPreferencesRes> {
    return window.apc.invoke(CH.terminalSetPreferences, req) as Promise<TerminalPreferencesRes>
  },
  terminalDiagnostics(req: TerminalDiagnosticsReq): Promise<TerminalDiagnosticsRes> {
    return window.apc.invoke(CH.terminalDiagnostics, req) as Promise<TerminalDiagnosticsRes>
  },
  changesList(req: ChangesListReq): Promise<ChangesListRes> {
    return window.apc.invoke(CH.changesList, req) as Promise<ChangesListRes>
  },
  changesDiff(req: ChangesDiffReq): Promise<ChangesDiffRes> {
    return window.apc.invoke(CH.changesDiff, req) as Promise<ChangesDiffRes>
  },
  gitStatus(req: GitStatusReq): Promise<GitStatusRes> {
    return window.apc.invoke(CH.gitStatus, req) as Promise<GitStatusRes>
  },
  gitWorktrees(req: GitWorktreesReq): Promise<GitWorktreesRes> {
    return window.apc.invoke(CH.gitWorktrees, req) as Promise<GitWorktreesRes>
  },
  gitFetch(req: GitFetchReq): Promise<GitSyncRes> {
    return window.apc.invoke(CH.gitFetch, req) as Promise<GitSyncRes>
  },
  gitPull(req: GitPullReq): Promise<GitSyncRes> {
    return window.apc.invoke(CH.gitPull, req) as Promise<GitSyncRes>
  },
  gitCommit(req: GitCommitReq): Promise<GitSyncRes> {
    return window.apc.invoke(CH.gitCommit, req) as Promise<GitSyncRes>
  },
  gitPush(req: GitPushReq): Promise<GitSyncRes> {
    return window.apc.invoke(CH.gitPush, req) as Promise<GitSyncRes>
  },

  // PTY (event-based)
  startPty(req: StartPtyReq): void { window.apc.startPty(req) },
  writePty(req: PtyInputReq): void { window.apc.writePty(req) },
  killPty(req: PtyKillReq): void { window.apc.killPty(req) },
  resizePty(req: PtyResizeReq): void { window.apc.resizePty(req) },
  onPtyDataV2(id: string, cb: (event: PtyDataEvent) => void): () => void {
    return window.apc.onPtyDataV2(id, cb)
  },
  onPtyExitV2(id: string, cb: (event: PtyExitEvent) => void): () => void {
    return window.apc.onPtyExitV2(id, cb)
  },
  onAgentActivity(cb: (event: AgentActivity) => void): () => void { return window.apc.onAgentActivity(cb) },
  onHarnessProgress(cb: (e: { runId: string; state: string }) => void): () => void {
    return window.apc.onHarnessProgress(cb)
  },
  onHarnessEngineLog(cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void {
    return window.apc.onHarnessEngineLog(cb)
  },
  onHarnessNodes(cb: (e: HarnessNodesEvent) => void): () => void {
    return window.apc.onHarnessNodes(cb)
  },
  onHarnessActivity(cb: (event: WikiRunEvent) => void): () => void {
    return window.apc.onHarnessActivity(cb)
  },

  // Workspace session persistence
  paneOpened(p: PaneRef): void { window.apc.paneOpened(p) },
  paneClosed(p: PaneRef): void { window.apc.paneClosed(p) },
  selectProject(id: string): void { window.apc.selectProject(id) },
  onWorkspaceRestore(cb: (p: WorkspaceRestore) => void): () => void { return window.apc.onWorkspaceRestore(cb as (p: unknown) => void) },
}
