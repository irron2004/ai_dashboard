import { beforeEach, describe, expect, test, vi } from 'vitest'
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

  test('updating collection metadata preserves indexed documents, chunks, and FTS rows', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    const doc = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'guide.md', markdown: '# Guide\n\npreserved lexical token', updatedAt: '2026-08-01T10:00:00Z' })

    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Renamed Wiki', rootPath: '/vault/p1-new', include: ['**/*.md', '**/*.mdx'], exclude: ['archive/**'], includeByDefault: false })

    expect(store.getDocument(doc.id)?.id).toBe(doc.id)
    expect(store.listChunks(doc.id)).toHaveLength(1)
    const fts = db.prepare("SELECT count(*) AS n FROM knowledge_chunk_fts WHERE knowledge_chunk_fts MATCH 'preserved'").get() as { n: number }
    expect(fts.n).toBe(1)
    expect(store.listCollections('p1')[0]).toMatchObject({ name: 'Renamed Wiki', rootPath: '/vault/p1-new' })
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

  test('lists project documents deterministically and deletes document, chunk, and FTS rows together', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    const b = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'b.md', markdown: '# B\n\nbeta deletion token', updatedAt: '2026-08-01T10:00:00Z' })
    const a = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'a.md', markdown: '# A\n\nalpha retained token', updatedAt: '2026-08-01T10:00:00Z' })

    expect(store.listProjectDocuments('p1').map((doc) => doc.relPath)).toEqual(['a.md', 'b.md'])
    expect(store.deleteDocument(b.id)).toBe(true)
    expect(store.deleteDocument(b.id)).toBe(false)
    expect(store.getDocument(b.id)).toBeUndefined()
    expect(store.listChunks(b.id)).toEqual([])
    expect(store.getDocument(a.id)?.id).toBe(a.id)
    const removedFts = db.prepare("SELECT count(*) AS n FROM knowledge_chunk_fts WHERE knowledge_chunk_fts MATCH 'deletion'").get() as { n: number }
    const retainedFts = db.prepare("SELECT count(*) AS n FROM knowledge_chunk_fts WHERE knowledge_chunk_fts MATCH 'retained'").get() as { n: number }
    expect(removedFts.n).toBe(0)
    expect(retainedFts.n).toBe(1)
  })

  test('applies a project snapshot incrementally and performs zero writes for identical content', () => {
    const collection = { id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true }
    const first = store.applyProjectSnapshot({
      collection,
      documents: [
        { relPath: 'a.md', markdown: '# A\n\nalpha snapshot', updatedAt: '2026-08-01T10:00:00Z' },
        { relPath: 'remove.md', markdown: '# Remove\n\nobsolete snapshot', updatedAt: '2026-08-01T10:00:00Z' },
      ],
    })
    expect(first).toEqual({ total: 2, inserted: 2, updated: 0, deleted: 0, unchanged: 0 })
    const beforeNoop = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

    const second = store.applyProjectSnapshot({
      collection,
      documents: [
        // A changed mtime alone is not a content change and must not rewrite chunks/FTS.
        { relPath: 'a.md', markdown: '# A\n\nalpha snapshot', updatedAt: '2026-08-02T10:00:00Z' },
        { relPath: 'remove.md', markdown: '# Remove\n\nobsolete snapshot', updatedAt: '2026-08-02T10:00:00Z' },
      ],
    })
    const afterNoop = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    expect(second).toEqual({ total: 2, inserted: 0, updated: 0, deleted: 0, unchanged: 2 })
    expect(afterNoop - beforeNoop).toBe(0)

    const third = store.applyProjectSnapshot({
      collection,
      documents: [
        { relPath: 'a.md', markdown: '# A\n\nalpha changed snapshot', updatedAt: '2026-08-02T11:00:00Z' },
        { relPath: 'new.md', markdown: '# New\n\nnew snapshot', updatedAt: '2026-08-02T11:00:00Z' },
      ],
    })
    expect(third).toEqual({ total: 2, inserted: 1, updated: 1, deleted: 1, unchanged: 0 })
    expect(store.listProjectDocuments('p1').map((doc) => doc.relPath)).toEqual(['a.md', 'new.md'])
  })

  test('rolls back the complete snapshot when one changed document cannot be indexed', () => {
    const collection = { id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true }
    store.applyProjectSnapshot({
      collection,
      documents: [{ relPath: 'stable.md', markdown: '# Stable\n\nold durable content', updatedAt: '2026-08-01T10:00:00Z' }],
    })
    const original = store.indexMarkdownDoc.bind(store)
    vi.spyOn(store, 'indexMarkdownDoc').mockImplementation((input) => {
      if (input.relPath === 'explode.md') throw new Error('synthetic chunk failure')
      return original(input)
    })

    expect(() => store.applyProjectSnapshot({
      collection,
      documents: [
        { relPath: 'stable.md', markdown: '# Stable\n\nnew content must roll back', updatedAt: '2026-08-02T10:00:00Z' },
        { relPath: 'explode.md', markdown: '# Explode\n\nboom', updatedAt: '2026-08-02T10:00:00Z' },
      ],
    })).toThrow(/synthetic chunk failure/)

    expect(store.listProjectDocuments('p1').map((doc) => doc.relPath)).toEqual(['stable.md'])
    expect(store.listChunks('kc1:stable.md')[0]?.body).toContain('old durable content')
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
