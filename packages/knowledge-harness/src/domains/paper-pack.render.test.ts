import { describe, expect, test } from 'vitest'
import matter from 'gray-matter'
import { paperPack } from './paper-pack.js'
import { projectDocsPack } from './project-docs-pack.js'

describe('paperPack.renderNode', () => {
  test('writes wiki/<type>/<slug>.md with the fields as YAML frontmatter', () => {
    const node = { type: 'papers' as const, slug: 'attnembed-2402-05370', fields: {
      title: 'Attention as Robust Representation for Time Series Forecasting',
      slug: 'attnembed-2402-05370', year: 2024,
    } }
    const out = paperPack.renderNode!(node)
    expect(out.relPath).toBe('wiki/papers/attnembed-2402-05370.md')
    const parsed = matter(out.content)
    expect(parsed.data.title).toBe('Attention as Robust Representation for Time Series Forecasting')
    expect(parsed.data.slug).toBe('attnembed-2402-05370')
    expect(parsed.data.year).toBe(2024)
  })

  test('serializes nested objects and arrays (modules fields round-trip through YAML)', () => {
    const node = { type: 'modules' as const, slug: 'attention-embedding', fields: {
      title: 'Shared Self-Attention Embedding', slug: 'attention-embedding', kind: 'encoder', stage: 'encode',
      source_papers: ['attnembed-2402-05370'],
      evidence: [{ source: 'attnembed-2402-05370', metric: 'MSE', result: '-3.6% rel', confidence: 'high' }],
      input_contract: { modality: 'windowed_time_series' },
    } }
    const out = paperPack.renderNode!(node)
    expect(out.relPath).toBe('wiki/modules/attention-embedding.md')
    const d = matter(out.content).data
    expect(d.source_papers).toEqual(['attnembed-2402-05370'])
    expect(d.evidence[0].confidence).toBe('high')
    expect(d.input_contract.modality).toBe('windowed_time_series')
  })

  test('includes the body after the frontmatter when provided', () => {
    const out = paperPack.renderNode!({ type: 'papers' as const, slug: 's', fields: { title: 'T', slug: 's' }, body: 'Notes.' })
    expect(matter(out.content).content.trim()).toBe('Notes.')
  })

  test('project-docs pack has no renderNode', () => {
    expect(projectDocsPack.renderNode).toBeUndefined()
  })
})
