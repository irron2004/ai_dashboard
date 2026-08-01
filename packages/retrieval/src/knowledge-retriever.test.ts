import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import {
  KnowledgeRetrieval,
  KnowledgeStore,
  migrateKnowledge,
} from '@apc/knowledge'
import type { KnowledgeStatus, RetrievalQuery } from '@apc/shared'
import { KnowledgeFtsRetriever } from './knowledge-retriever.js'

const statuses: KnowledgeStatus[] = [
  'canonical', 'accepted', 'candidate', 'superseded', 'deprecated', 'conflict', 'unknown',
]

describe('KnowledgeFtsRetriever', () => {
  let db: Db
  let store: KnowledgeStore
  let retriever: KnowledgeFtsRetriever

  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    migrateKnowledge(db)
    store = new KnowledgeStore(db)
    store.upsertCollection({
      id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1',
      include: ['**/*.md'], exclude: [], includeByDefault: true,
    })
    statuses.forEach((status) => {
      store.upsertContext({
        collectionId: 'kc1',
        pathPrefix: `/${status}`,
        description: `${status} documents`,
        docType: status === 'conflict' ? 'conflict' : 'wiki',
        statusHint: status,
      })
      store.indexMarkdownDoc({
        collectionId: 'kc1',
        projectId: 'p1',
        relPath: `${status}/retrieval notes.md`,
        markdown: `# ${status}\n\nretrieval mapping evidence`,
        updatedAt: '2026-08-01T10:00:00Z',
      })
    })
    retriever = new KnowledgeFtsRetriever(new KnowledgeRetrieval(db))
  })

  function query(overrides: Partial<RetrievalQuery> = {}): RetrievalQuery {
    return {
      text: 'retrieval mapping',
      scope: { projectIds: ['p1'] },
      limit: 20,
      ...overrides,
    }
  }

  test('maps document/chunk identity, URI, scope and all current authority statuses', async () => {
    const results = await retriever.search(query())
    const byStatus = new Map(results.map((item) => {
      const status = item.title as KnowledgeStatus
      return [status, item]
    }))
    expect(byStatus.get('canonical')).toMatchObject({ authority: 'canonical', projectId: 'p1' })
    expect(byStatus.get('accepted')?.authority).toBe('accepted')
    expect(byStatus.get('candidate')?.authority).toBe('candidate')
    expect(byStatus.get('superseded')?.authority).toBe('deprecated')
    expect(byStatus.get('deprecated')?.authority).toBe('deprecated')
    expect(byStatus.get('unknown')?.authority).toBe('unknown')
    expect(byStatus.get('conflict')).toMatchObject({
      authority: 'unknown', signals: { conflict: true, stale: false },
    })
    expect(byStatus.get('conflict')?.warnings).toContain('conflict-document')
    expect(byStatus.get('deprecated')?.warnings).toContain('deprecated-document')
    expect(byStatus.get('canonical')?.candidateId).toContain('#0')
    expect(byStatus.get('canonical')?.parentId).toContain('canonical/retrieval notes.md')
    expect(byStatus.get('canonical')?.uri).toContain('canonical/retrieval%20notes.md#chunk-0')
    expect(results.map((item) => item.sourceRank)).toEqual(results.map((_, index) => index + 1))
  })

  test('keeps lexical score independent from authority status', async () => {
    const results = await retriever.search(query())
    const canonical = results.find((item) => item.title === 'canonical')
    const candidate = results.find((item) => item.title === 'candidate')
    expect(canonical?.rawScore).toBeCloseTo(candidate?.rawScore ?? Number.NaN)
  })

  test('applies source and knowledge filters without leaking another project', async () => {
    store.upsertCollection({
      id: 'kc2', projectId: 'p2', name: 'Other', rootPath: '/vault/p2',
      include: ['**/*.md'], exclude: [], includeByDefault: true,
    })
    store.indexMarkdownDoc({
      collectionId: 'kc2', projectId: 'p2', relPath: 'other.md',
      markdown: '# Other\n\nretrieval mapping evidence', updatedAt: '2026-08-01T10:00:00Z',
    })
    const results = await retriever.search(query({
      sourceKinds: ['knowledge'],
      filters: { statuses: ['canonical'] },
    }))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ projectId: 'p1', authority: 'canonical' })
    await expect(retriever.search(query({ sourceKinds: ['session'] }))).resolves.toEqual([])
  })

  test('heading paths remain available through the selected chunk neighbor seam', async () => {
    store.indexMarkdownDoc({
      collectionId: 'kc1', projectId: 'p1', relPath: 'candidate/detail.md',
      markdown: '# Retrieval\n\nsummary\n\n## Resolution\n\nunique-neighbor-term',
      updatedAt: '2026-08-01T10:00:00Z',
    })
    const [hit] = await retriever.search(query({ text: 'unique-neighbor-term' }))
    const ordinal = Number(/#(\d+)$/.exec(hit.candidateId)?.[1])
    const detail = store.getChunkWithNeighbors(hit.parentId, ordinal, 1, 1)
    expect(detail?.chunk.headingPath).toEqual(['Retrieval', 'Resolution'])
  })
})
