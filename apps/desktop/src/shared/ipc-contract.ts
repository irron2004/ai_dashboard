import type { Project, Task, AgentRun, AgentProfile, Review, AgentType } from '@apc/shared'

export const CH = {
  // queries
  listProjects: 'q:listProjects',
  projectDashboard: 'q:projectDashboard',
  search: 'q:search',
  listProfiles: 'q:listProfiles',
  // commands
  ingestAll: 'c:ingestAll',
  generateRun: 'c:generateRun',
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

export type ProjectDashboardReq = { projectId: string }
export type ProjectDashboardRes = { project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[] }
export type SearchReq = { query: string; projectId?: string }
export type ListProfilesReq = { projectPath: string }
export type SubmitReviewReq = { review: Review }
export type PromoteCurrentReq = { projectId: string; lastReadHash: string }
export type SelectProfileReq = { taskId: string; profileId: string }

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
