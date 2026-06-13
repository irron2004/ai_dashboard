import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { KhProjectPolicyProposalSchema } from '@apc/shared'
import {
  renderTailoring, readPolicy, writeProposedPolicy, approvePolicy, revertPolicy,
  resolveProjectPreamble, policyMarkdownPath,
} from './wiki-policy.js'

const BASE = '# Knowledge Harness Rules\n\n## 4. Shared Promotion\n- shared 승격은 evidence 2개 이상.'
const NOW = () => '2026-06-13T00:00:00Z'

function proposal(over: Record<string, unknown> = {}) {
  return KhProjectPolicyProposalSchema.parse({
    project_id: 'p1', generated_by: 'wiki-policy-advisor',
    project_character: 'quant research repo',
    node_type_priorities: [{ node_type: 'ExperimentNode', rationale: 'many backtests' }],
    canonical_definition: 'current.md + ADR-*',
    scan_scope_notes: 'emphasize strategies/',
    tailoring_markdown: 'Prefer experiment-centric nodes.',
    ...over,
  })
}

let vault: string
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), 'wp-')) })
afterEach(() => { rmSync(vault, { recursive: true, force: true }) })

describe('renderTailoring', () => {
  test('emits a markdown section with priorities + prose; never includes governance', () => {
    const md = renderTailoring(proposal())
    expect(md).toContain('## Project Tailoring')
    expect(md).toContain('ExperimentNode')
    expect(md).toContain('many backtests')
    expect(md).toContain('Prefer experiment-centric nodes.')
    expect(md).not.toContain('Knowledge Harness Rules')   // governance is never authored here
  })

  test('is deterministic for the same proposal', () => {
    expect(renderTailoring(proposal())).toBe(renderTailoring(proposal()))
  })
})

describe('store round-trip', () => {
  test('writeProposedPolicy then readPolicy yields status=proposed + body', () => {
    writeProposedPolicy(vault, 'p1', proposal(), NOW)
    const rec = readPolicy(vault, 'p1')
    expect(rec?.status).toBe('proposed')
    expect(rec?.generatedAt).toBe('2026-06-13T00:00:00Z')
    expect(rec?.body).toContain('ExperimentNode')
    expect(rec?.proposal.project_character).toBe('quant research repo')
  })

  test('approvePolicy flips status and stamps approvedAt', () => {
    writeProposedPolicy(vault, 'p1', proposal(), NOW)
    approvePolicy(vault, 'p1', NOW)
    const rec = readPolicy(vault, 'p1')
    expect(rec?.status).toBe('approved')
    expect(rec?.approvedAt).toBe('2026-06-13T00:00:00Z')
  })

  test('approvePolicy throws when nothing was proposed', () => {
    expect(() => approvePolicy(vault, 'p1', NOW)).toThrow(/no proposed policy/i)
  })

  test('revertPolicy removes the policy', () => {
    writeProposedPolicy(vault, 'p1', proposal(), NOW)
    revertPolicy(vault, 'p1')
    expect(readPolicy(vault, 'p1')).toBeNull()
  })
})

describe('resolveProjectPreamble', () => {
  test('no policy file → returns base unchanged', () => {
    expect(resolveProjectPreamble(vault, 'p1', BASE)).toBe(BASE)
  })

  test('proposed (not approved) → returns base unchanged', () => {
    writeProposedPolicy(vault, 'p1', proposal(), NOW)
    expect(resolveProjectPreamble(vault, 'p1', BASE)).toBe(BASE)
  })

  test('approved → base + tailoring body, governance preserved verbatim', () => {
    writeProposedPolicy(vault, 'p1', proposal(), NOW)
    approvePolicy(vault, 'p1', NOW)
    const eff = resolveProjectPreamble(vault, 'p1', BASE)
    expect(eff.startsWith(BASE)).toBe(true)               // governance untouched, at the top
    expect(eff).toContain('## Project Tailoring')
    expect(eff).toContain('ExperimentNode')
  })

  test('corrupt json → falls back to base (never throws)', () => {
    writeProposedPolicy(vault, 'p1', proposal(), NOW)
    approvePolicy(vault, 'p1', NOW)
    writeFileSync(join(vault, 'projects', 'p1', 'wiki-policy.json'), '{ not json')
    expect(resolveProjectPreamble(vault, 'p1', BASE)).toBe(BASE)
  })

  test('hand-edited markdown body is what gets injected', () => {
    writeProposedPolicy(vault, 'p1', proposal(), NOW)
    approvePolicy(vault, 'p1', NOW)
    writeFileSync(policyMarkdownPath(vault, 'p1'), '## Project Tailoring\n\nHUMAN EDIT')
    expect(resolveProjectPreamble(vault, 'p1', BASE)).toContain('HUMAN EDIT')
  })
})
