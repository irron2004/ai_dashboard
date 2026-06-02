import { describe, expect, test } from 'vitest'
import {
  KhStateSchema, KhNodeProposalSchema, KhWritePlanSchema, KhEvalReportSchema, RunStateSchema,
} from './kh-schema.js'

describe('kh-schema', () => {
  test('KhState accepts the 12 pipeline states and rejects others', () => {
    expect(KhStateSchema.parse('CREATED')).toBe('CREATED')
    expect(KhStateSchema.parse('HUMAN_REVIEW_REQUIRED')).toBe('HUMAN_REVIEW_REQUIRED')
    expect(() => KhStateSchema.parse('NOPE')).toThrow()
  })

  test('NodeProposal applies evidence/claim defaults', () => {
    const p = KhNodeProposalSchema.parse({
      proposal_id: 'NP-1', proposal_type: 'create_or_update_node', proposed_by: 'reader',
      created_at: '2026-06-02T00:00:00+09:00',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a.jsonl', evidence_type: 'decision' }],
    })
    expect(p.node.scope).toBe('project')
    expect(p.claim_policy.minimum_evidence_count).toBe(1)
    expect(p.review.requires_human_review).toBe(true)
  })

  test('WritePlan defaults forbidden-op flags to false and mode to apply', () => {
    const wp = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [{ op: 'create_file', path: '_shared/concepts/x.md' }],
    })
    expect(wp.target_vault).toBe('vault-staging')
    expect(wp.operations[0].mode).toBe('apply')
    expect(wp.forbidden_operations_checked.raw_modified).toBe(false)
  })

  test('EvalReport fills all metric groups with zeros', () => {
    const e = KhEvalReportSchema.parse({})
    expect(e.coverage.raw_sources_total).toBe(0)
    expect(e.safety.raw_modified).toBe(false)
  })

  test('RunState round-trips through parse', () => {
    const rs = RunStateSchema.parse({
      runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED',
      history: [{ state: 'CREATED', at: '2026-06-02T00:00:00Z' }],
    })
    expect(rs.artifacts).toEqual({})
    expect(rs.history[0].state).toBe('CREATED')
  })
})
