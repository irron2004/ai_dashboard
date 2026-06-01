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
})
