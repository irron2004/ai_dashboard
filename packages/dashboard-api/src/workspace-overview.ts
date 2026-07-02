import type { AgentRun, Project, Task } from '@apc/shared'
import type { DashboardDeps } from './project-dashboard.js'
import { nextUp } from './task-deps.js'

export type ProjectOverview = {
  project: Project
  activeTaskCount: number   // status todo|in_progress
  runningRuns: AgentRun[]   // status==='running', newest first
  reviewQueueCount: number  // status==='review'
  nextUp: Task[]            // top 3 unblocked actionable tasks (P1 semantics), priority then dueDate
}
export type WorkspaceOverview = { generatedAt: string; projects: ProjectOverview[] }

/**
 * Cross-project overview for the 멀티프로젝트 홈. Running runs are attributed to a project by
 * intersecting the global running set with each project's own task ids (run.taskId → task.projectId);
 * run.repoPath is intentionally NOT used for attribution (it can be shared/ambiguous, esp. ssh://).
 */
export function buildWorkspaceOverview(deps: DashboardDeps): WorkspaceOverview {
  const running = deps.runs.listRunning()  // all in-flight, newest first
  const projects = deps.registry.list().map((project): ProjectOverview => {
    const tasks = deps.tasks.listByProject(project.id)
    const taskIds = new Set(tasks.map((t) => t.id))
    return {
      project,
      activeTaskCount: tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress').length,
      reviewQueueCount: tasks.filter((t) => t.status === 'review').length,
      runningRuns: running.filter((r) => taskIds.has(r.taskId)),  // preserves newest-first order
      nextUp: nextUp(tasks, 3),
    }
  })
  return { generatedAt: new Date().toISOString(), projects }
}
