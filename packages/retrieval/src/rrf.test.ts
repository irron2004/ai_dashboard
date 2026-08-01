import { describe, expect, test } from 'vitest'
import type { EvidenceCandidate } from '@apc/shared'
import { weightedRrf } from './rrf.js'

function candidate(
  id: string,
  rank: number,
  rawScore = 0,
  overrides: Partial<EvidenceCandidate> = {},
): EvidenceCandidate {
  return {
    candidateId: id,
    parentId: `parent:${id}`,
    sourceKind: 'session',
    projectId: 'p1',
    title: id,
    excerpt: id,
    uri: `apc://session/${id}#turn-0`,
    sourceRank: rank,
    rawScore,
    authority: 'raw',
    signals: { conflict: false, stale: false },
    reasons: [],
    warnings: [],
    ...overrides,
  }
}

describe('weightedRrf', () => {
  test('a candidate repeated across retrievers outranks a one-source candidate', () => {
    const result = weightedRrf([
      { retrieverId: 'a', candidates: [candidate('shared', 2), candidate('single', 1)] },
      { retrieverId: 'b', candidates: [candidate('shared', 1)] },
    ])
    expect(result.map((item) => item.candidateId)).toEqual(['shared', 'single'])
    expect(result[0].fusedScore).toBeCloseTo(1 / 62 + 1 / 61)
  })

  test('rawScore magnitude never changes fused order', () => {
    const result = weightedRrf([{
      retrieverId: 'fts',
      candidates: [candidate('rank-one', 1, -1_000_000), candidate('rank-two', 2, 1_000_000)],
    }])
    expect(result.map((item) => item.candidateId)).toEqual(['rank-one', 'rank-two'])
  })

  test('rejects a sourceRank below one at the contract boundary', () => {
    expect(() => weightedRrf([{ retrieverId: 'fts', candidates: [candidate('bad', 0)] }])).toThrow()
  })

  test('equal fused ranks are deterministic by candidateId', () => {
    const result = weightedRrf([{
      retrieverId: 'fts',
      candidates: [candidate('z', 1), candidate('a', 1)],
    }])
    expect(result.map((item) => item.candidateId)).toEqual(['a', 'z'])
  })

  test('weight defaults to one and configured weights are applied', () => {
    const defaulted = weightedRrf([{ retrieverId: 'fts', candidates: [candidate('a', 1)] }])
    const weighted = weightedRrf(
      [{ retrieverId: 'fts', candidates: [candidate('a', 1)] }],
      { weights: { fts: 2 } },
    )
    expect(defaulted[0].fusedScore).toBeCloseTo(1 / 61)
    expect(weighted[0].fusedScore).toBeCloseTo(2 / 61)
  })

  test('a disabled retriever contributes nothing', () => {
    const result = weightedRrf([
      { retrieverId: 'disabled', enabled: false, candidates: [candidate('only-disabled', 1)] },
      { retrieverId: 'enabled', candidates: [candidate('enabled', 1)] },
    ])
    expect(result.map((item) => item.candidateId)).toEqual(['enabled'])
  })

  test('does not mutate source candidates and records contribution reasons', () => {
    const input = candidate('a', 1)
    const snapshot = structuredClone(input)
    const result = weightedRrf([{ retrieverId: 'fts', candidates: [input] }])
    expect(input).toEqual(snapshot)
    expect(result[0].reasons).toContain('rrf:fts:rank=1:weight=1')
  })

  test('fails fast when one candidateId refers to conflicting identities', () => {
    expect(() => weightedRrf([
      { retrieverId: 'lexical', candidates: [candidate('same', 1)] },
      {
        retrieverId: 'embedding',
        candidates: [candidate('same', 1, 0, { parentId: 'different-parent' })],
      },
    ])).toThrow(/conflicting evidence identities/)
  })
})
