import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { TaskStore } from './task-store.js'
import { ReviewService } from './review-service.js'
import type { Review, Task } from '@apc/shared'

const task: Task = { id: 'TASK-001', projectId: 'p1', title: 't', status: 'review',
  assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending' }

function review(status: Review['status'], nextTasks: string[] = []): Review {
  return { id: 'REVIEW-1', taskId: 'TASK-001', agentRunId: 'RUN-1', reviewer: 'me', status, summary: 's', nextTasks }
}

describe('ReviewService.applyReview', () => {
  let db: Db; let tasks: TaskStore; let svc: ReviewService; let n: number
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    tasks = new TaskStore(db); tasks.create(task)
    n = 0
    svc = new ReviewService(db, tasks, () => `TASK-NEW-${++n}`)
  })

  test('approved → task done', () => {
    svc.applyReview(review('approved'))
    expect(tasks.get('TASK-001')!.status).toBe('done')
  })
  test('needs_changes → task back to in_progress', () => {
    svc.applyReview(review('needs_changes'))
    expect(tasks.get('TASK-001')!.status).toBe('in_progress')
    expect(tasks.get('TASK-001')!.reviewStatus).toBe('needs_changes')
  })
  test('rejected → task rejected', () => {
    svc.applyReview(review('rejected'))
    expect(tasks.get('TASK-001')!.status).toBe('rejected')
  })
  test('next tasks are created as todo in the same project', () => {
    const created = svc.applyReview(review('approved', ['do follow-up A', 'do follow-up B']))
    expect(created.map((t) => t.title)).toEqual(['do follow-up A', 'do follow-up B'])
    expect(tasks.get('TASK-NEW-1')!.status).toBe('todo')
    expect(tasks.get('TASK-NEW-2')!.projectId).toBe('p1')
  })
  test('persists the review row', () => {
    svc.applyReview(review('approved'))
    const row = db.prepare('SELECT status FROM reviews WHERE id = ?').get('REVIEW-1') as { status: string }
    expect(row.status).toBe('approved')
  })
})
