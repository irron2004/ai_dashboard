import { randomUUID } from 'node:crypto'
import { TaskSchema, type Task, type TaskStatus } from '@apc/shared'
import type { TaskStore } from './task-store.js'

export type TaskPriority = Task['priority']

export type CreateTaskCommand = {
  projectId: string
  title: string
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: string
}

export type UpdateTaskCommand = {
  projectId: string
  taskId: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  dueDate?: string
}

export type DeleteTaskCommand = { projectId: string; taskId: string }

export type TaskCommandResult =
  | { ok: true; task: Task }
  | { ok: false; reason: string }

function normalizeDueDate(value: string | undefined): string | undefined | null {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

/** Main-process command boundary. IDs and provenance never come from the renderer. */
export class TaskCommandService {
  constructor(
    private readonly tasks: TaskStore,
    private readonly projectExists: (projectId: string) => boolean,
    private readonly nextId: (projectId: string) => string = (projectId) => `task:${projectId}:${randomUUID()}`,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  create(command: CreateTaskCommand): TaskCommandResult {
    if (!this.projectExists(command.projectId)) return { ok: false, reason: 'project-not-found' }
    const title = command.title.trim()
    if (!title) return { ok: false, reason: 'empty-title' }
    const dueDate = normalizeDueDate(command.dueDate)
    if (dueDate === null) return { ok: false, reason: 'invalid-due-date' }
    const timestamp = this.now()
    const task = this.tasks.create(TaskSchema.parse({
      id: this.nextId(command.projectId),
      projectId: command.projectId,
      title,
      status: command.status ?? 'todo',
      assigneeType: 'human',
      priority: command.priority ?? 'medium',
      dueDate,
      source: 'manual',
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    return { ok: true, task }
  }

  update(command: UpdateTaskCommand): TaskCommandResult {
    if (!this.projectExists(command.projectId)) return { ok: false, reason: 'project-not-found' }
    const dueDate = normalizeDueDate(command.dueDate)
    if (dueDate === null) return { ok: false, reason: 'invalid-due-date' }
    return this.tasks.updateUserFields(command.projectId, command.taskId, {
      title: command.title,
      status: command.status,
      priority: command.priority,
      dueDate,
    })
  }

  delete(command: DeleteTaskCommand): TaskCommandResult {
    if (!this.projectExists(command.projectId)) return { ok: false, reason: 'project-not-found' }
    return this.tasks.softDeleteUser(command.projectId, command.taskId)
  }
}

