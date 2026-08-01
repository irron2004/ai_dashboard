import { describe, expect, test } from 'vitest'
import { evaluateRankings, releaseThresholdFailures } from './metrics.js'
import type { EvaluationRanking, RetrievalQualityMetrics } from './types.js'

describe('retrieval evaluation metrics', () => {
  test('computes recall, reciprocal rank, duplication, citations, leakage, and source mix', () => {
    const rankings: EvaluationRanking[] = [{
      queryId: 'q1',
      scopeProjectIds: ['p1'],
      relevantParentIds: ['a', 'b'],
      results: [
        { parentId: 'a', projectId: 'p1', sourceKind: 'session', uri: 'apc://a' },
        { parentId: 'a', projectId: 'p1', sourceKind: 'session', uri: 'apc://a-2' },
        { parentId: 'noise', projectId: 'p2', sourceKind: 'knowledge', uri: null },
        { parentId: 'b', projectId: 'p1', sourceKind: 'knowledge', uri: 'pmw://b' },
      ],
    }, {
      queryId: 'q2',
      scopeProjectIds: ['p1'],
      relevantParentIds: ['z'],
      results: [{ parentId: 'noise', projectId: 'p1', sourceKind: 'knowledge', uri: 'pmw://noise' }],
    }, {
      queryId: 'no-hit',
      scopeProjectIds: ['p1'],
      relevantParentIds: [],
      results: [],
    }]

    expect(evaluateRankings(rankings)).toEqual({
      evaluatedQueries: 2,
      recallAt5: 0.5,
      recallAt10: 0.5,
      mrr: 0.5,
      duplicateParentOccupancy: 2,
      citationCompleteness: 0.8,
      scopeLeakage: 0.2,
      scopeLeakageCount: 1,
      resultCount: 5,
      sourceDistribution: { session: 2, knowledge: 3 },
    })
  })

  test('treats an empty result set as citation-complete and leakage-free', () => {
    const metrics = evaluateRankings([{
      queryId: 'empty', scopeProjectIds: ['p1'], relevantParentIds: [], results: [],
    }])
    expect(metrics).toMatchObject({
      evaluatedQueries: 0,
      recallAt5: 1,
      recallAt10: 1,
      mrr: 1,
      citationCompleteness: 1,
      scopeLeakage: 0,
      resultCount: 0,
    })
  })

  test('reports every failed release threshold without hiding regressions', () => {
    const legacy = {
      evaluatedQueries: 2, recallAt5: 0.8, recallAt10: 0.9, mrr: 0.7,
      duplicateParentOccupancy: 3, citationCompleteness: 0, scopeLeakage: 0,
      scopeLeakageCount: 0, resultCount: 10, sourceDistribution: { session: 5, knowledge: 5 },
    } satisfies RetrievalQualityMetrics
    const current = {
      ...legacy,
      recallAt5: 0.7,
      mrr: 0.6,
      duplicateParentOccupancy: 2,
      citationCompleteness: 0.9,
      scopeLeakage: 0.1,
      scopeLeakageCount: 1,
    }

    expect(releaseThresholdFailures(current, legacy, {
      maxParentOccupancy: 1,
      minimumCitationCompleteness: 1,
      maximumScopeLeakage: 0,
    })).toEqual([
      'scope leakage 0.1 exceeds 0',
      'citation completeness 0.9 is below 1',
      'duplicate parent occupancy 2 exceeds 1',
      'Recall@5 0.7 regressed below legacy 0.8',
      'MRR 0.6 regressed below legacy 0.7',
    ])
  })
})
