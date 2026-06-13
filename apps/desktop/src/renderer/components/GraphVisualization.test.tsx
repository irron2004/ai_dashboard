import { render, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { GraphVisualization } from './GraphVisualization.js'
import type { HarnessGraphData } from '../harness-utils.js'

const data: HarnessGraphData = {
  nodes: [{ id: 'n1', label: 'Node One', type: 'document', shape: 'circle', color: '#69c', data: { path: 'docs/x.md' } }],
  links: [],
}

describe('GraphVisualization pointer handling', () => {
  // Regression for the graph node-peek bug: beginPan must NOT capture the pointer when the gesture
  // starts on a node. In Chromium an ancestor that setPointerCapture()s during pointerdown gets the
  // subsequent `click` retargeted to it, so the node's onClick never fires and the md peek never opens.
  // jsdom can't reproduce that retargeting, so we assert the guard that prevents it: capture engages
  // only when the pointerdown started on the bare svg background (event.target === event.currentTarget).
  test('pointerdown on a node does NOT capture the pointer; pointerdown on the canvas does', () => {
    const { container } = render(<GraphVisualization data={data} onNodeClick={vi.fn()} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    const capture = vi.fn()
    svg.setPointerCapture = capture
    svg.releasePointerCapture = vi.fn()

    const node = container.querySelector('.graph-visualization__node') as Element
    fireEvent.pointerDown(node, { pointerId: 1 })
    expect(capture).not.toHaveBeenCalled()   // node press stays a click → onNodeClick fires

    fireEvent.pointerDown(svg, { pointerId: 1 })
    expect(capture).toHaveBeenCalledTimes(1)  // background press still begins a pan
  })

  test('clicking a node calls onNodeClick with that node', () => {
    const onNodeClick = vi.fn()
    const { container } = render(<GraphVisualization data={data} onNodeClick={onNodeClick} />)
    fireEvent.click(container.querySelector('.graph-visualization__node') as Element)
    expect(onNodeClick).toHaveBeenCalledTimes(1)
    expect(onNodeClick.mock.calls[0][0]).toMatchObject({ id: 'n1', label: 'Node One' })
  })
})
