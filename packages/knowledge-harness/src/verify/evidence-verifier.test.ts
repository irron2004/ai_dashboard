import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KhNodeProposalSchema } from '@apc/shared'
import { EvidenceVerifier } from './evidence-verifier.js'

const ev = new EvidenceVerifier()

function proposal(evidence: Array<{ source_path: string; quote_or_summary?: string }>) {
  return KhNodeProposalSchema.parse({
    proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    evidence: evidence.map((e, i) => ({
      evidence_id: `EV-${i + 1}`, source_id: 's', source_path: e.source_path, evidence_type: 'd',
      quote_or_summary: e.quote_or_summary ?? '',
    })),
  })
}

describe('EvidenceVerifier', () => {
  let vault: string
  beforeEach(() => { vault = mkdtempSync(join(tmpdir(), 'kh-ev-')); mkdirSync(join(vault, 'raw'), { recursive: true }) })
  afterEach(() => { rmSync(vault, { recursive: true, force: true }) })

  test('passes evidence whose raw source exists (no quote)', () => {
    writeFileSync(join(vault, 'raw', 'a.jsonl'), 'some transcript content')
    const r = ev.verify([proposal([{ source_path: 'raw/a.jsonl' }])], vault)
    expect(r.ok).toBe(true)
    expect(r.unverifiable).toEqual([])
  })

  test('passes when a normalized quote substring is present in the source', () => {
    writeFileSync(join(vault, 'raw', 'a.jsonl'), 'we DECIDED to   use the staging vault here')
    const r = ev.verify([proposal([{ source_path: 'raw/a.jsonl', quote_or_summary: 'decided to use the staging vault' }])], vault)
    expect(r.ok).toBe(true)
  })

  test('flags a missing source file', () => {
    const r = ev.verify([proposal([{ source_path: 'raw/ghost.jsonl' }])], vault)
    expect(r.ok).toBe(false)
    expect(r.unverifiable[0].reason).toBe('source_not_found')
  })

  test('flags a quote that is not present in the source', () => {
    writeFileSync(join(vault, 'raw', 'a.jsonl'), 'totally unrelated text')
    const r = ev.verify([proposal([{ source_path: 'raw/a.jsonl', quote_or_summary: 'a quote that is absent' }])], vault)
    expect(r.ok).toBe(false)
    expect(r.unverifiable[0].reason).toBe('quote_not_found')
  })

  test('flags a non-raw source path (evidence must cite immutable raw/)', () => {
    writeFileSync(join(vault, 'concepts.md'), 'x')
    const r = ev.verify([proposal([{ source_path: 'concepts.md' }])], vault)
    expect(r.ok).toBe(false)
    expect(r.unverifiable[0].reason).toBe('source_not_found')
  })

  test('flags a path that escapes the vault', () => {
    const r = ev.verify([proposal([{ source_path: '../../etc/passwd' }])], vault)
    expect(r.ok).toBe(false)
    expect(r.unverifiable[0].reason).toBe('path_escape')
  })
})
