import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { AgentRunStore } from './agent-run-store.js'
import { RunAgent, type AgentRun } from '@apc/shared'

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
  test("RunAgent includes 'harness'", () => {
    expect(RunAgent.parse('harness')).toBe('harness')
  })
  test('fail() marks a run failed with endedAt, preserving transcriptPath', () => {
    store.create({
      id: 'RUN-H', taskId: 'req:P:s1', agent: 'harness', repoPath: '/r',
      startedAt: '2026-07-01T00:00:00.000Z', status: 'running', transcriptPath: '/r/t.log',
    })
    store.fail('RUN-H', { endedAt: '2026-07-01T00:01:00.000Z' })
    const r = store.get('RUN-H')!
    expect(r.status).toBe('failed')
    expect(r.endedAt).toBe('2026-07-01T00:01:00.000Z')
    expect(r.transcriptPath).toBe('/r/t.log')
  })
  test('listRunning returns only running runs across tasks, newest first', () => {
    store.create(run)                                                                     // RUN-1 running @10:00
    store.create({ ...run, id: 'RUN-2', taskId: 'TASK-002', startedAt: '2026-06-01T12:00:00Z' }) // running @12:00
    store.create({ ...run, id: 'RUN-3', startedAt: '2026-06-01T09:00:00Z', status: 'completed', endedAt: '2026-06-01T09:30:00Z' })
    expect(store.listRunning().map((r) => r.id)).toEqual(['RUN-2', 'RUN-1'])
  })
})
