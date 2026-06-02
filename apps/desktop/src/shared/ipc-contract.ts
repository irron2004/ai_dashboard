import type { Project, Task, AgentRun, AgentProfile, Review, AgentType, WikiGeneration } from '@apc/shared'

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
  generateRun: 'c:generateRun',
  generateProject: 'c:generateProject',
  submitReview: 'c:submitReview',
  promoteCurrent: 'c:promoteCurrent',
  selectProfile: 'c:selectProfile',
  // pty: renderer → main = ptyStart/ptyInput/ptyKill; main → renderer events = ptyData/ptyExit
  ptyStart: 'pty:start',
  ptyInput: 'pty:input',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
} as const

export type TestSshReq = { host: string; port: number; username: string; remotePath: string }
export type RegisterProjectReq = { name: string; projectType: string; repoPath: string }
export type UpdateProjectReq = { id: string; name: string; projectType: string; repoPath: string }
export type DeleteProjectReq = { id: string }
export type ProjectDashboardReq = { projectId: string }
export type ProjectDashboardRes = { project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[] }
export type SearchReq = { query: string; projectId?: string }
export type ListProfilesReq = { projectPath: string }
export type SubmitReviewReq = { review: Review }
export type PromoteCurrentReq = { projectId: string; lastReadHash: string }
export type SelectProfileReq = { taskId: string; profileId: string }
export type GenerateProjectReq = { projectId: string; engine: AgentType }
export type GenerateProjectRes = {
  ok: boolean
  reason?: string
  sessionId?: string
  summaryPath?: string
  proposalPath?: string
  generation?: WikiGeneration
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

export type StartPtyReq = { id: string; command: string; args: string[]; cwd: string }
export type PtyInputReq = { id: string; data: string }
export type PtyKillReq = { id: string }
export type ListProfilesResult = AgentProfile[]
