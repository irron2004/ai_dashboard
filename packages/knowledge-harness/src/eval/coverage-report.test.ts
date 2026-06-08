import { describe, expect, test } from 'vitest'
import type { KhNodeProposal } from '@apc/shared'
import { buildCoverageReport } from './coverage-report.js'

const proposal = (id: string, title: string, sourcePaths: string[]): KhNodeProposal => ({
  proposal_id: `prop-${id}`, proposal_type: 'create_or_update_node', proposed_by: 'extractor',
  source_type: 'agent_session', created_at: '2026-06-08T00:00:00Z',
  node: { id, type: 'ConceptNode', scope: 'project', title, summary: '', project_ids: [], tags: [] },
  claims: [],
  evidence: sourcePaths.map((sp, i) => ({
    evidence_id: `${id}-e${i}`, source_id: sp, source_path: sp, evidence_type: 'quote',
    quote_or_summary: '', confidence: 'medium',
  })),
  claim_policy: { minimum_evidence_count: 1, requires_direct_source: true, allow_inference: true, inference_note_required: true },
  actions: [], risk: { level: 'low', reason: '' }, review: { requires_human_review: true, reviewer_question: '' },
})

describe('buildCoverageReport', () => {
  test('marks a source covered when a node cites it, unmapped otherwise', () => {
    const sources = ['raw/project-docs/0/PRD.md', 'raw/project-docs/0/notes.md', 'raw/project-docs/0/adr.md']
    const proposals = [
      proposal('n1', 'Architecture', ['raw/project-docs/0/PRD.md']),
      proposal('n2', 'Decisions', ['raw/project-docs/0/adr.md']),
    ]
    const rep = buildCoverageReport(sources, proposals)
    expect(rep.totals).toEqual({ sourcesTotal: 3, covered: 2, unmapped: 1 })
    expect(rep.sources.find((s) => s.path.endsWith('notes.md'))!.status).toBe('unmapped')
    expect(rep.sources.find((s) => s.path.endsWith('PRD.md'))!.citedBy).toEqual(['n1'])
  })

  test('a source cited by multiple nodes lists all of them', () => {
    const rep = buildCoverageReport(['raw/s.md'], [proposal('n1', 'A', ['raw/s.md']), proposal('n2', 'B', ['raw/s.md'])])
    expect(rep.sources[0].citedBy.sort()).toEqual(['n1', 'n2'])
    expect(rep.totals.covered).toBe(1)
  })
})
