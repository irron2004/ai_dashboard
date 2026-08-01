import { describe, expect, test } from 'vitest'
import {
  EvidenceCandidateSchema,
  RetrievalQuerySchema,
  RetrievalResponseSchema,
  type EvidenceCandidate,
} from './retrieval-schema.js'

function candidate(overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    candidateId: 'session:s1:turn:0',
    parentId: 'session:s1',
    sourceKind: 'session',
    projectId: 'p1',
    title: 'Session s1',
    excerpt: 'A useful answer',
    uri: 'apc://session/s1#turn-0',
    sourceRank: 1,
    authority: 'raw',
    signals: { conflict: false, stale: false },
    reasons: ['fts'],
    warnings: [],
    ...overrides,
  }
}

describe('RetrievalQuerySchema', () => {
  test.each([
    ['blank query', { text: '   ', scope: { projectIds: ['p1'] }, limit: 10 }],
    ['empty projectIds', { text: 'query', scope: { projectIds: [] }, limit: 10 }],
    ['duplicate projectIds', { text: 'query', scope: { projectIds: ['p1', 'p1'] }, limit: 10 }],
    ['zero limit', { text: 'query', scope: { projectIds: ['p1'] }, limit: 0 }],
    ['unbounded limit', { text: 'query', scope: { projectIds: ['p1'] }, limit: 101 }],
    ['unknown source kind', { text: 'query', scope: { projectIds: ['p1'] }, limit: 10, sourceKinds: ['web'] }],
  ])('rejects %s', (_label, input) => {
    expect(RetrievalQuerySchema.safeParse(input).success).toBe(false)
  })

  test('preserves caller project order while rejecting duplicates', () => {
    const parsed = RetrievalQuerySchema.parse({
      text: '  retrieval architecture  ',
      scope: { projectIds: ['p2', 'p1'] },
      limit: 5,
    })
    expect(parsed.text).toBe('retrieval architecture')
    expect(parsed.scope.projectIds).toEqual(['p2', 'p1'])
  })
})

describe('EvidenceCandidateSchema', () => {
  test.each([
    ['blank candidateId', candidate({ candidateId: ' ' })],
    ['blank parentId', candidate({ parentId: '' })],
    ['blank uri', candidate({ uri: '\t' })],
    ['sourceRank below one', candidate({ sourceRank: 0 })],
    ['unknown sourceKind', { ...candidate(), sourceKind: 'web' }],
    ['unknown authority', { ...candidate(), authority: 'official' }],
    ['conflict encoded as authority', { ...candidate(), authority: 'conflict' }],
    ['missing signals', { ...candidate(), signals: undefined }],
    ['malformed conflict signal', { ...candidate(), signals: { conflict: 'yes', stale: false } }],
    ['malformed updatedAt', candidate({ updatedAt: 'yesterday' })],
  ])('rejects %s', (_label, input) => {
    expect(EvidenceCandidateSchema.safeParse(input).success).toBe(false)
  })

  test('allows canonical authority and conflict signal at the same time', () => {
    const parsed = EvidenceCandidateSchema.parse(candidate({
      sourceKind: 'knowledge',
      authority: 'canonical',
      signals: { conflict: true, stale: false },
      warnings: ['conflict-document'],
    }))
    expect(parsed.authority).toBe('canonical')
    expect(parsed.signals.conflict).toBe(true)
  })
})

describe('RetrievalResponseSchema', () => {
  test('round-trips session and knowledge evidence with a typed partial failure', () => {
    const query = RetrievalQuerySchema.parse({
      text: 'retrieval architecture',
      scope: { projectIds: ['p1'] },
      limit: 10,
    })
    const input = {
      query,
      evidence: [
        candidate(),
        candidate({
          candidateId: 'doc:architecture#0',
          parentId: 'doc:architecture',
          sourceKind: 'knowledge',
          title: 'Retrieval architecture',
          uri: 'pmw://project/p1/wiki/retrieval.md#chunk-0',
          updatedAt: '2026-08-01T00:00:00.000Z',
          rawScore: 2.5,
          fusedScore: 1 / 61,
          authority: 'canonical',
          signals: { conflict: true, stale: false },
          warnings: ['conflict-document'],
        }),
      ],
      diagnostics: {
        retrievers: [
          { id: 'session-fts', candidates: 1, elapsedMs: 2 },
          {
            id: 'knowledge-fts',
            candidates: 0,
            elapsedMs: 3,
            error: { code: 'retriever-failed', message: 'database unavailable' },
          },
        ],
        droppedDuplicates: 0,
        droppedByCap: 0,
      },
    }
    const parsed = RetrievalResponseSchema.parse(input)
    expect(RetrievalResponseSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })

  test('rejects evidence outside the query scope', () => {
    const result = RetrievalResponseSchema.safeParse({
      query: { text: 'query', scope: { projectIds: ['p1'] }, limit: 10 },
      evidence: [candidate({ projectId: 'p2' })],
      diagnostics: { retrievers: [], droppedDuplicates: 0, droppedByCap: 0 },
    })
    expect(result.success).toBe(false)
  })
})
