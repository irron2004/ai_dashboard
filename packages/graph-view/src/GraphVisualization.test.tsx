import { describe, expect, test, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { GraphData } from './graph-types.js'

// ---------------------------------------------------------------------------
// Minimal cytoscape mock — keeps the test hermetic while exercising the real
// React state / rendering logic inside GraphVisualization.
// ---------------------------------------------------------------------------

const makeNodeCollection = (ids: string[]) => {
  const col = {
    ids,
    addClass: vi.fn().mockReturnThis(),
    removeClass: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
    forEach: vi.fn((fn: (el: { id: () => string; data: (k: string) => string; addClass: () => void; removeClass: () => void }) => void) => {
      ids.forEach((id) =>
        fn({ id: () => id, data: (k: string) => (k === 'label' ? id : k === 'entity' ? 'papers' : ''), addClass: vi.fn(), removeClass: vi.fn() })
      )
    }),
    filter: vi.fn((fn: (n: { id: () => string; data: (k: string) => string }) => boolean) => {
      const matched = ids.filter((id) =>
        fn({ id: () => id, data: (k: string) => (k === 'label' ? id : k === 'entity' ? 'papers' : '') })
      )
      return makeNodeCollection(matched)
    }),
    slice: vi.fn(() => makeNodeCollection(ids.slice(0, 20))),
    length: ids.length,
  }
  return col
}

const makeEdgeCollection = () => ({
  addClass: vi.fn().mockReturnThis(),
  removeClass: vi.fn().mockReturnThis(),
  toggleClass: vi.fn().mockReturnThis(),
  removeStyle: vi.fn().mockReturnThis(),
  forEach: vi.fn(),
  style: vi.fn(() => 'element'),
})

const cyInstance = {
  on: vi.fn(),
  destroy: vi.fn(),
  fit: vi.fn(),
  zoom: vi.fn(() => 1),
  elements: vi.fn(() => ({ addClass: vi.fn(), removeClass: vi.fn() })),
  nodes: vi.fn((_selector?: string) => makeNodeCollection(['papers:t', 'modules:s'])),
  edges: vi.fn((_selector?: string) => makeEdgeCollection()),
  getElementById: vi.fn((id: string) => ({
    length: 1,
    id: () => id,
    addClass: vi.fn(),
    removeClass: vi.fn(),
    data: vi.fn(() => ''),
    animate: vi.fn(),
  })),
  animate: vi.fn(),
}

const cyFactory = vi.fn((_opts: unknown) => cyInstance)
vi.mock('cytoscape', () => ({ default: (opts: unknown) => cyFactory(opts) }))

import { FOCUSED_EDGE_NODE_THRESHOLD, GraphVisualization } from './GraphVisualization.js'

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
    const calls = cyFactory.mock.calls as unknown as [{ elements: unknown[] }][]
    const opts = calls[calls.length - 1][0]
    expect(opts.elements).toHaveLength(3) // 2 nodes + 1 edge
  })

  test('large graphs initialize node-first without materializing every edge', () => {
    const nodes: GraphData['nodes'] = Array.from({ length: FOCUSED_EDGE_NODE_THRESHOLD }, (_, i) => ({
      id: `document:${i}`, label: `Document ${i}`, type: 'document', shape: 'circle', color: '#000',
    }))
    const links: GraphData['links'] = nodes.slice(1).map((node, i) => ({
      id: `edge:${i}`, source: nodes[0].id, target: node.id, kind: 'rel',
    }))
    render(<GraphVisualization data={{ nodes, links }} onNodeClick={() => {}} />)
    const calls = cyFactory.mock.calls as unknown as [{ elements: unknown[] }][]
    const opts = calls[calls.length - 1][0]

    expect(opts.elements).toHaveLength(nodes.length)
  })

  test('renders the sidebar with entity and edge filter sections', () => {
    const { getByText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    expect(getByText('Entity types')).toBeTruthy()
    expect(getByText('Edge types')).toBeTruthy()
    expect(getByText('Preset views')).toBeTruthy()
  })

  test('sidebar renders entity chips for types present in data', () => {
    const { getByText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    // data has 'papers' and 'modules' node types
    expect(getByText(/papers/i)).toBeTruthy()
    expect(getByText(/modules/i)).toBeTruthy()
  })

  test('sidebar renders edge type groups from data', () => {
    const { getAllByText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    // uses_module is in 'Composition' group per graph-style workflowFor;
    // the text appears in both the edge-group label and the preset button — that's fine
    expect(getAllByText('Composition').length).toBeGreaterThan(0)
  })

  test('search input is present', () => {
    const { getByPlaceholderText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    expect(getByPlaceholderText(/search/i)).toBeTruthy()
  })

  test('low-confidence toggle and label toggle are present', () => {
    const { getByLabelText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    expect(getByLabelText(/hide low.confidence/i)).toBeTruthy()
    expect(getByLabelText(/always show labels/i)).toBeTruthy()
  })

  test('path query section is present', () => {
    const { getByText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    expect(getByText(/path query/i)).toBeTruthy()
  })

  test('preset buttons are rendered', () => {
    const { getByText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    // "↺ All on" reset button should always appear
    expect(getByText(/all on/i)).toBeTruthy()
  })

  test('entity checkbox toggles node visibility on cy', () => {
    const { getByRole } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    // Prepare a captured collection so we can inspect .style calls
    const stylespy = vi.fn().mockReturnThis()
    const capturedCollection = { ...makeNodeCollection(['papers:t']), style: stylespy }
    cyInstance.nodes.mockImplementationOnce((sel?: string) => {
      if (sel === '.papers') return capturedCollection
      return makeNodeCollection(['papers:t', 'modules:s'])
    })
    const checkboxes = getByRole('checkbox', { name: /papers/ })
    fireEvent.click(checkboxes) // uncheck → toggle(false) → cy.nodes('.papers').style('display','none')
    expect(cyInstance.nodes).toHaveBeenCalledWith('.papers')
    expect(stylespy).toHaveBeenCalledWith('display', 'none')
  })
})
