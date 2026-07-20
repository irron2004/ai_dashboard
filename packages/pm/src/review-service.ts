import { ReviewSchema, TaskSchema, type Review, type Task, type TaskStatus } from '@apc/shared'
import type { Db } from '@apc/core'
import type { TaskStore } from './task-store.js'

const NEXT_STATUS: Record<Review['status'], TaskStatus> = {
  approved: 'done', rejected: 'rejected', needs_changes: 'in_progress',
}

export class ReviewService {
  constructor(
    private readonly db: Db,
    private readonly tasks: TaskStore,
    private readonly nextId: () => string,
  ) {}

  applyReview(input: Review): Task[] {
    const review = ReviewSchema.parse(input)
    this.db.prepare(
      `INSERT OR REPLACE INTO reviews (id, task_id, agent_run_id, reviewer, status, summary, next_tasks)
       VALUES (:id, :taskId, :agentRunId, :reviewer, :status, :summary, :nextTasks)`,
    ).run({
      id: review.id, taskId: review.taskId, agentRunId: review.agentRunId, reviewer: review.reviewer,
      status: review.status, summary: review.summary, nextTasks: JSON.stringify(review.nextTasks),
    })

    this.tasks.updateStatus(review.taskId, NEXT_STATUS[review.status], review.status)

    const parent = this.tasks.get(review.taskId)
    const projectId = parent?.projectId ?? ''
    const created: Task[] = []
    for (const title of review.nextTasks) {
      const t = TaskSchema.parse({
        id: this.nextId(), projectId, title, status: 'todo',
        assigneeType: 'agent', priority: 'medium', reviewStatus: 'none',
        source: 'review', sourceRef: review.id,
      })
      created.push(this.tasks.create(t))
    }
    return created
  }
}
