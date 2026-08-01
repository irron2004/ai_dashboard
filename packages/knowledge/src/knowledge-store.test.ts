import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateKnowledge } from './migrate.js'
import { KnowledgeStore } from './knowledge-store.js'

describe('KnowledgeStore', () => {
  let db: Db
  let store: KnowledgeStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migrateKnowledge(db); store = new KnowledgeStore(db) })

  test('registers a collection and context node', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/decisions', description: 'Accepted decisions', docType: 'decision', statusHint: 'accepted' })
    expect(store.listCollections('p1')).toHaveLength(1)
    expect(store.contextForPath('kc1', 'decisions/ADR-001.md')?.description).toBe('Accepted decisions')
  })

  test('indexes a Markdown document into chunks and replaces old chunks', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    const first = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# Current\n\nFirst version', updatedAt: '2026-06-01T10:00:00Z' })
    const second = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# Current\n\nSecond version', updatedAt: '2026-06-01T10:01:00Z' })
    expect(first.id).toBe(second.id)
    expect(store.getDocument(first.id)?.hash).toBe(second.hash)
    expect(store.listChunks(first.id)).toHaveLength(1)
    expect(store.listChunks(first.id)[0].body).toContain('Second version')
  })

  test('clearProject removes only that project documents and chunks', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertCollection({ id: 'kc2', projectId: 'p2', name: 'Wiki2', rootPath: '/vault/p2', include: ['**/*.md'], exclude: [], includeByDefault: true })
    const a = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# A\n\nalpha', updatedAt: '2026-06-01T10:00:00Z' })
    const b = store.indexMarkdownDoc({ collectionId: 'kc2', projectId: 'p2', relPath: 'current.md', markdown: '# B\n\nbeta', updatedAt: '2026-06-01T10:00:00Z' })

    store.clearProject('p1')

    expect(store.getDocument(a.id)).toBeUndefined()
    expect(store.listChunks(a.id)).toHaveLength(0)
    expect(store.getDocument(b.id)?.id).toBe(b.id)   // p2 intact
    expect(store.listChunks(b.id).length).toBeGreaterThan(0)
    const ftsCount = (db.prepare('SELECT count(*) AS n FROM knowledge_chunk_fts WHERE project_id = ?').get('p1') as { n: number }).n
    expect(ftsCount).toBe(0)
  })

  test('returns a selected chunk with bounded neighbors and heading metadata', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    const doc = store.indexMarkdownDoc({
      collectionId: 'kc1',
      projectId: 'p1',
      relPath: 'guide.md',
      markdown: '# Root\n\nIntro\n\n## Diagnosis\n\nCheck the alarm.\n\n## Resolution\n\nReset the stage.',
      updatedAt: '2026-08-01T10:00:00Z',
    })
    const detail = store.getChunkWithNeighbors(doc.id, 1, 1, 1)
    expect(detail?.chunk.headingPath).toEqual(['Root', 'Diagnosis'])
    expect(detail?.before.map((item) => item.ordinal)).toEqual([0])
    expect(detail?.after.map((item) => item.ordinal)).toEqual([2])
    expect(store.getChunkWithNeighbors(doc.id, 99, 1, 1)).toBeUndefined()
    expect(() => store.getChunkWithNeighbors(doc.id, 1, 21, 0)).toThrow(/between 0 and 20/)
  })
})
