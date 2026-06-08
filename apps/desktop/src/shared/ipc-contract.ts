import type { Project, Task, AgentRun, AgentProfile, Review, AgentType, WikiGeneration, RunState, KhState, ProfileEdits } from '@apc/shared'

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
  harnessGetRun: 'c:harnessGetRun',
  harnessPromote: 'c:harnessPromote',
  harnessPromoteCanonical: 'c:harnessPromoteCanonical',
  harnessCanonicalProposals: 'c:harnessCanonicalProposals',
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
  configPreview: 'c:configPreview',
  configApply: 'c:configApply',
  configRollback: 'c:configRollback',
} as const

export type TestSshReq = { host: string; port: number; username: string; remotePath: string }
export type RegisterProjectReq = { name: string; projectType: string; repoPath: string }
export type UpdateProjectReq = { id: string; name: string; projectType: string; repoPath: string }
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
export type HarnessRunReq = { projectId: string; engine: AgentType; materialize?: boolean }
export type HarnessRunRes = { ok: boolean; runId?: string; finalState?: string; reason?: string }
export type HarnessResumeReq = { runId: string }
export type HarnessGetRunReq = { runId: string }
export type HarnessArtifactRes = { state: KhState; name: string; path: string; data: unknown }
export type HarnessGetRunRes = { ok: boolean; runState?: RunState; artifacts?: HarnessArtifactRes[]; reason?: string }
export type HarnessPromoteReq = { runId: string; allowSecrets?: boolean; allowInvalid?: boolean }
export type HarnessPromoteRes = { ok: boolean; promoted?: string[]; proposals?: string[]; refusedCanonical?: string[]; reason?: string }
export type HarnessPromoteCanonicalReq = { runId: string; proposalRelPath: string; lastReadHash: string; allowSecrets?: boolean; allowInvalid?: boolean }
export type HarnessPromoteCanonicalRes = { ok: boolean; status?: 'promoted' | 'conflict'; canonicalPath?: string; newHash?: string; conflictPath?: string; reason?: string }
export type HarnessCanonicalProposalsReq = { runId: string }
export type HarnessCanonicalProposalsRes = Array<{ proposalRelPath: string; canonicalPath: string; currentHash: string | null }>

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
