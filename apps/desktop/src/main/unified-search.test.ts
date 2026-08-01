import { describe, expect, test, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SearchIndex } from '@apc/search'
import {
  KnowledgeFtsRetriever,
  RetrievalService,
  SessionFtsRetriever,
  type Retriever,
} from '@apc/retrieval'
import type { EvidenceCandidate, NormalizedSession } from '@apc/shared'
import { UnifiedSearch } from './unified-search.js'
import { openDb, migrate } from '@apc/core'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval } from '@apc/knowledge'

function session(id: string, projectId: string, text: string): NormalizedSession {
  return {
    id,
    agentType: 'claude',
    projectId,
    sourceMeta: {
      provider: 'claude',
      sourceKind: 'jsonl-file',
      rawLocator: `/private/${id}.jsonl`,
      sessionHeader: {},
    },
    turns: [{ role: 'user', text, toolCalls: [] }],
    filesTouched: [],
  }
}

function fixture(projectIds: string[]) {
  const sessionIndex = new SearchIndex(new DatabaseSync(':memory:'))
  const db = openDb(':memory:')
  migrate(db)
  migrateKnowledge(db)
  const store = new KnowledgeStore(db)
  const registry = { list: () => projectIds.map((id) => ({ id })) }
  const retrieval = new RetrievalService({
    registry,
    retrievers: [
      new SessionFtsRetriever(sessionIndex),
      new KnowledgeFtsRetriever(new KnowledgeRetrieval(db)),
    ],
  })
  return {
    sessionIndex,
    store,
    search: new UnifiedSearch({ retrieval, projectIds: () => projectIds }),
  }
}

function indexKnowledge(
  store: KnowledgeStore,
  projectId: string,
  relPath: string,
  markdown: string,
): void {
  const collectionId = `project:${projectId}`
  store.upsertCollection({
    id: collectionId,
    projectId,
    name: projectId,
    rootPath: `/virtual/${projectId}`,
    include: ['**/*.md'],
    exclude: [],
    includeByDefault: true,
  })
  store.upsertContext({
    collectionId,
    pathPrefix: '/',
    description: 'project documentation',
    docType: 'wiki',
    statusHint: 'canonical',
  })
  store.indexMarkdownDoc({
    collectionId,
    projectId,
    relPath,
    markdown,
    updatedAt: '2026-08-01T00:00:00Z',
  })
}

function evidence(id: string): EvidenceCandidate {
  return {
    candidateId: id,
    parentId: `parent:${id}`,
    sourceKind: 'session',
    projectId: 'p1',
    title: id,
    excerpt: `${id} excerpt`,
    uri: `apc://session/${id}#turn-0`,
    sourceRank: 1,
    fusedScore: 0.99,
    authority: 'raw',
    signals: { conflict: false, stale: false },
    reasons: ['fts:session'],
    warnings: [],
  }
}

describe('UnifiedSearch evidence adapter', () => {
  test('returns session and knowledge candidates through the same RRF response', async () => {
    const { sessionIndex, store, search } = fixture(['p1'])
    sessionIndex.indexSession(session('s1', 'p1', 'shared retrieval keyword in a session'))
    indexKnowledge(store, 'p1', 'wiki/retrieval.md', '# Retrieval\n\nshared retrieval keyword in a wiki')

    const result = await search.searchEvidence({ query: 'shared retrieval', projectId: 'p1' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.response.evidence.map((item) => item.sourceKind).sort()).toEqual([
      'knowledge',
      'session',
    ])
    expect(result.response.evidence.every((item) => item.projectId === 'p1')).toBe(true)
    expect(result.response.evidence.every((item) => item.uri.includes('://'))).toBe(true)
    expect(result.response.diagnostics.retrievers.map((item) => item.id)).toEqual([
      'session-fts',
      'knowledge-fts',
    ])
  })

  test('uses every registered project as an explicit global scope', async () => {
    const { sessionIndex, search } = fixture(['p1', 'p2'])
    sessionIndex.indexSession(session('s1', 'p1', 'global scope token'))
    sessionIndex.indexSession(session('s2', 'p2', 'global scope token'))

    const result = await search.searchEvidence({ query: 'global scope' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.response.query.scope.projectIds).toEqual(['p1', 'p2'])
    expect(result.response.evidence.map((item) => item.projectId).sort()).toEqual(['p1', 'p2'])
  })

  test('never calls retrieval without scope when the registry is empty', async () => {
    const retrieval = { search: vi.fn() }
    const search = new UnifiedSearch({ retrieval, projectIds: () => [] })

    const result = await search.searchEvidence({ query: 'anything' })

    expect(result).toMatchObject({
      ok: false,
      evidence: [],
      diagnostic: { code: 'no-registered-projects' },
    })
    expect(retrieval.search).not.toHaveBeenCalled()
  })

  test('keeps partial evidence and typed retriever diagnostics', async () => {
    const good: Retriever = {
      id: 'session-fts',
      sourceKind: 'session',
      search: async () => [evidence('session-hit')],
    }
    const broken: Retriever = {
      id: 'knowledge-fts',
      sourceKind: 'knowledge',
      search: async () => { throw new Error('knowledge database unavailable') },
    }
    const registry = { list: () => [{ id: 'p1' }] }
    const search = new UnifiedSearch({
      retrieval: new RetrievalService({ registry, retrievers: [good, broken] }),
      projectIds: () => ['p1'],
    })

    const result = await search.searchEvidence({ query: 'session hit', projectId: 'p1' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.response.evidence.map((item) => item.candidateId)).toEqual(['session-hit'])
    expect(result.response.diagnostics.retrievers).toContainEqual(expect.objectContaining({
      id: 'knowledge-fts',
      error: { code: 'retriever-failed', message: 'knowledge database unavailable' },
    }))
  })

  test('retains q:search as an intentionally lossy async adapter', async () => {
    const search = new UnifiedSearch({
      retrieval: {
        search: vi.fn(async (query) => ({
          query,
          evidence: [evidence('legacy')],
          diagnostics: { retrievers: [], droppedDuplicates: 0, droppedByCap: 0 },
        })),
      },
      projectIds: () => ['p1'],
    })

    const result = await search.search({ query: 'legacy', projectId: 'p1' })

    expect(result).toEqual({
      query: 'legacy',
      hits: [{
        kind: 'session',
        id: 'parent:legacy',
        title: 'legacy',
        excerpt: 'legacy excerpt',
        projectId: 'p1',
      }],
    })
    expect(JSON.stringify(result)).not.toContain('apc://')
    expect(JSON.stringify(result)).not.toContain('fusedScore')
  })

  test('legacy empty query returns no hits without invoking retrieval', async () => {
    const retrieval = { search: vi.fn() }
    const search = new UnifiedSearch({ retrieval, projectIds: () => ['p1'] })
    await expect(search.search({ query: '  ' })).resolves.toEqual({ query: '', hits: [] })
    expect(retrieval.search).not.toHaveBeenCalled()
  })
})
