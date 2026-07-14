import { describe, expect, test } from 'vitest'
import { obsidianForceLayout, SCALABLE_LAYOUT_NODE_THRESHOLD } from './graph-layout.js'

const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }))

describe('obsidianForceLayout', () => {
  test('returns a position and a size for every node', () => {
    const r = obsidianForceLayout(nodes(6), [], 1000, 600)
    expect(Object.keys(r.positions)).toHaveLength(6)
    expect(Object.keys(r.sizes)).toHaveLength(6)
    expect(r.sizes.n0.radius).toBeGreaterThan(0)
  })

  test('is deterministic — same input yields identical positions', () => {
    const a = obsidianForceLayout(nodes(8), [{ source: 'n0', target: 'n1' }], 1000, 600)
    const b = obsidianForceLayout(nodes(8), [{ source: 'n0', target: 'n1' }], 1000, 600)
    expect(a.positions).toEqual(b.positions)
  })

  test('positions are finite numbers', () => {
    const r = obsidianForceLayout(nodes(10), [{ source: 'n0', target: 'n9' }], 800, 800)
    for (const p of Object.values(r.positions)) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  test('higher-degree nodes get a larger radius', () => {
    const edges = [
      { source: 'hub', target: 'a' }, { source: 'hub', target: 'b' },
      { source: 'hub', target: 'c' }, { source: 'hub', target: 'd' },
    ]
    const ns = [{ id: 'hub' }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const r = obsidianForceLayout(ns, edges, 1000, 600)
    expect(r.sizes.hub.radius).toBeGreaterThan(r.sizes.a.radius)
  })

  test('uses a deterministic scalable layout for large graphs', () => {
    const nodes = Array.from({ length: SCALABLE_LAYOUT_NODE_THRESHOLD + 20 }, (_, i) => ({ id: `n${i}` }))
    const edges = nodes.slice(1).map((node, i) => ({ source: 'n0', target: node.id, id: `e${i}` }))
    const first = obsidianForceLayout(nodes, edges, 1000, 600)
    const second = obsidianForceLayout(nodes, edges, 1000, 600)

    expect(Object.keys(first.positions)).toHaveLength(nodes.length)
    expect(first).toEqual(second)
    expect(first.positions.n0).toEqual({ x: 500, y: 300 })
  })
})
