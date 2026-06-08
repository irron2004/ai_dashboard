import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { KhNodeProposal } from '@apc/shared'
import { ProposalsPanel } from './ProposalsPanel.js'

const proposal = (id: string, title: string, sourcePaths: string[]): KhNodeProposal => ({
  proposal_id: `prop-${id}`, proposal_type: 'create_or_update_node', proposed_by: 'extractor',
  source_type: 'agent_session', created_at: '2026-06-08T00:00:00Z',
  node: { id, type: 'ConceptNode', scope: 'project', title, summary: '', project_ids: [], tags: [] },
  claims: [],
  evidence: sourcePaths.map((sp, i) => ({
    evidence_id: `${id}-e${i}`, source_id: sp, source_path: sp, evidence_type: 'quote', quote_or_summary: '', confidence: 'medium',
  })),
  claim_policy: { minimum_evidence_count: 1, requires_direct_source: true, allow_inference: true, inference_note_required: true },
  actions: [], risk: { level: 'low', reason: '' }, review: { requires_human_review: true, reviewer_question: '' },
})

describe('ProposalsPanel', () => {
  const proposals = [
    proposal('n1', 'Architecture', ['raw/project-docs/0/PRD.md']),
    proposal('n2', 'Orphan idea', []),
  ]

  test('shows the proposal count and titles', () => {
    render(<ProposalsPanel proposals={proposals} />)
    expect(screen.getByTestId('proposals-summary').textContent).toContain('2')
    expect(screen.getByText('Architecture')).toBeDefined()
    expect(screen.getByText('Orphan idea')).toBeDefined()
  })

  test('flags a proposal with no evidence and shows cited sources for one with evidence', () => {
    render(<ProposalsPanel proposals={proposals} />)
    expect(screen.getByTestId('proposal-n2').className).toContain('proposals__item--warn')
    expect(screen.getByTestId('proposal-n1').className).not.toContain('proposals__item--warn')
    expect(within(screen.getByTestId('proposal-n1')).getByText(/PRD\.md/)).toBeDefined()
  })

  test('renders an empty state when there are no proposals', () => {
    render(<ProposalsPanel proposals={[]} />)
    expect(screen.getByText('제안 없음')).toBeDefined()
  })
})
