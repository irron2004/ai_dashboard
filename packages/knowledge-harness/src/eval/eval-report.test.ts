import { describe, expect, test } from 'vitest'
import { KhNodeProposalSchema, KhPolicyReportSchema, KhGraphValidationReportSchema } from '@apc/shared'
import { buildEvalReport } from './eval-report.js'

function proposal(over: Record<string, unknown> = {}) {
  return KhNodeProposalSchema.parse({
    proposal_id: 'NP', proposed_by: 'x', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n', type: 'ConceptNode', title: 'T' },
    evidence: [{ evidence_id: 'E', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
    claims: [{ claim_id: 'C', text: 't', evidence_ids: ['E'] }],
    ...over,
  })
}

describe('buildEvalReport', () => {
  test('an empty run yields the all-zero report with raw_modified false', () => {
    const r = buildEvalReport({})
    expect(r.evidence_quality.node_proposals_total).toBe(0)
    expect(r.safety.raw_modified).toBe(false)
  })

  test('aggregates coverage, evidence, graph, safety, usefulness', () => {
    const policy = KhPolicyReportSchema.parse({
      ok: false,
      violations: [
        { proposal_id: 'NP', rule: 'secret', severity: 'warn' },
        { proposal_id: 'NP', rule: 'canonical_overwrite', severity: 'warn' },
        { proposal_id: 'NP2', rule: 'delete', severity: 'block' },
      ],
    })
    const graph = KhGraphValidationReportSchema.parse({
      ok: false, orphan_nodes: ['x.md'], broken_links: [{ from: 'a', to: 'b' }],
    })
    const r = buildEvalReport({
      sourcesTotal: 5, sourcesClassified: 3,
      proposals: [proposal(), proposal({ evidence: [], claims: [] })],
      policy, graph,
      applied: { applied: ['concepts/n.md'], proposals: ['current.proposal.md'], skipped: [] },
    })
    expect(r.coverage.unmapped_sources).toBe(2)
    expect(r.evidence_quality.node_proposals_total).toBe(2)
    expect(r.evidence_quality.proposals_without_evidence).toBe(1)
    expect(r.graph_quality.orphan_nodes).toBe(1)
    expect(r.graph_quality.broken_links).toBe(1)
    expect(r.safety.secret_warnings).toBe(1)
    expect(r.safety.canonical_direct_overwrite_attempts).toBe(1)
    expect(r.safety.delete_attempts).toBe(1)
    expect(r.usefulness.current_update_proposals).toBe(1)
  })
})
