import { beforeEach, describe, expect, test } from 'vitest'
import { migrate, openDb } from '@apc/core'
import { migratePm } from './migrate.js'
import { TaskStore } from './task-store.js'
import { TaskCommandService } from './task-command-service.js'

describe('TaskCommandService', () => {
  let tasks: TaskStore
  let service: TaskCommandService

  beforeEach(() => {
    const db = openDb(':memory:'); migrate(db); migratePm(db)
    const now = () => '2026-07-20T10:00:00.000Z'
    tasks = new TaskStore(db, now)
    service = new TaskCommandService(tasks, (projectId) => ['p1', 'p2'].includes(projectId), () => 'task:p1:manual-1', now)
  })

  test('creates a trimmed human task with server-owned identity and provenance', () => {
    const result = service.create({
      projectId: 'p1', title: '  Ship the form  ', priority: 'high', dueDate: '2026-07-31',
    })
    expect(result).toMatchObject({
      ok: true,
      task: {
        id: 'task:p1:manual-1', title: 'Ship the form', status: 'todo', priority: 'high',
        assigneeType: 'human', source: 'manual', createdAt: '2026-07-20T10:00:00.000Z',
      },
    })
  })

  test('updates only user-owned fields and marks the task edited', () => {
    service.create({ projectId: 'p1', title: 'Before' })
    const result = service.update({
      projectId: 'p1', taskId: 'task:p1:manual-1', title: 'After',
      status: 'in_progress', priority: 'low', dueDate: undefined,
    })
    expect(result).toMatchObject({
      ok: true,
      task: {
        title: 'After', status: 'in_progress', priority: 'low', source: 'manual',
        userEditedAt: '2026-07-20T10:00:00.000Z',
      },
    })
  })

  test('soft-deletes a task and leaves a tombstone outside normal lists', () => {
    service.create({ projectId: 'p1', title: 'Delete me' })
    const result = service.delete({ projectId: 'p1', taskId: 'task:p1:manual-1' })
    expect(result).toMatchObject({ ok: true, task: { deletedAt: '2026-07-20T10:00:00.000Z' } })
    expect(tasks.get('task:p1:manual-1')).toBeUndefined()
    expect(tasks.listByProject('p1')).toEqual([])
    expect(tasks.getIncludingDeleted('task:p1:manual-1')?.deletedAt).toBeTruthy()
  })

  test('rejects invalid ownership and input', () => {
    expect(service.create({ projectId: 'missing', title: 'x' })).toEqual({ ok: false, reason: 'project-not-found' })
    expect(service.create({ projectId: 'p1', title: ' ' })).toEqual({ ok: false, reason: 'empty-title' })
    expect(service.create({ projectId: 'p1', title: 'x', dueDate: 'tomorrow' })).toEqual({ ok: false, reason: 'invalid-due-date' })
    service.create({ projectId: 'p1', title: 'x' })
    expect(service.update({
      projectId: 'p2', taskId: 'task:p1:manual-1', title: 'x', status: 'todo', priority: 'medium',
    })).toEqual({ ok: false, reason: 'project-mismatch' })
  })
})
