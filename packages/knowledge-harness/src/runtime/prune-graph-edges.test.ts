import { describe, expect, test } from 'vitest'
import { pruneGraphEdges } from './make-drivers.js'
import type { KhGraphUpdatePlan } from '@apc/shared'

const plan = (edges: unknown[], nodeOps: string[] = []): KhGraphUpdatePlan => ({
  created_by: 'lead',
  node_ops: nodeOps.map((node_id) => ({ op: 'create', node_id, based_on_proposals: [], note: '' })),
  edge_ops: edges,
} as unknown as KhGraphUpdatePlan)

describe('pruneGraphEdges', () => {
  test('keeps edges whose endpoints are real nodes; drops dangling + self-loops', () => {
    const p = plan([
      { op: 'create', from_node_id: 'a', to_node_id: 'b', type: 'depends_on', note: '' }, // ok
      { op: 'create', from_node_id: 'a', to_node_id: 'ghost', type: 'relates_to', note: '' }, // dangling
      { op: 'create', from_node_id: 'b', to_node_id: 'b', type: 'relates_to', note: '' }, // self-loop
    ], ['a', 'b'])
    const { plan: out, dropped } = pruneGraphEdges(p, ['a', 'b'])
    expect(dropped).toBe(2)
    expect(out.edge_ops.map((e) => `${e.from_node_id}->${e.to_node_id}`)).toEqual(['a->b'])
  })

  test('proposal node ids (not only node_ops) count as valid endpoints', () => {
    const { plan: out, dropped } = pruneGraphEdges(
      plan([{ op: 'create', from_node_id: 'x', to_node_id: 'y', type: 'part_of', note: '' }]),
      ['x', 'y'], // e.g. supplied from the proposals
    )
    expect(dropped).toBe(0)
    expect(out.edge_ops).toHaveLength(1)
  })

  test('no edges → unchanged', () => {
    const p = plan([], ['a'])
    expect(pruneGraphEdges(p, ['a']).plan.edge_ops).toEqual([])
  })
})
