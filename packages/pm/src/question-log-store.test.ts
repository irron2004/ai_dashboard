import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import type { NormalizedSession } from '@apc/shared'
import { migratePm } from './migrate.js'
import { QuestionLogStore } from './question-log-store.js'

function session(over: Partial<NormalizedSession> = {}): NormalizedSession {
  return {
    id: 's1', agentType: 'claude', projectId: 'p1',
    sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
    turns: [
      { role: 'user', text: '첫 질문', timestamp: '2026-07-07T10:00:00Z', toolCalls: [] },
      { role: 'assistant', text: '답변', timestamp: '2026-07-07T10:00:05Z', toolCalls: [] },
      { role: 'user', text: '둘째 질문', timestamp: '2026-07-07T10:01:00Z', toolCalls: [] },
    ],
    filesTouched: [], ...over,
  }
}

describe('QuestionLogStore', () => {
  let db: Db; let store: QuestionLogStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new QuestionLogStore(db) })

  test('record stores only user turns, newest-first via listRecent', () => {
    store.record(session())
    const rows = store.listRecent({ projectId: 'p1' })
    expect(rows.map((r) => r.text)).toEqual(['둘째 질문', '첫 질문'])
    expect(rows[0]).toMatchObject({ sessionId: 's1', agent: 'claude', projectId: 'p1' })
  })

  test('record is idempotent per session (re-record → no duplicates)', () => {
    store.record(session())
    store.record(session())
    expect(store.listRecent({ projectId: 'p1' })).toHaveLength(2)
  })

  test('listRecent without projectId spans projects; limit caps rows', () => {
    store.record(session({ id: 's1', projectId: 'p1' }))
    store.record(session({ id: 's2', projectId: 'p2' }))
    expect(store.listRecent()).toHaveLength(4)
    expect(store.listRecent({ limit: 1 })).toHaveLength(1)
  })

  test('session without projectId records nothing', () => {
    store.record(session({ projectId: undefined }))
    expect(store.listRecent()).toHaveLength(0)
  })
})
