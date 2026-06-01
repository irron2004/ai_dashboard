import type { Project, Task, AgentRun, AgentProfile, Review, AgentType } from '@apc/shared'

export const CH = {
  listProjects: 'q:listProjects',
  projectDashboard: 'q:projectDashboard',
  search: 'q:search',
  listProfiles: 'q:listProfiles',
  ingestAll: 'c:ingestAll',
  submitReview: 'c:submitReview',
  promoteCurrent: 'c:promoteCurrent',
  selectProfile: 'c:selectProfile',
} as const

export type ProjectDashboardReq = { projectId: string }
export type ProjectDashboardRes = { project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[] }
export type SearchReq = { query: string; projectId?: string }
export type ListProfilesReq = { projectPath: string }
export type SubmitReviewReq = { review: Review }
export type PromoteCurrentReq = { projectId: string; lastReadHash: string }
export type SelectProfileReq = { taskId: string; profileId: string }
