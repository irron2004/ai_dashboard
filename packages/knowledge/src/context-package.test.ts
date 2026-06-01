import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateKnowledge } from './migrate.js'
import { KnowledgeStore } from './knowledge-store.js'
import { KnowledgeRetrieval } from './retrieval.js'
import { ContextPackageBuilder } from './context-package.js'

describe('ContextPackageBuilder', () => {
  let builder: ContextPackageBuilder
  beforeEach(() => {
    const db: Db = openDb(':memory:')
    migrate(db); migrateKnowledge(db)
    const store = new KnowledgeStore(db)
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/decisions', description: 'Accepted decisions', docType: 'decision', statusHint: 'accepted' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'decisions/ADR-001.md', markdown: '# ADR-001\n\nUse local retrieval.', updatedAt: '2026-06-01T10:00:00Z' })
    builder = new ContextPackageBuilder(new KnowledgeRetrieval(db), () => '2026-06-01T10:30:00Z')
  })

  test('builds JSON/files output for an agent task', () => {
    const pkg = builder.build({ projectId: 'p1', taskId: 'TASK-1', query: 'local retrieval', limit: 5 })
    expect(pkg.id).toBe('ctx-TASK-1')
    expect(pkg.files).toEqual(['decisions/ADR-001.md'])
    expect(pkg.hits[0].doc.uri).toBe('pmw://project/p1/decisions/ADR-001.md')
  })
})
