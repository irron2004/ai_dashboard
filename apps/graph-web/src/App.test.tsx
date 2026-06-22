import { describe, expect, test, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('cytoscape', () => ({
  default: () => ({
    on: vi.fn(),
    destroy: vi.fn(),
    fit: vi.fn(),
    elements: () => [],
    nodes: () => ({ addClass: vi.fn(), removeClass: vi.fn() }),
    edges: () => ({}),
    zoom: () => 1,
    resize: vi.fn(),
  }),
}))

import { App } from './App.js'

beforeEach(() => { vi.clearAllMocks() })

describe('App', () => {
  test('renders the graph when /api/graph returns available data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        available: true,
        wikiDir: '/w',
        nodes: [{ ref: 'papers/a', type: 'papers', title: 'A', relPath: 'wiki/papers/a.md' }],
        edges: [],
      }),
    }) as unknown as typeof fetch
    render(<App />)
    await waitFor(() => expect(screen.queryByText(/no wiki|위키 없음/i)).toBeNull())
  })

  test('shows an empty state when not available', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ available: false }),
    }) as unknown as typeof fetch
    render(<App />)
    await waitFor(() => expect(screen.getByText(/no wiki|위키 없음|WIKI_DIR/i)).toBeTruthy())
  })
})
