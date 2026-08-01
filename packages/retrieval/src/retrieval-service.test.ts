import { describe, expect, test, vi } from 'vitest'
import type { EvidenceCandidate, RetrievalQuery } from '@apc/shared'
import { RetrievalService, RetrievalUnavailableError } from './retrieval-service.js'
import type { Retriever } from './types.js'

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function candidate(
  id: string,
  sourceKind: 'session' | 'knowledge',
  rank: number,
  overrides: Partial<EvidenceCandidate> = {},
): EvidenceCandidate {
  return {
    candidateId: id,
    parentId: `parent:${id}`,
    sourceKind,
    projectId: 'p1',
    title: id,
    excerpt: id,
    uri: sourceKind === 'session' ? `apc://session/${id}#turn-0` : `pmw://project/p1/${id}#chunk-0`,
    sourceRank: rank,
    authority: sourceKind === 'session' ? 'raw' : 'candidate',
    signals: { conflict: false, stale: false },
    reasons: [],
    warnings: [],
    ...overrides,
  }
}

function fakeRetriever(
  id: string,
  sourceKind: 'session' | 'knowledge',
  search: Retriever['search'],
): Retriever {
  return { id, sourceKind, search }
}

const registry = { list: () => [{ id: 'p1' }, { id: 'p2' }] }
const query: RetrievalQuery = { text: 'retrieval', scope: { projectIds: ['p1'] }, limit: 10 }

describe('RetrievalService', () => {
  test('starts independent retrievers in parallel', async () => {
    const release = deferred<void>()
    const started: string[] = []
    const makeBlocking = (id: string, kind: 'session' | 'knowledge') => fakeRetriever(id, kind, async () => {
      started.push(id)
      await release.promise
      return []
    })
    const service = new RetrievalService({
      registry,
      retrievers: [makeBlocking('session-fts', 'session'), makeBlocking('knowledge-fts', 'knowledge')],
    })
    const pending = service.search(query)
    await vi.waitFor(() => expect(started).toEqual(['session-fts', 'knowledge-fts']))
    release.resolve()
    await expect(pending).resolves.toMatchObject({ evidence: [] })
  })

  test('returns partial evidence and a typed diagnostic when one retriever fails', async () => {
    const service = new RetrievalService({
      registry,
      retrievers: [
        fakeRetriever('session-fts', 'session', async () => [candidate('session', 'session', 1)]),
        fakeRetriever('knowledge-fts', 'knowledge', async () => { throw new Error('database unavailable') }),
      ],
      now: (() => { let value = 0; return () => ++value })(),
    })
    const response = await service.search(query)
    expect(response.evidence.map((item) => item.candidateId)).toEqual(['session'])
    expect(response.diagnostics.retrievers).toContainEqual(expect.objectContaining({
      id: 'knowledge-fts',
      error: { code: 'retriever-failed', message: 'database unavailable' },
    }))
  })

  test('throws a typed failure instead of empty success when all retrievers fail', async () => {
    const service = new RetrievalService({
      registry,
      retrievers: [
        fakeRetriever('a', 'session', async () => { throw new Error('a failed') }),
        fakeRetriever('b', 'knowledge', async () => { throw new Error('b failed') }),
      ],
    })
    await expect(service.search(query)).rejects.toBeInstanceOf(RetrievalUnavailableError)
    try {
      await service.search(query)
    } catch (error) {
      expect((error as RetrievalUnavailableError).diagnostics).toHaveLength(2)
    }
  })

  test('fails closed when a retriever returns an out-of-scope candidate', async () => {
    const service = new RetrievalService({
      registry,
      retrievers: [fakeRetriever('bad', 'knowledge', async () => [
        candidate('leak', 'knowledge', 1, { projectId: 'p2' }),
      ])],
    })
    await expect(service.search(query)).rejects.toMatchObject({
      code: 'retrieval-unavailable',
      diagnostics: [expect.objectContaining({ error: expect.objectContaining({ code: 'invalid-candidate' }) })],
    })
  })

  test('executes only source kinds requested by the validated query', async () => {
    const sessionSearch = vi.fn(async () => [candidate('session', 'session', 1)])
    const knowledgeSearch = vi.fn(async () => [candidate('knowledge', 'knowledge', 1)])
    const service = new RetrievalService({
      registry,
      retrievers: [
        fakeRetriever('session', 'session', sessionSearch),
        fakeRetriever('knowledge', 'knowledge', knowledgeSearch),
      ],
    })
    const response = await service.search({ ...query, sourceKinds: ['knowledge'] })
    expect(sessionSearch).not.toHaveBeenCalled()
    expect(knowledgeSearch).toHaveBeenCalledOnce()
    expect(response.evidence.map((item) => item.candidateId)).toEqual(['knowledge'])
  })

  test('fuses ranks, dedupes parents and applies configured source caps', async () => {
    const shared = candidate('shared', 'session', 1)
    const service = new RetrievalService({
      registry,
      retrievers: [
        fakeRetriever('lexical', 'session', async () => [
          shared,
          candidate('same-parent-second', 'session', 2, { parentId: shared.parentId }),
          candidate('session-extra', 'session', 3),
        ]),
        fakeRetriever('semantic', 'session', async () => [
          shared,
          candidate('other', 'session', 2),
        ]),
      ],
      config: { sourceCaps: { session: 2 } },
    })
    const response = await service.search(query)
    expect(response.evidence.map((item) => item.candidateId)).toEqual(['shared', 'other'])
    expect(response.diagnostics.droppedDuplicates).toBe(1)
    expect(response.diagnostics.droppedByCap).toBeGreaterThan(0)
  })

  test('keeps fused relevance primary and preserves independent authority/conflict metadata', async () => {
    const service = new RetrievalService({
      registry,
      retrievers: [fakeRetriever('knowledge', 'knowledge', async () => [
        candidate('strong-unknown', 'knowledge', 1, { authority: 'unknown' }),
        candidate('weak-canonical-conflict', 'knowledge', 2, {
          authority: 'canonical',
          updatedAt: '2020-01-01T00:00:00Z',
          signals: { conflict: true, stale: false },
          warnings: ['conflict-document'],
        }),
      ])],
    })
    const response = await service.search(query)
    expect(response.evidence.map((item) => item.candidateId)).toEqual([
      'strong-unknown',
      'weak-canonical-conflict',
    ])
    expect(response.evidence[1]).toMatchObject({
      authority: 'canonical',
      signals: { conflict: true, stale: false },
      warnings: ['conflict-document'],
      updatedAt: '2020-01-01T00:00:00Z',
    })
  })

  test('rejects invalid source-local rank and source kind as typed invalid output', async () => {
    const service = new RetrievalService({
      registry,
      retrievers: [fakeRetriever('bad', 'session', async () => [
        candidate('wrong-kind', 'knowledge', 2),
      ])],
    })
    await expect(service.search(query)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ error: expect.objectContaining({ code: 'invalid-candidate' }) })],
    })
  })
})
