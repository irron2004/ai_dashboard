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

  // #24: a write op that would author a non-.md file is a hard block — the harness only ever authors
  // markdown wiki docs, so a plan targeting .env/.js/etc. is LLM misbehavior, not a benign write.
  test('a create_file/append_section op targeting a non-.md path is blocked (#24)', () => {
    const wp = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [
        { op: 'create_file', path: 'config/app.env', content: 'x' },
        { op: 'append_section', path: 'notes/log.txt', content: 'y' },
      ],
    })
    const r = guard.check([proposal()], wp)
    const hits = r.violations.filter(v => v.rule === 'non_markdown_write')
    expect(hits).toHaveLength(2)
    expect(hits.every(v => v.severity === 'block')).toBe(true)
    expect(r.ok).toBe(false)
  })

  // #21: a secret in a write-op BODY is a block (unlike a secret merely quoted in evidence, which warns) —
  // it would otherwise be authored into the staging vault.
  test('a write op whose body contains a secret is blocked (#21)', () => {
    const wp = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [{ op: 'create_file', path: 'concepts/n1.md', content: 'AWS_KEY=AKIAIOSFODNN7EXAMPLE\n' }],
    })
    const r = guard.check([proposal()], wp)
    expect(r.violations.find(v => v.rule === 'secret_in_write')?.severity).toBe('block')
    expect(r.ok).toBe(false)
  })

  test('a clean .md write op with no secret adds no write-content violations', () => {
    const wp = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# clean\n' }],
    })
    const r = guard.check([proposal()], wp)
    expect(r.violations.find(v => v.rule === 'non_markdown_write' || v.rule === 'secret_in_write')).toBeUndefined()
    expect(r.ok).toBe(true)
  })
})
