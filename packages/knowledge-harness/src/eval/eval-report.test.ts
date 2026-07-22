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

  test('raw_modified is true only when an applied write actually resolved under raw/ (#27)', () => {
    // a raw op that the writer skipped (never applied) does NOT count as a modification
    const clean = buildEvalReport({ applied: { applied: ['concepts/n.md'], proposals: [], skipped: ['raw/x.md'] } })
    expect(clean.safety.raw_modified).toBe(false)
    // a raw path that actually landed in the applied set IS a breach
    const breached = buildEvalReport({ applied: { applied: ['raw/leak.md'], proposals: [], skipped: [] } })
    expect(breached.safety.raw_modified).toBe(true)
  })

  test('proposals_with_minimum_evidence honors the shared_candidate floor (≥2) and per-proposal minimum', () => {
    const sharedOk = proposal({ node: { id: 's2', type: 'ConceptNode', title: 'T', scope: 'shared_candidate' }, claims: [{ claim_id: 'C', text: 't', evidence_ids: ['A', 'B'] }], evidence: [{ evidence_id: 'A', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }, { evidence_id: 'B', source_id: 's', source_path: 'raw/b', evidence_type: 'd' }] })
    const sharedShort = proposal({ node: { id: 's1', type: 'ConceptNode', title: 'T', scope: 'shared_candidate' } })  // 1 evidence → below floor 2
    const strict = proposal({ claim_policy: { minimum_evidence_count: 3 } })  // 1 evidence < 3
    const r = buildEvalReport({ proposals: [sharedOk, sharedShort, strict] })
    // only sharedOk meets its threshold; the hardcoded >=1 would wrongly count all 3
    expect(r.evidence_quality.proposals_with_minimum_evidence).toBe(1)
  })

  test('secret_warnings sums PolicyGuard evidence hits and VALIDATED body-scan findings', () => {
    const policy = KhPolicyReportSchema.parse({ violations: [{ proposal_id: 'NP', rule: 'secret', severity: 'warn' }] })
    const r = buildEvalReport({ policy, secretScanFindings: 2 })
    expect(r.safety.secret_warnings).toBe(3)  // 1 evidence-text + 2 body-content
  })

  test('counts shared promotion candidates from the lead plan', () => {
    const r = buildEvalReport({
      sharedPromotion: { candidates: [{ node_id: 'n1' }, { node_id: 'n2' }] },
    })
    expect(r.usefulness.shared_promotion_candidates).toBe(2)
  })
})
