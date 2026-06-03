import { describe, expect, test } from 'vitest'
import { KhNodeProposalSchema, KhWritePlanSchema } from '@apc/shared'
import { PolicyGuard } from './policy-guard.js'

const guard = new PolicyGuard()

function proposal(over: Record<string, unknown> = {}) {
  return KhNodeProposalSchema.parse({
    proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a.jsonl', evidence_type: 'decision' }],
    claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    ...over,
  })
}

describe('PolicyGuard', () => {
  test('clean proposals + clean write plan → ok, no violations', () => {
    const wp = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [{ op: 'create_file', path: 'concepts/n1.md' }],
    })
    const r = guard.check([proposal()], wp)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  test('a proposal with no evidence is blocked', () => {
    const r = guard.check([proposal({ evidence: [], claims: [] })])
    expect(r.ok).toBe(false)
    expect(r.blocked_proposal_ids).toContain('NP-1')
    expect(r.violations.find(v => v.rule === 'no_evidence')?.severity).toBe('block')
  })

  test('shared_candidate with <2 evidence is blocked', () => {
    const r = guard.check([proposal({ node: { id: 'n1', type: 'ConceptNode', title: 'T', scope: 'shared_candidate' } })])
    expect(r.violations.find(v => v.rule === 'shared_evidence_min')?.severity).toBe('block')
  })

  test('a self-declared shared scope with <2 evidence is ALSO blocked (#28)', () => {
    const r = guard.check([proposal({ node: { id: 'n1', type: 'ConceptNode', title: 'T', scope: 'shared' } })])
    expect(r.violations.find(v => v.rule === 'shared_evidence_min')?.severity).toBe('block')
  })

  test('raw write and delete ops are blocked; canonical overwrite warns', () => {
    const wp = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [
        { op: 'create_file', path: 'raw/x.md' },
        { op: 'delete_file', path: 'concepts/old.md' },
        { op: 'create_file', path: 'current.md', mode: 'apply' },
      ],
    })
    const r = guard.check([proposal()], wp)
    const rules = r.violations.map(v => `${v.rule}:${v.severity}`)
    expect(rules).toContain('raw_write:block')
    expect(rules).toContain('delete:block')
    expect(rules).toContain('canonical_overwrite:warn')
    expect(r.ok).toBe(false)  // has blocks
  })

  test('secret-like evidence text raises a warn (human review), not a block', () => {
    const r = guard.check([proposal({
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'note', quote_or_summary: 'token AKIAIOSFODNN7EXAMPLE leaked' }],
    })])
    const v = r.violations.find(x => x.rule === 'secret')
    expect(v?.severity).toBe('warn')
    expect(r.ok).toBe(true)  // warn alone does not block
  })
})
