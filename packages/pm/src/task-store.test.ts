import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { TaskStore, validateBlockedBy } from './task-store.js'
import type { Task } from '@apc/shared'

const base: Task = {
  id: 'TASK-001', projectId: 'p1', title: 'first', status: 'todo',
  assigneeType: 'agent', assignee: 'codex', priority: 'high', reviewStatus: 'none',
  acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [],
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
  test('delete removes a task by id', () => {
    store.create({ id: 'T-del', projectId: 'p1', title: 'x', status: 'todo', assigneeType: 'agent', priority: 'medium', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], reviewStatus: 'none' })
    expect(store.get('T-del')).toBeDefined()
    store.delete('T-del')
    expect(store.get('T-del')).toBeUndefined()
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

  test('round-trips blockedBy and defaults to []', () => {
    store.create(base)
    expect(store.get('TASK-001')?.blockedBy).toEqual([])
    store.create({ ...base, id: 'TASK-020', blockedBy: ['TASK-001', 'TASK-002'] })
    expect(store.get('TASK-020')?.blockedBy).toEqual(['TASK-001', 'TASK-002'])
  })
  test('setBlockedBy updates only the blocked_by column', () => {
    store.create({ ...base, id: 'TASK-021', priority: 'low' })
    store.setBlockedBy('TASK-021', ['TASK-009'])
    const t = store.get('TASK-021')!
    expect(t.blockedBy).toEqual(['TASK-009'])
    expect(t.priority).toBe('low') // other columns untouched
  })

  test('round-trips provenance and assigns timestamps to legacy producer input', () => {
    const fixed = new TaskStore(db, () => '2026-07-20T10:00:00.000Z')
    fixed.create({ ...base, id: 'req:p1:s1', source: 'conversation', sourceRef: 's1' })
    expect(fixed.get('req:p1:s1')).toMatchObject({
      source: 'conversation', sourceRef: 's1',
      createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z',
    })
  })

  test('derived re-ingest preserves user-owned fields after an edit', () => {
    const fixed = new TaskStore(db, () => '2026-07-20T10:00:00.000Z')
    fixed.create({
      ...base, id: 'todo:p1:s1:fix', title: 'Extracted title', source: 'conversation', sourceRef: 's1:fix',
    })
    fixed.updateUserFields('p1', 'todo:p1:s1:fix', {
      title: 'User title', status: 'in_progress', priority: 'low', dueDate: '2026-08-01',
    })
    fixed.create({
      ...base, id: 'todo:p1:s1:fix', title: 'New extracted title', status: 'done',
      priority: 'high', source: 'conversation', sourceRef: 's1:fix',
    })
    expect(fixed.get('todo:p1:s1:fix')).toMatchObject({
      title: 'User title', status: 'in_progress', priority: 'low', dueDate: '2026-08-01',
      userEditedAt: '2026-07-20T10:00:00.000Z', source: 'conversation',
    })
  })

  test('a user tombstone prevents derived tasks from being recreated', () => {
    const fixed = new TaskStore(db, () => '2026-07-20T10:00:00.000Z')
    const extracted = { ...base, id: 'todo:p1:s1:fix', source: 'conversation' as const, sourceRef: 's1:fix' }
    fixed.create(extracted)
    fixed.softDeleteUser('p1', extracted.id)
    fixed.create({ ...extracted, title: 'Re-ingested' })
    expect(fixed.get(extracted.id)).toBeUndefined()
    expect(fixed.getIncludingDeleted(extracted.id)).toMatchObject({ title: 'first', deletedAt: expect.any(String) })
    expect(fixed.listByProject('p1', { includeDeleted: true }).map((task) => task.id)).toContain(extracted.id)
  })

  test('removes only unedited derived tasks that disappear from their source', () => {
    const fixed = new TaskStore(db, () => '2026-07-20T10:00:00.000Z')
    fixed.create({ ...base, id: 'auto', source: 'conversation' })
    fixed.create({ ...base, id: 'edited', source: 'conversation' })
    fixed.updateUserFields('p1', 'edited', { title: 'edited', status: 'todo', priority: 'medium' })
    fixed.create({ ...base, id: 'manual', source: 'manual' })
    expect(fixed.removeMissingDerived('auto')).toBe(true)
    expect(fixed.removeMissingDerived('edited')).toBe(false)
    expect(fixed.removeMissingDerived('manual')).toBe(false)
    expect(fixed.get('auto')).toBeUndefined()
    expect(fixed.get('edited')).toBeDefined()
    expect(fixed.get('manual')).toBeDefined()
  })

  test('replaces next.yml cache rows from canonical while preserving unrelated rows', () => {
    store.create({
      ...base,
      id: 'next:p1:old',
      source: 'system',
      sourceRef: 'next.yml#old',
      userEditedAt: '2026-07-20T00:00:00.000Z',
    })
    store.create({ ...base, id: 'manual', source: 'manual' })
    store.replaceNextYmlTasks('p1', [{
      ...base,
      id: 'next:p1:new',
      title: 'canonical',
      source: 'system',
      sourceRef: 'next.yml#new',
    }])
    expect(store.get('next:p1:old')).toBeUndefined()
    expect(store.get('next:p1:new')).toMatchObject({
      title: 'canonical',
      sourceRef: 'next.yml#new',
      userEditedAt: undefined,
    })
    expect(store.get('manual')).toBeDefined()
  })

  test('rolls back an invalid cache replacement', () => {
    store.create({ ...base, id: 'next:p1:old', source: 'system', sourceRef: 'next.yml#old' })
    expect(() => store.replaceNextYmlTasks('p1', [{
      ...base,
      id: 'next:p2:wrong',
      projectId: 'p2',
      source: 'system',
      sourceRef: 'next.yml#wrong',
    }])).toThrow('invalid next.yml cache task')
    expect(store.get('next:p1:old')).toBeDefined()
  })
})

describe('validateBlockedBy', () => {
  const get = (map: Record<string, Task>) => (id: string) => map[id]
  test('rejects self-reference', () => {
    expect(validateBlockedBy(get({}), 'A', ['A'])).toEqual({ ok: false, reason: 'self-reference' })
  })
  test('rejects a direct 2-cycle (B already blocks A)', () => {
    const B: Task = { ...base, id: 'B', blockedBy: ['A'] }
    expect(validateBlockedBy(get({ B }), 'A', ['B'])).toEqual({ ok: false, reason: 'cycle' })
  })
  test('accepts a fresh edge and ignores unknown blockers', () => {
    expect(validateBlockedBy(get({}), 'A', ['B', 'ghost'])).toEqual({ ok: true })
  })
})
