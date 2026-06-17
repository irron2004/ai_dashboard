import { describe, expect, test } from 'vitest'
import { dedupeProposalIds, demoteUnderEvidencedShared, pruneUnverifiableEvidence } from './merge-proposals.js'
import type { KhNodeProposal } from '@apc/shared'

const p = (proposal_id: string, nodeId: string): KhNodeProposal => ({
  proposal_id, proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
  node: { id: nodeId, type: 'ConceptNode', title: nodeId },
  evidence: [], claims: [],
} as unknown as KhNodeProposal)

const scoped = (scope: string, evCount: number): KhNodeProposal => ({
  proposal_id: `np-${scope}-${evCount}`, proposed_by: 'extractor', created_at: 't',
  node: { id: 'n', type: 'ConceptNode', title: 'n', scope },
  evidence: Array.from({ length: evCount }, (_, i) => ({ evidence_id: `e${i}`, source_id: 's', source_path: 'raw/s', evidence_type: 'd' })),
  claims: [{ claim_id: 'c', text: 'x', evidence_ids: ['e0'] }],
} as unknown as KhNodeProposal)

describe('dedupeProposalIds', () => {
  test('no-op when ids are already unique (single-shot path unchanged)', () => {
    const input = [p('NP-1', 'n1'), p('NP-2', 'n2')]
    expect(dedupeProposalIds(input)).toEqual(input)
  })

  test('suffixes colliding proposal_id and node.id from separate folder workers', () => {
    const out = dedupeProposalIds([p('NP-1', 'n1'), p('NP-1', 'n1'), p('NP-1', 'n1')])
    expect(out.map((x) => x.proposal_id)).toEqual(['NP-1', 'NP-1-2', 'NP-1-3'])
    expect(out.map((x) => x.node.id)).toEqual(['n1', 'n1-2', 'n1-3'])
  })

  test('proposal_id and node.id are de-duplicated independently', () => {
    const out = dedupeProposalIds([p('A', 'n'), p('B', 'n')]) // unique proposals, colliding node id
    expect(out.map((x) => x.proposal_id)).toEqual(['A', 'B'])
    expect(out.map((x) => x.node.id)).toEqual(['n', 'n-2'])
  })

  test('preserves order and other fields', () => {
    const out = dedupeProposalIds([p('X', 'nx')])
    expect(out[0]).toMatchObject({ proposal_id: 'X', proposed_by: 'extractor', node: { id: 'nx', title: 'nx' } })
  })
})

describe('pruneUnverifiableEvidence', () => {
  const withEv = (proposal_id: string, evs: Array<[string, string]>): KhNodeProposal => ({
    proposal_id, proposed_by: 'extractor', created_at: 't',
    node: { id: `n_${proposal_id}`, type: 'ConceptNode', title: proposal_id },
    evidence: evs.map(([evidence_id, source_path]) => ({ evidence_id, source_id: 's', source_path, evidence_type: 'd' })),
    claims: [{ claim_id: 'c1', text: 'x', evidence_ids: evs.map(([id]) => id) }],
  } as unknown as KhNodeProposal)

  test('drops only the unverifiable evidence; keeps the proposal when valid evidence remains', () => {
    const r = pruneUnverifiableEvidence(
      [withEv('A', [['e1', 'raw/ok.md'], ['e2', 'raw/ghost.md']])],
      [{ proposal_id: 'A', evidence_id: 'e2' }],
    )
    expect(r.droppedEvidence).toBe(1)
    expect(r.droppedProposals).toBe(0)
    expect(r.proposals[0].evidence.map((e) => e.evidence_id)).toEqual(['e1'])
    expect(r.proposals[0].claims[0].evidence_ids).toEqual(['e1']) // dropped id trimmed from the claim
  })

  test('drops a proposal whose every evidence is unverifiable', () => {
    const r = pruneUnverifiableEvidence(
      [withEv('A', [['e1', 'raw/ghost.md']]), withEv('B', [['e1', 'raw/ok.md']])],
      [{ proposal_id: 'A', evidence_id: 'e1' }],
    )
    expect(r.droppedProposals).toBe(1)
    expect(r.proposals.map((p) => p.proposal_id)).toEqual(['B'])
  })

  test('no findings → unchanged', () => {
    const input = [withEv('A', [['e1', 'raw/ok.md']])]
    expect(pruneUnverifiableEvidence(input, []).proposals).toEqual(input)
  })
})

describe('demoteUnderEvidencedShared', () => {
  test('downgrades shared / shared_candidate with < 2 evidence to project', () => {
    const out = demoteUnderEvidencedShared([scoped('shared', 1), scoped('shared_candidate', 0)])
    expect(out.map((x) => x.node.scope)).toEqual(['project', 'project'])
  })

  test('keeps shared with >= 2 evidence, and never touches project', () => {
    const out = demoteUnderEvidencedShared([scoped('shared', 2), scoped('shared_candidate', 3), scoped('project', 0)])
    expect(out.map((x) => x.node.scope)).toEqual(['shared', 'shared_candidate', 'project'])
  })

  test('preserves all other proposal fields when demoting', () => {
    const [out] = demoteUnderEvidencedShared([scoped('shared', 1)])
    expect(out).toMatchObject({ node: { id: 'n', title: 'n', scope: 'project' }, evidence: [{ evidence_id: 'e0' }] })
  })
})
