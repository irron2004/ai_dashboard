import { TaskSchema, type Task, type TaskStatus, type ReviewStatus } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  id: string; project_id: string; title: string; status: string
  assignee_type: string; assignee: string | null; priority: string
  due_date: string | null; context_package: string | null; review_status: string
}

function toTask(r: Row): Task {
  return TaskSchema.parse({
    id: r.id, projectId: r.project_id, title: r.title, status: r.status,
    assigneeType: r.assignee_type, assignee: r.assignee ?? undefined, priority: r.priority,
    dueDate: r.due_date ?? undefined, contextPackage: r.context_package ?? undefined,
    reviewStatus: r.review_status,
  })
}

export class TaskStore {
  constructor(private readonly db: Db) {}

  create(input: Task): void {
    const t = TaskSchema.parse(input)
    this.db.prepare(
      `INSERT OR REPLACE INTO tasks
       (id, project_id, title, status, assignee_type, assignee, priority, due_date, context_package, review_status)
       VALUES (:id, :projectId, :title, :status, :assigneeType, :assignee, :priority, :dueDate, :contextPackage, :reviewStatus)`,
    ).run({
      id: t.id, projectId: t.projectId, title: t.title, status: t.status,
      assigneeType: t.assigneeType, assignee: t.assignee ?? null, priority: t.priority,
      dueDate: t.dueDate ?? null, contextPackage: t.contextPackage ?? null, reviewStatus: t.reviewStatus,
    })
  }

  get(id: string): Task | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    return r ? toTask(r) : undefined
  }

  listByProject(projectId: string, opts: { status?: TaskStatus } = {}): Task[] {
    const rows = (opts.status
      ? this.db.prepare('SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY id').all(projectId, opts.status)
      : this.db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id').all(projectId)) as Row[]
    return rows.map(toTask)
  }

  updateStatus(id: string, status: TaskStatus, reviewStatus?: ReviewStatus): void {
    if (reviewStatus) this.db.prepare('UPDATE tasks SET status = ?, review_status = ? WHERE id = ?').run(status, reviewStatus, id)
    else this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id)
  }
}
