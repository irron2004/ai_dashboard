import { describe, expect, it, test } from 'vitest'
import { buildWikiGraphData, buildWorkGraphData } from './build-graph.js'

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

describe('buildWorkGraphData', () => {
  const wiki = [
    { ref: 'concepts/a', type: 'document', title: 'A', relPath: 'vault/a.md' },
    { ref: 'concepts/b', type: 'document', title: 'B', relPath: 'vault/b.md' },
  ]
  it('makes task nodes + suffix-matched wiki nodes + work edges; non-matches isolated', () => {
    const tasks = [
      { id: 'req:p1:s1', title: 'edit A', status: 'done', linkedWikiPages: ['/abs/proj/vault/a.md', '/abs/proj/src/x.py'], data: { sessionId: 's1' } },
      { id: 'req:p1:s2', title: 'code only', status: 'in_progress', linkedWikiPages: ['/abs/proj/src/y.py'] },
    ]
    const g = buildWorkGraphData(tasks, wiki)
    const ids = g.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['concepts/a', 'req:p1:s1', 'req:p1:s2']) // b not touched; s2 isolated
    expect(g.nodes.find((n) => n.id === 'req:p1:s1')!.type).toBe('task')
    expect(g.nodes.find((n) => n.id === 'req:p1:s1')!.data).toEqual({ sessionId: 's1' })
    expect(g.links).toEqual([{ id: 'work:req:p1:s1->concepts/a', source: 'req:p1:s1', target: 'concepts/a', kind: 'work', label: 'touched' }])
  })
  it('adds a blocks edge (blocker -> blocked) between two task nodes from blockedBy', () => {
    const tasks = [
      { id: 'req:p1:a', title: 'A', status: 'done', linkedWikiPages: [] },
      { id: 'req:p1:b', title: 'B', status: 'todo', linkedWikiPages: [], blockedBy: ['req:p1:a'] },
    ]
    const g = buildWorkGraphData(tasks, [])
    const link = g.links.find((l) => l.kind === 'blocks')
    expect(link).toMatchObject({ source: 'req:p1:a', target: 'req:p1:b', kind: 'blocks', label: 'blocks', direction: 'directed' })
  })
  it('does not add a blocks edge when the blocker is not a node in the graph', () => {
    const tasks = [{ id: 'req:p1:b', title: 'B', status: 'todo', linkedWikiPages: [], blockedBy: ['ghost'] }]
    const g = buildWorkGraphData(tasks, [])
    expect(g.links.some((l) => l.kind === 'blocks')).toBe(false)
  })
  it('dedups a wiki node touched by two tasks (1 node, 2 edges); basename-only does not match', () => {
    const tasks = [
      { id: 'req:p1:s1', title: 't1', status: 'done', linkedWikiPages: ['/x/vault/a.md'] },
      { id: 'req:p1:s2', title: 't2', status: 'done', linkedWikiPages: ['/y/vault/a.md'] },
      { id: 'req:p1:s3', title: 't3', status: 'done', linkedWikiPages: ['/z/other/a.md'] }, // basename a.md but path !endsWith vault/a.md
    ]
    const g = buildWorkGraphData(tasks, [wiki[0]])
    expect(g.nodes.filter((n) => n.id === 'concepts/a')).toHaveLength(1)
    expect(g.links.map((l) => l.source).sort()).toEqual(['req:p1:s1', 'req:p1:s2'])
  })
})
