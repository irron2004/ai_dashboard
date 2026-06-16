import { describe, expect, test } from 'vitest'
import { dedupeProposalIds } from './merge-proposals.js'
import type { KhNodeProposal } from '@apc/shared'

const p = (proposal_id: string, nodeId: string): KhNodeProposal => ({
  proposal_id, proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
  node: { id: nodeId, type: 'ConceptNode', title: nodeId },
  evidence: [], claims: [],
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
