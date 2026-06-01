import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { AgentRunStore } from './agent-run-store.js'
import type { AgentRun } from '@apc/shared'

const run: AgentRun = {
  id: 'RUN-1', taskId: 'TASK-001', agent: 'codex', repoPath: '/work/apc',
  branch: 'main', startedAt: '2026-06-01T10:00:00Z', status: 'running',
}

describe('AgentRunStore', () => {
  let db: Db; let store: AgentRunStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new AgentRunStore(db) })

  test('create + get round-trips', () => {
    store.create(run)
    expect(store.get('RUN-1')?.agent).toBe('codex')
  })
  test('complete sets endedAt/status/summaryPath', () => {
    store.create(run)
    store.complete('RUN-1', { endedAt: '2026-06-01T10:30:00Z', summaryPath: 'agent-runs/RUN-1-summary.md' })
    const r = store.get('RUN-1')!
    expect(r.status).toBe('completed'); expect(r.summaryPath).toContain('RUN-1')
  })
  test('listByTask returns runs for a task newest-first', () => {
    store.create(run)
    store.create({ ...run, id: 'RUN-2', startedAt: '2026-06-01T11:00:00Z' })
    expect(store.listByTask('TASK-001').map((r) => r.id)).toEqual(['RUN-2', 'RUN-1'])
  })
})
