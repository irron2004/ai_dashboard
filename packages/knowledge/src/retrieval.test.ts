import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateKnowledge } from './migrate.js'
import { KnowledgeStore } from './knowledge-store.js'
import { KnowledgeRetrieval } from './retrieval.js'

describe('KnowledgeRetrieval', () => {
  let store: KnowledgeStore
  let retrieval: KnowledgeRetrieval
  beforeEach(() => {
    const db: Db = openDb(':memory:')
    migrate(db); migrateKnowledge(db)
    store = new KnowledgeStore(db)
    retrieval = new KnowledgeRetrieval(db)
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/current.md', description: 'Current canonical project state', docType: 'current', statusHint: 'canonical' })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/wiki', description: 'Candidate LLM wiki notes', docType: 'wiki', statusHint: 'candidate' })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/conflicts', description: 'Conflict docs', docType: 'conflict', statusHint: 'conflict' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'wiki/retrieval.md', markdown: '# Retrieval\n\nTemporal and retrieval notes.', updatedAt: '2026-06-01T10:00:00Z' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# Current\n\nTemporal is deferred; retrieval uses FTS.', updatedAt: '2026-06-01T10:01:00Z' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'conflicts/current-conflict.md', markdown: '# Conflict\n\nTemporal retrieval conflict.', updatedAt: '2026-06-01T10:02:00Z' })
  })

  test('searches project-scoped chunks and boosts canonical docs', () => {
    const hits = retrieval.search({ projectId: 'p1', query: 'Temporal retrieval', limit: 5 })
    expect(hits[0].doc.relPath).toBe('current.md')
    expect(hits[0].reasons).toContain('status:canonical')
  })

  test('flags conflict documents as warnings', () => {
    const hits = retrieval.search({ projectId: 'p1', query: 'conflict', limit: 5 })
    expect(hits.some((h) => h.warnings.includes('conflict-document'))).toBe(true)
  })

  test('offers an authority-neutral lexical ranking for cross-source fusion', () => {
    const lexical = retrieval.searchLexical({ projectId: 'p1', query: 'Temporal retrieval', limit: 5 })
    const canonical = lexical.find((hit) => hit.doc.status === 'canonical')
    expect(canonical?.score).toBeTypeOf('number')
    expect(canonical?.reasons).toContain('status:canonical')
    expect(lexical.map((hit) => hit.score)).toEqual([...lexical.map((hit) => hit.score)].sort((a, b) => b - a))
  })
})
