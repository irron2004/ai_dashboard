import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { HarnessRunBundle } from '../harness-utils.js'
import { KnowledgeView } from './KnowledgeView.js'

const fsReadDoc = vi.fn(async () => ({ ok: true, content: '# from disk' }))
const fsListDocs = vi.fn(async () => ({ docs: [{ relPath: 'docs/plan.md', mtimeMs: 1 }] }))
vi.mock('../api.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'fsReadDoc') return (...a: unknown[]) => fsReadDoc(...a as [])
      if (prop === 'fsListDocs') return (...a: unknown[]) => fsListDocs(...a as [])
      return vi.fn(async () => ({ ok: true }))
    },
  }),
}))

vi.mock('./GraphVisualization.js', () => ({
  GraphVisualization: ({ onNodeClick }: { onNodeClick: (n: { id: string; label?: string; data?: unknown }) => void }) => (
    <button onClick={() => onNodeClick({ id: 'document:plan', label: 'plan', data: { path: 'docs/plan.md' } })}>GRAPH-STUB</button>
  ),
}))

function wikiRun(): HarnessRunBundle {
  return {
    runState: {
      runId: 'RUN-w', state: 'MERGED', engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-06-12T01:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [
      { state: 'STAGING_WRITTEN', name: 'wiki-overview', path: '/runs/RUN-w/wiki/overview.md', data: { markdown: '# 개요 본문' } },
    ],
  }
}

describe('KnowledgeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({ selectedProjectId: 'p1', harnessRuns: [wikiRun()], selectedHarnessRunId: 'RUN-w' })
  })

  test('문서 mode: tree shows wiki artifacts and project docs', async () => {
    render(<KnowledgeView />)
    // tree items are buttons (artifactLabel → "Wiki Overview"); the viewer header <h2> shows the
    // same title via the fallback, so target the button role to assert on the tree specifically.
    expect(await screen.findByRole('button', { name: 'Wiki Overview' })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'docs/plan.md' })).toBeDefined()
  })

  test('clicking a project doc loads it via fs:readDoc', async () => {
    render(<KnowledgeView />)
    fireEvent.click(await screen.findByText('docs/plan.md'))
    await waitFor(() => expect(fsReadDoc).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'docs/plan.md' }))
    expect(await screen.findByText('from disk')).toBeDefined()
  })

  test('그래프 mode: node click opens peek with disk fallback when no artifact matches', async () => {
    render(<KnowledgeView />)
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    fireEvent.click(screen.getByText('GRAPH-STUB'))
    expect(await screen.findByText('from disk')).toBeDefined()
    expect(screen.getByRole('button', { name: /문서로 열기/ })).toBeDefined()
  })

  test('그래프 peek → 문서로 열기 jumps to the disk file in 문서 mode', async () => {
    render(<KnowledgeView />)
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    fireEvent.click(screen.getByText('GRAPH-STUB'))
    fireEvent.click(await screen.findByRole('button', { name: /문서로 열기/ }))
    // back in 문서 mode the viewer loads the peeked file via fs:readDoc (not the wiki fallback)
    await waitFor(() => expect(fsReadDoc).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'docs/plan.md' }))
    expect(await screen.findByText('from disk')).toBeDefined()
    // the disk file's relPath is now the active viewer title
    expect(screen.getByRole('heading', { name: 'docs/plan.md' })).toBeDefined()
  })
})
