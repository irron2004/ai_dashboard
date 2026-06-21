import type { Project, Task, AgentRun, AgentProfile, Review, AgentType, WikiGeneration, RunState, KhState, ProfileEdits, KhProjectPolicyProposal, EngineOptions } from '@apc/shared'

export const CH = {
  // queries
  listProjects: 'q:listProjects',
  projectDashboard: 'q:projectDashboard',
  search: 'q:search',
  listProfiles: 'q:listProfiles',
  // dialogs
  selectFolder: 'd:selectFolder',
  testSsh: 'd:testSsh',
  // app self-update
  appUpdate: 'c:appUpdate',
  appRestart: 'c:appRestart',
  // commands
  registerProject: 'c:registerProject',
  updateProject: 'c:updateProject',
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
  harnessReadStagedDoc: 'c:harnessReadStagedDoc',
  harnessListStagedDocs: 'c:harnessListStagedDocs',
  harnessReadGraphEdges: 'c:harnessReadGraphEdges',
  harnessExportWiki: 'c:harnessExportWiki',
  submitReview: 'c:submitReview',
  promoteCurrent: 'c:promoteCurrent',
  selectProfile: 'c:selectProfile',
  // pty: renderer → main = ptyStart/ptyInput/ptyKill; main → renderer events = ptyData/ptyExit
  ptyStart: 'pty:start',
  ptyInput: 'pty:input',
  ptyKill: 'pty:kill',
  ptyResize: 'pty:resize',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  harnessProgress: 'harness:progress',
  harnessEngineLog: 'harness:engineLog',
  harnessNodes: 'harness:nodes',
  configPreview: 'c:configPreview',
  configApply: 'c:configApply',
  configRollback: 'c:configRollback',
  // read-only project file access (Knowledge/Home tabs)
  fsReadDoc: 'q:fsReadDoc',
  fsListDocs: 'q:fsListDocs',
  // project working-tree changes (Changes tab)
  changesList: 'q:changesList',
  changesDiff: 'q:changesDiff',
} as const

export type TestSshReq = { host: string; port: number; username: string; remotePath: string }
export type RegisterProjectReq = { name: string; projectType: string; repoPath: string; domain?: string }
export type UpdateProjectReq = { id: string; name: string; projectType: string; repoPath: string; domain?: string }
export type DeleteProjectReq = { id: string }
export type ProjectDashboardReq = { projectId: string }
export type ProjectDashboardRes = { project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[]; allTasks: Task[] }
export type SearchReq = { query: string; projectId?: string }
export type ListProfilesReq = { projectPath: string }
export type SubmitReviewReq = { review: Review }
export type PromoteCurrentReq = { projectId: string; lastReadHash: string }
export type SelectProfileReq = { taskId: string; profileId: string }
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
export type HarnessRunReq = { projectId: string; engine: AgentType; materialize?: boolean; engineOptions?: EngineOptions; workerConcurrency?: number; fullRegen?: boolean; interactive?: boolean }
export type HarnessRunRes = { ok: boolean; runId?: string; finalState?: string; reason?: string }
export type HarnessResumeReq = { runId: string }
export type HarnessConfirmNodesReq = { runId: string; approvedNodes: { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> } }
export type HarnessGetRunReq = { runId: string }
export type HarnessArtifactRes = { state: KhState; name: string; path: string; data: unknown }
export type HarnessGetRunRes = { ok: boolean; runState?: RunState; artifacts?: HarnessArtifactRes[]; reason?: string }
export type HarnessPromoteReq = { runId: string; allowSecrets?: boolean; allowInvalid?: boolean }
export type HarnessPromoteRes = { ok: boolean; promoted?: string[]; proposals?: string[]; refusedCanonical?: string[]; reason?: string }
export type HarnessPromoteCanonicalReq = { runId: string; proposalRelPath: string; lastReadHash: string; allowSecrets?: boolean; allowInvalid?: boolean }
export type HarnessPromoteCanonicalRes = { ok: boolean; status?: 'promoted' | 'conflict'; canonicalPath?: string; newHash?: string; conflictPath?: string; reason?: string }
export type HarnessCanonicalProposalsReq = { runId: string }
export type HarnessCanonicalProposalsRes = Array<{ proposalRelPath: string; canonicalPath: string; currentHash: string | null }>

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
// Publish the project's human-readable wiki into its workspace `wiki/` area (manual export).
export type HarnessExportWikiReq = { projectId: string }
export type HarnessExportWikiRes = { ok: true; target: string; files: number } | { ok: false; reason: string }

/** Generate a work summary + current proposal from a finished agent run's transcript. */
export type GenerateRunReq = {
  runId: string
  agent: AgentType
  transcriptPath: string
  engine: AgentType
  projectId: string
  currentCanonical: string
}

export type StartPtyReq = { id: string; command: string; args: string[]; cwd: string }
export type PtyInputReq = { id: string; data: string }
export type PtyKillReq = { id: string }
export type PtyResizeReq = { id: string; cols: number; rows: number }
export type ListProfilesResult = AgentProfile[]

export type ConfigEditReq = { rawConfigPath: string; rawFormat: 'json' | 'markdown'; profileName: string; edits: ProfileEdits }
export type ConfigPreviewRes = { ok: boolean; errors: string[]; diff: string }
export type ConfigApplyRes = { ok: boolean; errors: string[]; snapshotPath?: string }
export type ConfigRollbackReq = { rawConfigPath: string }
export type ConfigRollbackRes = { ok: boolean; restoredFrom?: string; error?: string }

export type FsReadDocReq = { projectId: string; relPath: string }
export type FsReadDocRes = { ok: boolean; content?: string; reason?: string }
export type FsListDocsReq = { projectId: string }
export type FsListDocsRes = { docs: { relPath: string; mtimeMs: number }[] }

export type ChangesListReq = { projectId: string }
export type ChangesListRes = {
  ok: boolean
  reason?: string
  files?: { path: string; status: 'new' | 'modified' | 'deleted'; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean }[]
}
export type ChangesDiffReq = { projectId: string; relPath: string }
export type ChangesDiffRes = { ok: boolean; patch?: string; reason?: string }
