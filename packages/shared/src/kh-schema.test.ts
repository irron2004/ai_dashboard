import { describe, expect, test } from 'vitest'
import {
  KhStateSchema, KhNodeProposalSchema, KhWritePlanSchema, KhEvalReportSchema, RunStateSchema,
  KhProjectDiscoveryReportSchema, KhSourceInventoryReportSchema, KhConversationHistoryReportSchema,
  KhDocumentIntentReportSchema, KhGraphUpdatePlanSchema, KhSharedPromotionPlanSchema, KhStaleDocReportSchema,
  KhPolicyReportSchema, KhSecretScanReportSchema, KhGraphValidationReportSchema,
  KhLinkValidationReportSchema, KhMarkdownYamlValidationReportSchema,
  KhProjectPolicyProposalSchema,
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

  test('ProjectDiscoveryReport defaults lists to empty', () => {
    const r = KhProjectDiscoveryReportSchema.parse({ project_id: 'p1', generated_by: 'discovery' })
    expect(r.repos).toEqual([])
    expect(r.canonical_docs).toEqual([])
  })

  test('ProjectPolicyProposal defaults lists/strings empty', () => {
    const p = KhProjectPolicyProposalSchema.parse({ project_id: 'p1', generated_by: 'wiki-policy-advisor' })
    expect(p.project_character).toBe('')
    expect(p.node_type_priorities).toEqual([])
    expect(p.canonical_definition).toBe('')
    expect(p.scan_scope_notes).toBe('')
    expect(p.tailoring_markdown).toBe('')
    expect(p.rationale).toBe('')
    expect(p.evidence).toEqual([])
  })

  test('ProjectPolicyProposal keeps populated priorities + evidence', () => {
    const p = KhProjectPolicyProposalSchema.parse({
      project_id: 'p1', generated_by: 'wiki-policy-advisor',
      node_type_priorities: [{ node_type: 'ExperimentNode', rationale: 'research repo' }],
      evidence: [{ signal: 'topics', detail: 'backtesting, grid search' }],
    })
    expect(p.node_type_priorities[0].node_type).toBe('ExperimentNode')
    expect(p.node_type_priorities[0].rationale).toBe('research repo')
    expect(p.evidence[0].signal).toBe('topics')
  })

  test('DocumentIntentReport carries classified docs with intent', () => {
    const r = KhDocumentIntentReportSchema.parse({
      generated_by: 'classifier',
      documents: [{ path: 'current.md', intent: 'canonical', confidence: 'high' }],
    })
    expect(r.documents[0].intent).toBe('canonical')
  })

  test('GraphUpdatePlan / SharedPromotionPlan / StaleDocReport parse with defaults', () => {
    expect(KhGraphUpdatePlanSchema.parse({ created_by: 'lead' }).node_ops).toEqual([])
    expect(KhSharedPromotionPlanSchema.parse({ created_by: 'lead' }).candidates).toEqual([])
    expect(KhStaleDocReportSchema.parse({ generated_by: 'lead' }).stale).toEqual([])
  })

  test('ConversationHistoryReport + SourceInventoryReport parse', () => {
    expect(KhSourceInventoryReportSchema.parse({ generated_by: 'reader' }).sources).toEqual([])
    expect(KhConversationHistoryReportSchema.parse({ generated_by: 'reader', session_id: 's1' }).highlights).toEqual([])
  })

  test('verify/policy reports default to ok:true with empty finding lists', () => {
    expect(KhPolicyReportSchema.parse({}).ok).toBe(true)
    expect(KhPolicyReportSchema.parse({}).violations).toEqual([])
    expect(KhSecretScanReportSchema.parse({}).findings).toEqual([])
    const g = KhGraphValidationReportSchema.parse({})
    expect(g.broken_links).toEqual([])
    expect(g.duplicate_node_ids).toEqual([])
    expect(KhLinkValidationReportSchema.parse({}).broken).toEqual([])
    expect(KhMarkdownYamlValidationReportSchema.parse({}).problems).toEqual([])
  })

  // ---- Step 3: structural hardening (reject empty/typo/hallucinated shapes) ----

  const validProposal = {
    proposal_id: 'NP-1', proposed_by: 'reader', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a.jsonl', evidence_type: 'decision' }],
  }

  test('rejects an empty proposal_id / node.id / node.title (#11/#20)', () => {
    expect(() => KhNodeProposalSchema.parse({ ...validProposal, proposal_id: '' })).toThrow()
    expect(() => KhNodeProposalSchema.parse({ ...validProposal, node: { id: '', type: 'C', title: 'T' } })).toThrow()
    expect(() => KhNodeProposalSchema.parse({ ...validProposal, node: { id: 'n', type: 'C', title: '' } })).toThrow()
  })

  test('rejects empty evidence identity fields (#11/#36)', () => {
    expect(() => KhNodeProposalSchema.parse({ ...validProposal,
      evidence: [{ evidence_id: '', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }] })).toThrow()
    expect(() => KhNodeProposalSchema.parse({ ...validProposal,
      evidence: [{ evidence_id: 'E', source_id: 's', source_path: '', evidence_type: 'd' }] })).toThrow()
  })

  test('node.scope is an enum: rejects an unknown scope (#28)', () => {
    expect(KhNodeProposalSchema.parse({ ...validProposal, node: { id: 'n', type: 'C', title: 'T', scope: 'shared' } }).node.scope).toBe('shared')
    expect(() => KhNodeProposalSchema.parse({ ...validProposal, node: { id: 'n', type: 'C', title: 'T', scope: 'global' } })).toThrow()
  })

  test('WriteOp.op is an enum: accepts known verbs (incl. delete_file), rejects typos (#31)', () => {
    const ok = (op: string) => KhWritePlanSchema.parse({ write_plan_id: 'WP', created_by: 'lead', operations: [{ op, path: 'x.md' }] })
    expect(ok('create_file').operations[0].op).toBe('create_file')
    expect(ok('delete_file').operations[0].op).toBe('delete_file')  // recognized-but-forbidden → PolicyGuard blocks
    expect(() => ok('crate_file')).toThrow()
    expect(() => ok('rm')).toThrow()
  })

  test('WriteOp.path must be non-empty (#11)', () => {
    expect(() => KhWritePlanSchema.parse({ write_plan_id: 'WP', created_by: 'lead', operations: [{ op: 'create_file', path: '' }] })).toThrow()
  })

  test('RunState.engine is AgentKind: rejects an unknown engine (#19)', () => {
    expect(() => RunStateSchema.parse({ runId: 'R', projectId: 'p', engine: 'gpt', state: 'CREATED' })).toThrow()
    expect(RunStateSchema.parse({ runId: 'R', projectId: 'p', engine: 'codex', state: 'CREATED' }).engine).toBe('codex')
  })

  // ---- #29: claim→evidence referential integrity (parse-level defense-in-depth, "NEVER invent evidence") ----
  // PolicyGuard remains the proposal-level evidence gate at RUNTIME, and the eval report MEASURES
  // evidence quality — so an EMPTY proposal (no claims, no evidence) must stay parseable. This layer only
  // rejects a claim whose cited evidence was never declared, or a claim that cites no evidence at all.

  test('rejects a claim citing an unknown evidence_id (#29)', () => {
    expect(() => KhNodeProposalSchema.parse({ ...validProposal,
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-404'] }],
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }] })).toThrow()
  })

  test('rejects a claim that cites no evidence at all (#29)', () => {
    expect(() => KhNodeProposalSchema.parse({ ...validProposal,
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: [] }] })).toThrow()
  })

  test('an empty proposal (no claims, no evidence) still PARSES — PolicyGuard is the runtime evidence gate (#29)', () => {
    expect(() => KhNodeProposalSchema.parse({ ...validProposal, claims: [], evidence: [] })).not.toThrow()
  })

  test('a claim citing a declared evidence_id parses (#29)', () => {
    expect(KhNodeProposalSchema.parse(validProposal).claims[0].evidence_ids).toEqual(['EV-1'])
  })
})
