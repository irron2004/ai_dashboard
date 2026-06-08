import { describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SearchIndex } from '@apc/search'
import { UnifiedSearch } from './unified-search.js'

function session(id: string, projectId: string, texts: [string, string][]) {
  return { id, agentType: 'claude' as const, projectId,
    sourceMeta: { provider: 'claude' as const, sourceKind: 'jsonl-file' as const, rawLocator: '', sessionHeader: {} },
    turns: texts.map(([role, text]) => ({ role: role as 'user' | 'assistant', text, toolCalls: [] })),
    filesTouched: [] }
}

describe('UnifiedSearch', () => {
  test('returns normalized session hits', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'design the agent session manager']]))
    idx.indexSession(session('s2', 'p2', [['user', 'unrelated billing']]))
    const res = new UnifiedSearch({ sessions: idx }).search({ query: 'agent' })
    expect(res.query).toBe('agent')
    expect(res.hits.length).toBe(1)
    expect(res.hits[0]).toMatchObject({ kind: 'session', id: 's1', projectId: 'p1' })
    expect(res.hits[0].excerpt).toContain('agent')
  })

  test('empty/whitespace query returns no hits', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    expect(new UnifiedSearch({ sessions: idx }).search({ query: '  ' }).hits).toEqual([])
  })
})
