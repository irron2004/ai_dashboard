import { describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SearchIndex } from '@apc/search'
import { UnifiedSearch } from './unified-search.js'
import { openDb, migrate } from '@apc/core'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval } from '@apc/knowledge'

function knowledgeFor(docs: { projectId: string; relPath: string; markdown: string; pathPrefix?: string; docType?: string }[]) {
  const db = openDb(':memory:'); migrate(db); migrateKnowledge(db)
  const store = new KnowledgeStore(db)
  for (const d of docs) {
    const collectionId = `project:${d.projectId}`
    store.upsertCollection({ id: collectionId, projectId: d.projectId, name: d.projectId, rootPath: `/v/${d.projectId}`, include: ['**/*.md'], exclude: [], includeByDefault: true })
    if (d.pathPrefix && d.docType) store.upsertContext({ collectionId, pathPrefix: d.pathPrefix, description: d.docType, docType: d.docType as never, statusHint: 'candidate' })
    store.indexMarkdownDoc({ collectionId, projectId: d.projectId, relPath: d.relPath, markdown: d.markdown, updatedAt: '2026-06-01T00:00:00Z' })
  }
  return new KnowledgeRetrieval(db)
}

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

  test('appends normalized knowledge hits using docType as kind', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'agent orchestration session']]))
    const knowledge = knowledgeFor([{ projectId: 'p1', relPath: 'wiki/notes.md', markdown: '# Notes\n\nagent orchestration wiki', pathPrefix: '/wiki', docType: 'wiki' }])
    const res = new UnifiedSearch({ sessions: idx, knowledge, projectIds: () => ['p1'] }).search({ query: 'orchestration' })
    const kinds = res.hits.map((h) => h.kind)
    expect(kinds).toContain('session')
    expect(kinds).toContain('wiki')
    const wikiHit = res.hits.find((h) => h.kind === 'wiki')!
    expect(wikiHit.projectId).toBe('p1')
    expect(wikiHit.title).toBe('Notes')
    expect(wikiHit.excerpt.length).toBeGreaterThan(0)
    expect(res.hits.findIndex((h) => h.kind === 'wiki')).toBeGreaterThan(res.hits.findIndex((h) => h.kind === 'session'))
  })

  test('projectId filter limits knowledge to that project only', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    const knowledge = knowledgeFor([
      { projectId: 'p1', relPath: 'wiki/a.md', markdown: '# A\n\nshared keyword alpha' },
      { projectId: 'p2', relPath: 'wiki/b.md', markdown: '# B\n\nshared keyword beta' },
    ])
    const us = new UnifiedSearch({ sessions: idx, knowledge, projectIds: () => ['p1', 'p2'] })
    const res = us.search({ query: 'shared', projectId: 'p1' })
    expect(res.hits.every((h) => h.projectId === 'p1')).toBe(true)
    expect(res.hits.length).toBe(1)
  })

  test('no knowledge dep preserves session-only behavior', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'agent thing']]))
    const res = new UnifiedSearch({ sessions: idx }).search({ query: 'agent' })
    expect(res.hits).toHaveLength(1)
    expect(res.hits[0].kind).toBe('session')
  })
})
