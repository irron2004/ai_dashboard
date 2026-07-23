import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import type { AgentActivity } from '@apc/shared'
import { migratePm } from './migrate.js'
import { AgentActivityStore } from './agent-activity-store.js'

const base: AgentActivity = {
  pane: {
    paneId: 'pane-1', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1', agent: 'codex', sessionId: 'S1',
  },
  launchId: 'L1', connection: 'connected', phase: 'working', processAlive: true,
  lastActivityAt: '2026-07-20T10:00:00Z', lastInputAt: '2026-07-20T09:59:00Z',
  lastQuestion: {
    displayText: '[민감한 질문]', askedAt: '2026-07-20T09:59:00Z', sessionId: 'S1',
    privacy: 'masked', source: 'pty',
  },
  revision: 3,
}

describe('AgentActivityStore', () => {
  let db: Db
  let store: AgentActivityStore
  let clock: string
  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    migratePm(db)
    clock = '2026-07-20T10:01:00Z'
    store = new AgentActivityStore(db, () => clock)
  })

  test('round-trips pane identity and only sanitized question fields', () => {
    expect(store.put(base)).toBe(true)
    expect(store.get('pane-1')).toEqual(base)
    const row = db.prepare('SELECT * FROM agent_activity WHERE pane_id = ?').get('pane-1') as Record<string, unknown>
    expect(row.last_question_display).toBe('[민감한 질문]')
    expect(Object.keys(row)).not.toContain('last_question_raw')
  })

  test('lists by project and rejects equal or older revisions atomically', () => {
    expect(store.put(base)).toBe(true)
    expect(store.put({ ...base, phase: 'idle', revision: 3 })).toBe(false)
    expect(store.put({ ...base, phase: 'awaiting_user', revision: 2 })).toBe(false)
    expect(store.get('pane-1')?.phase).toBe('working')
    expect(store.put({ ...base, phase: 'idle', revision: 4 })).toBe(true)
    expect(store.get('pane-1')?.phase).toBe('idle')

    store.put({ ...base, pane: { ...base.pane, paneId: 'pane-2', projectId: 'p2' }, revision: 1 })
    expect(store.list('p1').map((item) => item.pane.paneId)).toEqual(['pane-1'])
    expect(store.list()).toHaveLength(2)
  })

  test('normalizes live legacy rows to disconnected on startup without losing phase or question', () => {
    store.put(base)
    expect(store.normalizeStartup()).toBe(1)
    expect(store.get('pane-1')).toMatchObject({
      connection: 'disconnected', phase: 'working', processAlive: false,
      lastActivityAt: base.lastActivityAt, lastQuestion: base.lastQuestion, reason: 'app-restart', revision: 4,
    })
    expect(store.normalizeStartup()).toBe(0)
  })

  test('deletes every activity row for one project only', () => {
    store.put(base)
    store.put({
      ...base,
      pane: { ...base.pane, paneId: 'pane-2', projectId: 'p2' },
      revision: 1,
    })

    expect(store.deleteProject('p1')).toBe(1)
    expect(store.get('pane-1')).toBeUndefined()
    expect(store.list('p2')).toHaveLength(1)
  })

  test('prunes orphaned and expired inactive rows but retains live and recent panes', () => {
    clock = '2026-01-01T00:00:00Z'
    store.put({ ...base, processAlive: false, connection: 'disconnected', revision: 4 })
    store.put({
      ...base,
      pane: { ...base.pane, paneId: 'orphan', projectId: 'deleted-project' },
      processAlive: false, connection: 'disconnected', revision: 4,
    })
    store.put({
      ...base,
      pane: { ...base.pane, paneId: 'live', projectId: 'p2' },
      revision: 4,
    })
    clock = '2026-07-20T00:00:00Z'
    store.put({
      ...base,
      pane: { ...base.pane, paneId: 'recent', projectId: 'p3' },
      processAlive: false, connection: 'disconnected', revision: 4,
    })

    expect(store.pruneInactive('2026-06-20T00:00:00Z', ['p1', 'p2', 'p3'])).toBe(2)
    expect(store.list().map((activity) => activity.pane.paneId).sort()).toEqual(['live', 'recent'])
  })
})
