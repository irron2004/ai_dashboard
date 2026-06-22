import { describe, expect, test } from 'vitest'
import { buildWikiGraphData } from './build-graph.js'

describe('buildWikiGraphData (existing wiki: <type>/<slug> refs + edges.jsonl)', () => {
  const nodes = [
    { ref: 'papers/transformer', type: 'papers', title: 'Attention Is All You Need', relPath: 'wiki/papers/transformer.md' },
    { ref: 'methods/self-attention', type: 'methods', title: 'Self-Attention', relPath: 'wiki/methods/self-attention.md' },
  ]

  test('each wiki node becomes a graph node keyed by its <type>/<slug> ref, carrying title + doc path', () => {
    const { nodes: out } = buildWikiGraphData(nodes, [])
    const p = out.find((n) => n.id === 'papers/transformer')
    expect(p?.label).toBe('Attention Is All You Need')
    expect(p?.type).toBe('papers')
    expect((p?.data as { path?: string } | undefined)?.path).toBe('wiki/papers/transformer.md')
  })

  test('a typed edge connects two nodes as a rel link with workflow/direction/confidence', () => {
    const edges = [{ from: 'papers/transformer', to: 'methods/self-attention', type: 'uses_module', confidence: 'high' }]
    const link = buildWikiGraphData(nodes, edges).links.find((l) => l.kind === 'rel')
    expect(link?.source).toBe('papers/transformer')
    expect(link?.target).toBe('methods/self-attention')
    expect(link?.label).toBe('uses_module')
    expect(link?.confidence).toBe('high')
    expect(link?.direction).toBe('directed')
  })

  test('an edge endpoint with no node md still renders (ghost)', () => {
    const edges = [{ from: 'papers/transformer', to: 'concepts/ghosty', type: 'mentions' }]
    const { nodes: out, links } = buildWikiGraphData(nodes, edges)
    expect(out.find((n) => n.id === 'concepts/ghosty')).toBeTruthy()
    expect(links.some((l) => l.source === 'papers/transformer' && l.target === 'concepts/ghosty')).toBe(true)
  })
})
