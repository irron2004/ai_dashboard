import { describe, expect, test } from 'vitest'
import { KhNodeProposalSchema, type KhNodeProposal } from '@apc/shared'
import { normalizeEvidencePaths } from './evidence-normalize.js'
import type { SourceDoc } from './source-reader.js'

const src = (source_path: string): SourceDoc => ({ source_id: source_path, source_path, text: '', hash: 'h' })

function proposal(evPaths: string[]): KhNodeProposal {
  return KhNodeProposalSchema.parse({
    proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-15T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    evidence: evPaths.map((p, i) => ({ evidence_id: `EV-${i}`, source_id: `s${i}`, source_path: p, evidence_type: 'intent' })),
  })
}

const paths = (props: KhNodeProposal[]) => props.flatMap((p) => p.evidence.map((e) => e.source_path))

describe('normalizeEvidencePaths', () => {
  const sources = [
    src('raw/project-docs/0/docs/papers/CLAUDE.md'),
    src('raw/project-docs/0/docs/papers/_shared/leak_loader/CLAUDE.md'),
    src('raw/project-docs/0/AGENTS.md'),
    src('raw/conversations/claude/sess/001q_a.txt'),
  ]

  test('rewrites a remote absolute path to its materialized raw/ copy', () => {
    const out = normalizeEvidencePaths([proposal(['/home/hskim/work/llm-agent-v2/docs/papers/CLAUDE.md'])], sources)
    expect(paths(out)).toEqual(['raw/project-docs/0/docs/papers/CLAUDE.md'])
  })

  test('disambiguates same-named files by longest matching tail', () => {
    const out = normalizeEvidencePaths(
      [proposal(['/home/hskim/work/llm-agent-v2/docs/papers/_shared/leak_loader/CLAUDE.md'])],
      sources,
    )
    expect(paths(out)).toEqual(['raw/project-docs/0/docs/papers/_shared/leak_loader/CLAUDE.md'])
  })

  test('leaves already-raw conversation paths untouched', () => {
    const out = normalizeEvidencePaths([proposal(['raw/conversations/claude/sess/001q_a.txt'])], sources)
    expect(paths(out)).toEqual(['raw/conversations/claude/sess/001q_a.txt'])
  })

  test('leaves an unmatched path unchanged (so it fails verification honestly)', () => {
    const out = normalizeEvidencePaths([proposal(['/home/hskim/work/llm-agent-v2/does/not/exist.md'])], sources)
    expect(paths(out)).toEqual(['/home/hskim/work/llm-agent-v2/does/not/exist.md'])
  })

  test('matches a repo-relative path too', () => {
    const out = normalizeEvidencePaths([proposal(['AGENTS.md'])], sources)
    expect(paths(out)).toEqual(['raw/project-docs/0/AGENTS.md'])
  })
})
