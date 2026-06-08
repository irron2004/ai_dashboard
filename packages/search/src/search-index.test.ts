import { describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SearchIndex } from './search-index.js'

function session(id: string, projectId: string, texts: [string, string][]) {
  return { id, agentType: 'claude' as const, projectId,
    sourceMeta: { provider: 'claude' as const, sourceKind: 'jsonl-file' as const, rawLocator: '', sessionHeader: {} },
    turns: texts.map(([role, text]) => ({ role: role as 'user' | 'assistant', text, toolCalls: [] })),
    filesTouched: [] }
}

describe('SearchIndex', () => {
  test('indexes turns and finds them by MATCH, scoped by project', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'design the agent session manager'], ['assistant', 'ok']]))
    idx.indexSession(session('s2', 'p2', [['user', 'unrelated billing work']]))

    const hits = idx.search('session manager')
    expect(hits.map((h) => h.sessionId)).toContain('s1')
    expect(idx.search('session manager', { projectId: 'p2' })).toHaveLength(0)
  })

  test('re-indexing a session replaces its old rows', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'first version text']]))
    idx.indexSession(session('s1', 'p1', [['user', 'second version text']]))
    expect(idx.search('first')).toHaveLength(0)
    expect(idx.search('second')).toHaveLength(1)
  })
})
