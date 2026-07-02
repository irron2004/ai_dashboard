import type { Task } from '@apc/shared'

export const PRIORITY_ORDER: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 }

/** Blocker tasks that still block this one: they exist in the map AND are not done. */
export function unresolvedBlockers(task: Task, byId: Map<string, Task>): Task[] {
  return task.blockedBy
    .map((id) => byId.get(id))
    .filter((b): b is Task => b !== undefined && b.status !== 'done')
}

export function isBlocked(task: Task, byId: Map<string, Task>): boolean {
  return unresolvedBlockers(task, byId).length > 0
}

/** Actionable tasks: todo/in_progress and unblocked; sorted priority then dueDate; capped at `limit`. */
export function nextUp(tasks: Task[], limit = 5): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return tasks
    .filter((t) => (t.status === 'todo' || t.status === 'in_progress') && !isBlocked(t, byId))
    .sort((a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'))
    .slice(0, limit)
}
