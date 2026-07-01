import { CH } from '../shared/ipc-contract.js'
import type {
  RegisterProjectReq, UpdateProjectReq, ProjectDashboardReq, ProjectDashboardRes, SearchReq,
  SubmitReviewReq, PromoteCurrentReq, SelectProfileReq, GenerateRunReq,
  GeneratePreflightReq, GeneratePreflightRes, GenerateProjectReq, GenerateProjectRes, HarnessRunReq, HarnessRunRes, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
  HarnessResumeReq, HarnessConfirmNodesReq, HarnessPromoteCanonicalReq, HarnessPromoteCanonicalRes,
  HarnessCanonicalProposalsReq, HarnessCanonicalProposalsRes,
  HarnessProposePolicyReq, HarnessProposePolicyRes,
  HarnessApprovePolicyReq, HarnessApprovePolicyRes,
  HarnessGetPolicyReq, HarnessGetPolicyRes,
  HarnessRevertPolicyReq, HarnessRevertPolicyRes,
  HarnessReadStagedDocReq, HarnessReadStagedDocRes,
  HarnessListStagedDocsReq, HarnessListStagedDocsRes,
  HarnessReadGraphEdgesReq, HarnessReadGraphEdgesRes,
  HarnessExportWikiReq, HarnessExportWikiRes,
  DevHarnessRunReq, DevHarnessRunRes, DevHarnessCancelReq, DevHarnessCancelRes, DevHarnessLogEvent,
  ReadProjectWikiReq, ReadProjectWikiRes,
  StartPtyReq, PtyInputReq, PtyKillReq, PtyResizeReq,
  ConfigEditReq, ConfigPreviewRes, ConfigApplyRes, ConfigRollbackReq, ConfigRollbackRes,
  FsReadDocReq, FsReadDocRes, FsListDocsReq, FsListDocsRes,
  ChangesListReq, ChangesListRes, ChangesDiffReq, ChangesDiffRes,
  HarnessNodesEvent,
  PaneRef, WorkspaceRestore,
} from '../shared/ipc-contract.js'
import type { Project, AgentProfile, UnifiedSearchResponse, Task } from '@apc/shared'

declare global {
  interface Window {
    apc: {
      invoke(channel: string, payload?: unknown): Promise<unknown>
      startPty(req: StartPtyReq): void
      writePty(req: PtyInputReq): void
      killPty(req: PtyKillReq): void
      resizePty(req: PtyResizeReq): void
      onPtyData(cb: (id: string, data: string) => void): () => void
      onPtyExit(cb: (id: string, code: number) => void): () => void
      onHarnessProgress(cb: (e: { runId: string; state: string }) => void): () => void
      onHarnessEngineLog(cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void
      onHarnessNodes(cb: (e: HarnessNodesEvent) => void): () => void
      onDevHarnessLog(cb: (e: DevHarnessLogEvent) => void): () => void
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
  deleteProject(id: string): Promise<{ ok: boolean }> {
    return window.apc.invoke(CH.deleteProject, { id }) as Promise<{ ok: boolean }>
  },
  projectDashboard(req: ProjectDashboardReq): Promise<ProjectDashboardRes> {
    return window.apc.invoke(CH.projectDashboard, req) as Promise<ProjectDashboardRes>
  },
  search(req: SearchReq): Promise<UnifiedSearchResponse> {
    return window.apc.invoke(CH.search, req) as Promise<UnifiedSearchResponse>
  },
  listProfiles(projectPath: string): Promise<AgentProfile[]> {
    return window.apc.invoke(CH.listProfiles, { projectPath }) as Promise<AgentProfile[]>
  },
  tasksList(projectId: string): Promise<Task[]> {
    return window.apc.invoke(CH.tasksList, { projectId }) as Promise<Task[]>
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
  harnessPromote(req: HarnessPromoteReq): Promise<HarnessPromoteRes> {
    return window.apc.invoke(CH.harnessPromote, req) as Promise<HarnessPromoteRes>
  },
  harnessPromoteCanonical(req: HarnessPromoteCanonicalReq): Promise<HarnessPromoteCanonicalRes> {
    return window.apc.invoke(CH.harnessPromoteCanonical, req) as Promise<HarnessPromoteCanonicalRes>
  },
  harnessCanonicalProposals(req: HarnessCanonicalProposalsReq): Promise<HarnessCanonicalProposalsRes> {
    return window.apc.invoke(CH.harnessCanonicalProposals, req) as Promise<HarnessCanonicalProposalsRes>
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
  onDevHarnessLog(cb: (e: DevHarnessLogEvent) => void): () => void {
    return window.apc.onDevHarnessLog(cb)
  },
  submitReview(req: SubmitReviewReq): Promise<unknown> {
    return window.apc.invoke(CH.submitReview, req)
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
  changesList(req: ChangesListReq): Promise<ChangesListRes> {
    return window.apc.invoke(CH.changesList, req) as Promise<ChangesListRes>
  },
  changesDiff(req: ChangesDiffReq): Promise<ChangesDiffRes> {
    return window.apc.invoke(CH.changesDiff, req) as Promise<ChangesDiffRes>
  },

  // PTY (event-based)
  startPty(req: StartPtyReq): void { window.apc.startPty(req) },
  writePty(req: PtyInputReq): void { window.apc.writePty(req) },
  killPty(req: PtyKillReq): void { window.apc.killPty(req) },
  resizePty(req: PtyResizeReq): void { window.apc.resizePty(req) },
  onPtyData(cb: (id: string, data: string) => void): () => void { return window.apc.onPtyData(cb) },
  onPtyExit(cb: (id: string, code: number) => void): () => void { return window.apc.onPtyExit(cb) },
  onHarnessProgress(cb: (e: { runId: string; state: string }) => void): () => void {
    return window.apc.onHarnessProgress(cb)
  },
  onHarnessEngineLog(cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void {
    return window.apc.onHarnessEngineLog(cb)
  },
  onHarnessNodes(cb: (e: HarnessNodesEvent) => void): () => void {
    return window.apc.onHarnessNodes(cb)
  },

  // Workspace session persistence
  paneOpened(p: PaneRef): void { window.apc.paneOpened(p) },
  paneClosed(p: PaneRef): void { window.apc.paneClosed(p) },
  selectProject(id: string): void { window.apc.selectProject(id) },
  onWorkspaceRestore(cb: (p: WorkspaceRestore) => void): () => void { return window.apc.onWorkspaceRestore(cb as (p: unknown) => void) },
}
