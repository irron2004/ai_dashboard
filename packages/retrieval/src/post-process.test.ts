import { describe, expect, test } from 'vitest'
import type { EvidenceCandidate } from '@apc/shared'
import { postProcessCandidates } from './post-process.js'

function candidate(
  id: string,
  parentId: string,
  sourceKind: 'session' | 'knowledge',
  fusedScore: number,
  overrides: Partial<EvidenceCandidate> = {},
): EvidenceCandidate {
  return {
    candidateId: id,
    parentId,
    sourceKind,
    projectId: 'p1',
    title: id,
    excerpt: id,
    uri: sourceKind === 'session' ? `apc://session/${id}#turn-0` : `pmw://project/p1/${id}`,
    sourceRank: 1,
    fusedScore,
    authority: sourceKind === 'session' ? 'raw' : 'candidate',
    signals: { conflict: false, stale: false },
    reasons: [],
    warnings: [],
    ...overrides,
  }
}

const defaults = { limit: 10, perParentCap: 1, sourceCaps: { session: 5, knowledge: 5 } }

describe('postProcessCandidates', () => {
  test('merges exact candidate duplicates, reasons, warnings, and signals', () => {
    const result = postProcessCandidates([
      candidate('same', 'parent', 'knowledge', 0.2, { reasons: ['a'] }),
      candidate('same', 'parent', 'knowledge', 0.1, {
        reasons: ['b'], warnings: ['conflict-document'], signals: { conflict: true, stale: false },
      }),
    ], defaults)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      reasons: ['a', 'b'], warnings: ['conflict-document'], signals: { conflict: true, stale: false },
    })
    expect(result.droppedDuplicates).toBe(1)
  })

  test('returns one deterministic representative per parent by default', () => {
    const result = postProcessCandidates([
      candidate('lower', 'parent', 'knowledge', 0.1),
      candidate('higher', 'parent', 'knowledge', 0.2),
    ], defaults)
    expect(result.candidates.map((item) => item.candidateId)).toEqual(['higher'])
  })

  test('supports a deterministic per-parent cap', () => {
    const result = postProcessCandidates([
      candidate('c', 'parent', 'knowledge', 0.1),
      candidate('a', 'parent', 'knowledge', 0.3),
      candidate('b', 'parent', 'knowledge', 0.2),
    ], { ...defaults, perParentCap: 2 })
    expect(result.candidates.map((item) => item.candidateId)).toEqual(['a', 'b'])
  })

  test('per-source cap prevents one source monopoly', () => {
    const result = postProcessCandidates([
      candidate('s1', 'ps1', 'session', 0.5),
      candidate('s2', 'ps2', 'session', 0.4),
      candidate('k1', 'pk1', 'knowledge', 0.1),
    ], { ...defaults, sourceCaps: { session: 1, knowledge: 5 } })
    expect(result.candidates.map((item) => item.candidateId)).toEqual(['s1', 'k1'])
    expect(result.droppedByCap).toBe(1)
  })

  test('applies the final limit after dedupe and caps', () => {
    const result = postProcessCandidates([
      candidate('a', 'pa', 'session', 0.5),
      candidate('a2', 'pa', 'session', 0.4),
      candidate('b', 'pb', 'knowledge', 0.3),
      candidate('c', 'pc', 'knowledge', 0.2),
    ], { ...defaults, limit: 2 })
    expect(result.candidates.map((item) => item.candidateId)).toEqual(['a', 'b'])
    expect(result.droppedDuplicates).toBe(1)
    expect(result.droppedByCap).toBe(1)
  })

  test('does not mutate input candidates', () => {
    const input = [candidate('a', 'pa', 'session', 0.5)]
    const snapshot = structuredClone(input)
    postProcessCandidates(input, defaults)
    expect(input).toEqual(snapshot)
  })

  test('fails fast when one candidateId refers to conflicting identities', () => {
    expect(() => postProcessCandidates([
      candidate('same', 'parent-a', 'knowledge', 0.2),
      candidate('same', 'parent-b', 'knowledge', 0.1),
    ], defaults)).toThrow(/conflicting evidence identities/)
  })

  test('uses authority only as an equal-relevance tie-break without changing RRF scores', () => {
    const raw = candidate('raw', 'raw-parent', 'session', 0.5)
    const canonical = candidate('canonical', 'canonical-parent', 'knowledge', 0.5, {
      authority: 'canonical',
      signals: { conflict: true, stale: false },
      warnings: ['conflict-document'],
    })
    const result = postProcessCandidates([raw, canonical], { ...defaults, prioritizeAuthority: true })
    expect(result.candidates.map((item) => item.candidateId)).toEqual(['canonical', 'raw'])
    expect(result.candidates[0]).toMatchObject({
      fusedScore: 0.5,
      signals: { conflict: true, stale: false },
      warnings: ['conflict-document'],
    })
  })
})
