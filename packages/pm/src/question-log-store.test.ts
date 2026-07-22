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

  test('record skips internal machine prompts', () => {
    store.record(session({
      turns: [
        { role: 'user', text: '진짜 질문', timestamp: '2026-07-07T10:00:00Z', toolCalls: [] },
        {
          role: 'user',
          text: '# Knowledge Harness Rules\n\n## Role: wiki-graph-lead\n\n## Input\n{}\n\n## Output\nRespond with ONLY a single JSON object',
          timestamp: '2026-07-07T10:01:00Z',
          toolCalls: [],
        },
      ],
    }))
    expect(store.listRecent({ projectId: 'p1' }).map((r) => r.text)).toEqual(['진짜 질문'])
  })

  test('listRecent hides previously recorded internal prompts', () => {
    db.prepare('INSERT INTO question_log (session_id, project_id, ts, agent, text) VALUES (?, ?, ?, ?, ?)').run(
      'old', 'p1', '2026-07-07T10:02:00Z', 'claude',
      '# Knowledge Harness Rules\n\n## Role: knowledge-node-extractor\n\n## Input\n{}\n\n## Output',
    )
    db.prepare('INSERT INTO question_log (session_id, project_id, ts, agent, text) VALUES (?, ?, ?, ?, ?)').run(
      'real', 'p1', '2026-07-07T10:01:00Z', 'claude', '사람 질문',
    )
    expect(store.listRecent({ projectId: 'p1' }).map((r) => r.text)).toEqual(['사람 질문'])
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

  test('rows sharing the same fallback ts (no per-turn timestamp) still order deterministically via rowid', () => {
    // Neither turn has its own `timestamp`, so both fall back to the same `startedAt` — without a
    // rowid tiebreaker, ORDER BY ts DESC alone would leave sqlite free to return either order.
    store.record(session({
      id: 's1', projectId: 'p1', startedAt: '2026-07-07T09:00:00Z',
      turns: [
        { role: 'user', text: '먼저 기록된 질문', toolCalls: [] },
        { role: 'user', text: '나중에 기록된 질문', toolCalls: [] },
      ],
    }))
    const first = store.listRecent({ projectId: 'p1' })
    const second = store.listRecent({ projectId: 'p1' })
    expect(first.map((r) => r.text)).toEqual(['나중에 기록된 질문', '먼저 기록된 질문'])
    expect(second.map((r) => r.text)).toEqual(first.map((r) => r.text)) // stable across repeated calls
  })

  test('returns the latest confirmed human question for a session and project', () => {
    store.record(session({ id: 's1', projectId: 'p1' }))
    store.record(session({
      id: 's2', projectId: 'p1',
      turns: [{ role: 'user', text: '프로젝트 최신 질문', timestamp: '2026-07-07T11:00:00Z', toolCalls: [] }],
    }))
    expect(store.latestForSession('s1')?.text).toBe('둘째 질문')
    expect(store.latestByProject('p1')).toMatchObject({ sessionId: 's2', text: '프로젝트 최신 질문' })
    expect(store.latestForSession('missing')).toBeUndefined()
  })

  test('latest queries skip a previously persisted internal prompt', () => {
    store.record(session())
    db.prepare('INSERT INTO question_log (session_id, project_id, ts, agent, text) VALUES (?, ?, ?, ?, ?)').run(
      's1', 'p1', '2026-07-07T12:00:00Z', 'claude',
      '# Knowledge Harness Rules\n\n## Role: wiki-graph-lead\n\n## Input\n{}\n\n## Output\nRespond with ONLY a single JSON object',
    )
    expect(store.latestForSession('s1')?.text).toBe('둘째 질문')
    expect(store.latestByProject('p1')?.text).toBe('둘째 질문')
  })
})
