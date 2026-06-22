import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { GraphData } from './graph-types.js'

const cyInstance = { on: vi.fn(), destroy: vi.fn(), fit: vi.fn(), elements: () => [], nodes: () => ({ addClass: vi.fn(), removeClass: vi.fn() }), zoom: () => 1 }
const cyFactory = vi.fn((_opts: unknown) => cyInstance)
vi.mock('cytoscape', () => ({ default: (opts: unknown) => cyFactory(opts) }))

import { GraphVisualization } from './GraphVisualization.js'

const data: GraphData = {
  nodes: [
    { id: 'papers:t', label: 'T', type: 'papers', shape: 'square', color: '#000', data: { path: 'nodes/t.md' } },
    { id: 'modules:s', label: 'S', type: 'modules', shape: 'diamond', color: '#000' },
  ],
  links: [{ id: 'e1', source: 'modules:s', target: 'papers:t', kind: 'rel', label: 'uses_module', direction: 'directed' }],
}

describe('GraphVisualization (cytoscape)', () => {
  test('initializes cytoscape with one element per node and link', () => {
    render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    expect(cyFactory).toHaveBeenCalledTimes(1)
    const opts = (cyFactory.mock.calls as unknown as [{ elements: unknown[] }][])[0][0]
    expect(opts.elements).toHaveLength(3) // 2 nodes + 1 edge
  })
})
