import type { AgentRun, Project, Task } from '@apc/shared'
import type { ProjectRegistry } from '@apc/core'
import type { TaskStore, AgentRunStore } from '@apc/pm'

export type DashboardDeps = { registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }
export type ProjectDashboard = {
  project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[]; allTasks: Task[]
}

export function getProjectDashboard(deps: DashboardDeps, projectId: string): ProjectDashboard {
  const project = deps.registry.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  const all = deps.tasks.listByProject(projectId)
  const activeTasks = all.filter((t) => t.status === 'todo' || t.status === 'in_progress')
  const reviewQueue = all.filter((t) => t.status === 'review')
  const recentRuns = all
    .flatMap((t) => deps.runs.listByTask(t.id))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 10)
  return { project, activeTasks, reviewQueue, recentRuns, allTasks: all }
}
