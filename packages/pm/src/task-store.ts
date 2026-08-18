import {
  TaskSchema, taskSourceOf,
  type Task, type TaskStatus, type ReviewStatus,
} from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  id: string; project_id: string; title: string; status: string
  assignee_type: string; assignee: string | null; priority: string
  due_date: string | null; estimate: string | null; parent_task_id: string | null
  acceptance_criteria: string; linked_wiki_pages: string; blocked_by: string
  context_package: string | null; review_status: string
  source: string | null; source_ref: string | null
  created_at: string | null; updated_at: string | null
  user_edited_at: string | null; deleted_at: string | null
}

function toTask(row: Row): Task {
  return TaskSchema.parse({
    id: row.id, projectId: row.project_id, title: row.title, status: row.status,
    assigneeType: row.assignee_type, assignee: row.assignee ?? undefined, priority: row.priority,
    dueDate: row.due_date ?? undefined, estimate: row.estimate ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria),
    linkedWikiPages: JSON.parse(row.linked_wiki_pages),
    blockedBy: JSON.parse(row.blocked_by),
    contextPackage: row.context_package ?? undefined, reviewStatus: row.review_status,
    source: row.source ?? 'manual', sourceRef: row.source_ref ?? undefined,
    createdAt: row.created_at ?? undefined, updatedAt: row.updated_at ?? undefined,
    userEditedAt: row.user_edited_at ?? undefined, deletedAt: row.deleted_at ?? undefined,
  })
}

type UserTaskPatch = Pick<Task, 'title' | 'status' | 'priority'> & { dueDate?: string }
type TaskMutationResult =
  | { ok: true; task: Task }
  | { ok: false; reason: 'task-not-found' | 'project-mismatch' | 'empty-title' }

export class TaskStore {
  constructor(private readonly db: Db, private readonly now: () => string = () => new Date().toISOString()) {}

  private put(task: Task): Task {
    const parsed = TaskSchema.parse(task)
    this.db.prepare(
      `INSERT INTO tasks
       (id, project_id, title, status, assignee_type, assignee, priority, due_date,
        estimate, parent_task_id, acceptance_criteria, linked_wiki_pages, context_package,
        review_status, blocked_by, source, source_ref, created_at, updated_at, user_edited_at, deleted_at)
       VALUES (:id, :projectId, :title, :status, :assigneeType, :assignee, :priority, :dueDate,
        :estimate, :parentTaskId, :acceptanceCriteria, :linkedWikiPages, :contextPackage,
        :reviewStatus, :blockedBy, :source, :sourceRef, :createdAt, :updatedAt, :userEditedAt, :deletedAt)
       ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        status = excluded.status,
        assignee_type = excluded.assignee_type,
        assignee = excluded.assignee,
        priority = excluded.priority,
        due_date = excluded.due_date,
        estimate = excluded.estimate,
        parent_task_id = excluded.parent_task_id,
        acceptance_criteria = excluded.acceptance_criteria,
        linked_wiki_pages = excluded.linked_wiki_pages,
        context_package = excluded.context_package,
        review_status = excluded.review_status,
        blocked_by = excluded.blocked_by,
        source = excluded.source,
        source_ref = excluded.source_ref,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        user_edited_at = excluded.user_edited_at,
        deleted_at = excluded.deleted_at`,
    ).run({
      id: parsed.id, projectId: parsed.projectId, title: parsed.title, status: parsed.status,
      assigneeType: parsed.assigneeType, assignee: parsed.assignee ?? null, priority: parsed.priority,
      dueDate: parsed.dueDate ?? null, estimate: parsed.estimate ?? null,
      parentTaskId: parsed.parentTaskId ?? null,
      acceptanceCriteria: JSON.stringify(parsed.acceptanceCriteria),
      linkedWikiPages: JSON.stringify(parsed.linkedWikiPages),
      contextPackage: parsed.contextPackage ?? null, reviewStatus: parsed.reviewStatus,
      blockedBy: JSON.stringify(parsed.blockedBy), source: taskSourceOf(parsed),
      sourceRef: parsed.sourceRef ?? null, createdAt: parsed.createdAt ?? null,
      updatedAt: parsed.updatedAt ?? null, userEditedAt: parsed.userEditedAt ?? null,
      deletedAt: parsed.deletedAt ?? null,
    })
    return this.getIncludingDeleted(parsed.id)!
  }

  /**
   * Producer-aware upsert. Derived tasks may refresh until a user edits or deletes them; those user
   * decisions survive later transcript/review ingestion.
   */
  create(input: Task): Task {
    const parsed = TaskSchema.parse(input)
    const existing = this.getIncludingDeleted(parsed.id)
    if (existing?.deletedAt) return existing

    const now = this.now()
    const source = parsed.source ?? existing?.source ?? 'manual'
    const derived = source !== 'manual'
    const preserveUserFields = derived && Boolean(existing?.userEditedAt)
    const blockedBy = derived && existing && existing.blockedBy.length > 0 && parsed.blockedBy.length === 0
      ? existing.blockedBy
      : parsed.blockedBy

    const next = TaskSchema.parse({
      ...parsed,
      title: preserveUserFields ? existing!.title : parsed.title,
      status: preserveUserFields ? existing!.status : parsed.status,
      priority: preserveUserFields ? existing!.priority : parsed.priority,
      dueDate: preserveUserFields ? existing!.dueDate : parsed.dueDate,
      blockedBy,
      source,
      sourceRef: parsed.sourceRef ?? existing?.sourceRef,
      createdAt: existing?.createdAt ?? parsed.createdAt ?? now,
      updatedAt: preserveUserFields ? (existing?.updatedAt ?? now) : (parsed.updatedAt ?? now),
      userEditedAt: existing?.userEditedAt ?? parsed.userEditedAt,
      deletedAt: existing?.deletedAt ?? parsed.deletedAt,
    })
    return this.put(next)
  }

  get(id: string): Task | undefined {
    const row = this.db.prepare(
      'SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL',
    ).get(id) as Row | undefined
    return row ? toTask(row) : undefined
  }

  getIncludingDeleted(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    return row ? toTask(row) : undefined
  }

  listByProject(
    projectId: string,
    opts: { status?: TaskStatus; includeDeleted?: boolean } = {},
  ): Task[] {
    const clauses = ['project_id = ?']
    const params: string[] = [projectId]
    if (!opts.includeDeleted) clauses.push('deleted_at IS NULL')
    if (opts.status) { clauses.push('status = ?'); params.push(opts.status) }
    const rows = this.db.prepare(
      `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY id`,
    ).all(...params) as Row[]
    return rows.map(toTask)
  }

  /**
   * Replace only this project's `next.yml#...` rows with a canonical file snapshot.
   *
   * This intentionally bypasses producer/user-edit preservation: for a file-managed project,
   * `next.yml` is the truth and these rows are a disposable compatibility/search cache.
   * Legacy/manual/conversation rows outside the `next.yml#` namespace are left untouched.
   */
  replaceNextYmlTasks(projectId: string, tasks: Task[]): void {
    const parsed = tasks.map((task) => {
      const value = TaskSchema.parse(task)
      if (value.projectId !== projectId || !value.sourceRef?.startsWith('next.yml#')) {
        throw new Error('invalid next.yml cache task')
      }
      return value
    })
    const keep = new Set(parsed.map((task) => task.id))
    this.db.exec('SAVEPOINT replace_next_yml_tasks')
    try {
      for (const task of parsed) {
        this.put(TaskSchema.parse({ ...task, userEditedAt: undefined, deletedAt: undefined }))
      }
      const rows = this.db.prepare(
        `SELECT id FROM tasks
         WHERE project_id = ? AND source_ref LIKE 'next.yml#%'`,
      ).all(projectId) as Array<{ id: string }>
      for (const row of rows) {
        if (!keep.has(row.id)) this.db.prepare('DELETE FROM tasks WHERE id = ?').run(row.id)
      }
      this.db.exec('RELEASE SAVEPOINT replace_next_yml_tasks')
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT replace_next_yml_tasks')
      this.db.exec('RELEASE SAVEPOINT replace_next_yml_tasks')
      throw error
    }
  }

  updateUserFields(projectId: string, id: string, patch: UserTaskPatch): TaskMutationResult {
    const existing = this.get(id)
    if (!existing) return { ok: false, reason: 'task-not-found' }
    if (existing.projectId !== projectId) return { ok: false, reason: 'project-mismatch' }
    const title = patch.title.trim()
    if (!title) return { ok: false, reason: 'empty-title' }
    const editedAt = this.now()
    const task = this.put(TaskSchema.parse({
      ...existing,
      title,
      status: patch.status,
      priority: patch.priority,
      dueDate: patch.dueDate?.trim() || undefined,
      userEditedAt: editedAt,
      updatedAt: editedAt,
    }))
    return { ok: true, task }
  }

  softDeleteUser(projectId: string, id: string): TaskMutationResult {
    const existing = this.get(id)
    if (!existing) return { ok: false, reason: 'task-not-found' }
    if (existing.projectId !== projectId) return { ok: false, reason: 'project-mismatch' }
    const editedAt = this.now()
    const task = this.put(TaskSchema.parse({
      ...existing, userEditedAt: editedAt, updatedAt: editedAt, deletedAt: editedAt,
    }))
    return { ok: true, task }
  }

  /** Remove a source task that vanished only when no user decision must be preserved. */
  removeMissingDerived(id: string): boolean {
    const existing = this.getIncludingDeleted(id)
    if (!existing || existing.deletedAt || existing.userEditedAt || taskSourceOf(existing) === 'manual') return false
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return true
  }

  setBlockedBy(id: string, blockedBy: string[]): void {
    const editedAt = this.now()
    this.db.prepare(
      `UPDATE tasks SET blocked_by = ?, updated_at = ?, user_edited_at = COALESCE(user_edited_at, ?)
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(JSON.stringify(blockedBy), editedAt, editedAt, id)
  }

  updateStatus(id: string, status: TaskStatus, reviewStatus?: ReviewStatus): void {
    const updatedAt = this.now()
    if (reviewStatus) {
      this.db.prepare(
        'UPDATE tasks SET status = ?, review_status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      ).run(status, reviewStatus, updatedAt, id)
    } else {
      this.db.prepare(
        'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      ).run(status, updatedAt, id)
    }
  }

  /** Internal hard delete retained for maintenance/tests. User deletion must use softDeleteUser. */
  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }
}

/**
 * Guard for a proposed blockedBy edit. Rejects a self-reference and a DIRECT 2-cycle
 * (the proposed blocker already lists `taskId` among its own blockers). Deep/transitive
 * cycle detection (A→B→C→A) is intentionally out of scope for this MVP.
 */
export function validateBlockedBy(
  getTask: (id: string) => Task | undefined,
  taskId: string,
  blockedBy: string[],
): { ok: true } | { ok: false; reason: 'self-reference' | 'cycle' } {
  if (blockedBy.includes(taskId)) return { ok: false, reason: 'self-reference' }
  for (const blockerId of blockedBy) {
    const blocker = getTask(blockerId)
    if (blocker?.blockedBy.includes(taskId)) return { ok: false, reason: 'cycle' }
  }
  return { ok: true }
}
