import { describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { NormalizedSession, RetrievalQuery } from '@apc/shared'
import { SearchIndex } from '@apc/search'
import { SessionFtsRetriever } from './session-retriever.js'

function session(id: string, projectId: string, text: string): NormalizedSession {
  return {
    id,
    agentType: 'codex',
    projectId,
    sourceMeta: {
      provider: 'codex',
      sourceKind: 'jsonl-file',
      rawLocator: '/private/codex/session.jsonl',
      sessionHeader: {},
    },
    turns: [{
      uuid: 'turn-uuid',
      role: 'user',
      text,
      timestamp: '2026-08-01T10:00:00Z',
      toolCalls: [],
    }],
    filesTouched: [],
  }
}

function query(overrides: Partial<RetrievalQuery> = {}): RetrievalQuery {
  return {
    text: 'retrieval timeout',
    scope: { projectIds: ['p1'] },
    limit: 10,
    ...overrides,
  }
}

describe('SessionFtsRetriever', () => {
  test('maps session hits to scoped evidence with stable encoded identity and opaque URI', async () => {
    const index = new SearchIndex(new DatabaseSync(':memory:'))
    index.indexSession(session('session/one', 'p1', 'retrieval timeout diagnosis'))
    index.indexSession(session('other', 'p2', 'retrieval timeout outside scope'))
    const retriever = new SessionFtsRetriever(index)

    const result = await retriever.search(query())

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      candidateId: 'session:session%2Fone:turn:0',
      parentId: 'session:session%2Fone',
      projectId: 'p1',
      sourceKind: 'session',
      sourceRank: 1,
      uri: 'apc://session/session%2Fone#turn-0',
      updatedAt: '2026-08-01T10:00:00Z',
      authority: 'raw',
      signals: { conflict: false, stale: false },
    })
    expect(result[0].reasons).toContain('role:user')
    expect(JSON.stringify(result[0])).not.toContain('/private/codex')
  })

  test('returns no candidates when session source is disabled by the query', async () => {
    const index = new SearchIndex(new DatabaseSync(':memory:'))
    index.indexSession(session('s1', 'p1', 'retrieval timeout'))
    const retriever = new SessionFtsRetriever(index)
    await expect(retriever.search(query({ sourceKinds: ['knowledge'] }))).resolves.toEqual([])
  })

  test('preserves source-local ordering as consecutive source ranks', async () => {
    const index = new SearchIndex(new DatabaseSync(':memory:'))
    index.indexSession(session('s2', 'p1', 'retrieval timeout alpha'))
    index.indexSession(session('s1', 'p1', 'retrieval timeout beta'))
    const result = await new SessionFtsRetriever(index).search(query())
    expect(result.map((item) => item.sourceRank)).toEqual([1, 2])
    expect(result.map((item) => item.candidateId)).toEqual([
      'session:s1:turn:0',
      'session:s2:turn:0',
    ])
  })

  test('omits malformed source timestamps and returns an explicit warning', async () => {
    const index = new SearchIndex(new DatabaseSync(':memory:'))
    const malformed = session('s1', 'p1', 'retrieval timeout')
    malformed.turns[0].timestamp = 'yesterday'
    index.indexSession(malformed)
    const [result] = await new SessionFtsRetriever(index).search(query())
    expect(result.updatedAt).toBeUndefined()
    expect(result.warnings).toContain('invalid-session-timestamp')
  })
})
