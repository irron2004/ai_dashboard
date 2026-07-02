import { describe, expect, test } from 'vitest'
import type { Task } from '@apc/shared'
import { unresolvedBlockers, isBlocked, nextUp } from './task-deps.js'

const t = (id: string, status: Task['status'], extra: Partial<Task> = {}): Task => ({
  id, projectId: 'p1', title: id, status, assigneeType: 'agent', priority: 'medium',
  reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], ...extra,
})

describe('unresolvedBlockers / isBlocked', () => {
  test('a not-done blocker blocks the task', () => {
    const list = [t('A', 'todo', { blockedBy: ['B'] }), t('B', 'in_progress')]
    const byId = new Map(list.map((x) => [x.id, x]))
    expect(isBlocked(list[0], byId)).toBe(true)
    expect(unresolvedBlockers(list[0], byId).map((b) => b.id)).toEqual(['B'])
  })
  test('a done blocker and a missing blocker do not block', () => {
    const list = [t('A', 'todo', { blockedBy: ['B', 'ghost'] }), t('B', 'done')]
    const byId = new Map(list.map((x) => [x.id, x]))
    expect(isBlocked(list[0], byId)).toBe(false)
  })
})

describe('nextUp', () => {
  test('unblocked todo/in_progress, sorted by priority then dueDate', () => {
    const list = [
      t('done', 'done'),
      t('blocked', 'todo', { priority: 'high', blockedBy: ['open'] }),
      t('open', 'in_progress', { priority: 'low' }),
      t('p-high', 'todo', { priority: 'high', dueDate: '2026-07-10' }),
      t('p-high-sooner', 'todo', { priority: 'high', dueDate: '2026-07-01' }),
      t('p-med', 'todo', { priority: 'medium' }),
    ]
    expect(nextUp(list).map((x) => x.id)).toEqual(['p-high-sooner', 'p-high', 'p-med', 'open'])
  })
  test('respects the limit', () => {
    expect(nextUp([t('a', 'todo'), t('b', 'todo'), t('c', 'todo')], 2)).toHaveLength(2)
  })
})
