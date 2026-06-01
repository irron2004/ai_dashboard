import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { TaskStore } from './task-store.js'
import type { Task } from '@apc/shared'

const base: Task = {
  id: 'TASK-001', projectId: 'p1', title: 'first', status: 'todo',
  assigneeType: 'agent', assignee: 'codex', priority: 'high', reviewStatus: 'none',
  acceptanceCriteria: [], linkedWikiPages: [],
}

describe('TaskStore', () => {
  let db: Db; let store: TaskStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new TaskStore(db) })

  test('create + get round-trips', () => {
    store.create(base)
    expect(store.get('TASK-001')?.title).toBe('first')
  })
  test('listByProject filters by project and optional status', () => {
    store.create(base)
    store.create({ ...base, id: 'TASK-002', status: 'done' })
    store.create({ ...base, id: 'TASK-003', projectId: 'p2' })
    expect(store.listByProject('p1').map((t) => t.id).sort()).toEqual(['TASK-001', 'TASK-002'])
    expect(store.listByProject('p1', { status: 'todo' }).map((t) => t.id)).toEqual(['TASK-001'])
  })
  test('updateStatus changes status and reviewStatus', () => {
    store.create(base)
    store.updateStatus('TASK-001', 'review', 'pending')
    const t = store.get('TASK-001')!
    expect(t.status).toBe('review'); expect(t.reviewStatus).toBe('pending')
  })

  test('round-trips PM fields: parentTaskId, acceptanceCriteria, linkedWikiPages, estimate', () => {
    store.create({
      ...base, id: 'TASK-010', parentTaskId: 'TASK-001', estimate: '2d',
      acceptanceCriteria: ['handles empty input', 'logs on failure'],
      linkedWikiPages: ['wiki/architecture.md', 'decisions/ADR-001.md'],
    })
    const t = store.get('TASK-010')!
    expect(t.parentTaskId).toBe('TASK-001')
    expect(t.estimate).toBe('2d')
    expect(t.acceptanceCriteria).toEqual(['handles empty input', 'logs on failure'])
    expect(t.linkedWikiPages).toEqual(['wiki/architecture.md', 'decisions/ADR-001.md'])
  })

  test('defaults acceptanceCriteria/linkedWikiPages to empty arrays', () => {
    store.create({ ...base, id: 'TASK-011', acceptanceCriteria: [], linkedWikiPages: [] })
    const t = store.get('TASK-011')!
    expect(t.acceptanceCriteria).toEqual([])
    expect(t.linkedWikiPages).toEqual([])
  })
})
