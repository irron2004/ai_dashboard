import { describe, expect, test } from 'vitest'
import {
  KnowledgeCollectionSchema,
  KnowledgeContextNodeSchema,
  KnowledgeDocumentSchema,
  KnowledgeChunkSchema,
  KnowledgeSearchHitSchema,
  ContextPackageSchema,
} from './knowledge-schema.js'

describe('Knowledge schemas', () => {
  test('parses a project-scoped Markdown collection', () => {
    const collection = KnowledgeCollectionSchema.parse({
      id: 'kc-project-p1',
      projectId: 'p1',
      name: 'Project Wiki',
      rootPath: '/vault/projects/p1',
      include: ['**/*.md'],
      exclude: ['raw/**'],
      includeByDefault: true,
    })
    expect(collection.include).toEqual(['**/*.md'])
    expect(collection.includeByDefault).toBe(true)
  })

  test('parses a context node with inherited semantics', () => {
    const node = KnowledgeContextNodeSchema.parse({
      collectionId: 'kc-project-p1',
      pathPrefix: '/decisions',
      description: 'Accepted design decisions and ADRs',
      docType: 'decision',
      statusHint: 'accepted',
    })
    expect(node.docType).toBe('decision')
  })

  test('parses a document, chunk, search hit, and context package', () => {
    const doc = KnowledgeDocumentSchema.parse({
      id: 'doc-1',
      collectionId: 'kc-project-p1',
      projectId: 'p1',
      uri: 'pmw://project/p1/decisions/ADR-001.md',
      relPath: 'decisions/ADR-001.md',
      title: 'ADR-001',
      docType: 'decision',
      status: 'accepted',
      hash: 'abc',
      updatedAt: '2026-06-01T10:00:00Z',
      contextText: 'Accepted design decisions and ADRs',
    })
    const chunk = KnowledgeChunkSchema.parse({
      id: 'chunk-1',
      docId: doc.id,
      projectId: 'p1',
      uri: `${doc.uri}#chunk-1`,
      headingPath: ['ADR-001', 'Decision'],
      body: 'Use SQLite FTS5 for MVP retrieval.',
      ordinal: 0,
      tokenEstimate: 7,
      contextText: doc.contextText,
    })
    const hit = KnowledgeSearchHitSchema.parse({
      doc,
      chunk,
      score: 1.5,
      reasons: ['status:accepted', 'fts'],
      warnings: [],
    })
    const pkg = ContextPackageSchema.parse({
      id: 'ctx-TASK-1',
      projectId: 'p1',
      taskId: 'TASK-1',
      query: 'retrieval architecture',
      hits: [hit],
      files: ['decisions/ADR-001.md'],
      generatedAt: '2026-06-01T10:30:00Z',
    })
    expect(pkg.hits[0].doc.status).toBe('accepted')
  })
})
