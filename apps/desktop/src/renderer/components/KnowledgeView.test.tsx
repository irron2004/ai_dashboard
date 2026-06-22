import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { HarnessRunBundle } from '../harness-utils.js'
import { KnowledgeView } from './KnowledgeView.js'

const fsReadDoc = vi.fn(async () => ({ ok: true, content: '# from disk' }))
const fsListDocs = vi.fn(async () => ({ docs: [{ relPath: 'docs/plan.md', mtimeMs: 1 }] }))
// default: no staged draft → graph clicks fall through to the disk read
const harnessReadStagedDoc = vi.fn(async () => ({ ok: false, reason: 'no staging' }))
const harnessListStagedDocs = vi.fn(async () => ({ docs: [] as Array<{ relPath: string; isNode: boolean; nodeId?: string; nodeType?: string; title?: string }> }))
const readProjectWiki = vi.fn(async () => ({
  available: true as const,
  wikiDir: '/projects/p1/wiki',
  nodes: [{ ref: 'concept/test-concept', type: 'concept', title: 'Test Concept', relPath: 'wiki/concept/test-concept.md' }],
  edges: [],
}))
vi.mock('../api.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'fsReadDoc') return (...a: unknown[]) => fsReadDoc(...a as [])
      if (prop === 'fsListDocs') return (...a: unknown[]) => fsListDocs(...a as [])
      if (prop === 'harnessReadStagedDoc') return (...a: unknown[]) => harnessReadStagedDoc(...a as [])
      if (prop === 'harnessListStagedDocs') return (...a: unknown[]) => harnessListStagedDocs(...a as [])
      if (prop === 'readProjectWiki') return (...a: unknown[]) => readProjectWiki(...a as [])
      return vi.fn(async () => ({ ok: true }))
    },
  }),
}))

vi.mock('./GraphVisualization.js', () => ({
  GraphVisualization: ({ onNodeClick }: { onNodeClick: (n: { id: string; label?: string; data?: unknown }) => void }) => (
    <>
      <button onClick={() => onNodeClick({ id: 'document:plan', label: 'plan', data: { path: 'docs/plan.md' } })}>GRAPH-STUB</button>
      <button onClick={() => onNodeClick({ id: 'decision.real', label: 'Real Title' })}>GRAPH-NODE</button>
    </>
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

  test('docs tree shows only real nodes from staging and hides stubs', async () => {
    harnessListStagedDocs.mockResolvedValueOnce({ docs: [
      { relPath: 'nodes/decision.real.md', isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' },
      { relPath: 'nodes/old-stub.md', isNode: false },
    ] } as never)
    render(<KnowledgeView />)
    expect(await screen.findByRole('button', { name: /Real Title/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /old-stub/ })).toBeNull()
    expect(screen.getByText(/진짜 노드 1개/)).toBeDefined()
  })

  test('clicking a real staged node loads it via harnessReadStagedDoc', async () => {
    harnessListStagedDocs.mockResolvedValueOnce({ docs: [
      { relPath: 'nodes/decision.real.md', isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' },
    ] } as never)
    harnessReadStagedDoc.mockResolvedValueOnce({ ok: true, content: '# Real Title\n\nbody' } as never)
    render(<KnowledgeView />)
    fireEvent.click(await screen.findByRole('button', { name: /Real Title/ }))
    await waitFor(() => expect(harnessReadStagedDoc).toHaveBeenCalledWith({ runId: 'RUN-w', relPath: 'nodes/decision.real.md' }))
    expect(await screen.findByText('body')).toBeDefined()
  })

  test('그래프 mode: node click opens peek with disk fallback when no artifact matches', async () => {
    render(<KnowledgeView />)
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    fireEvent.click(screen.getByText('GRAPH-STUB'))
    expect(await screen.findByText('from disk')).toBeDefined()
    expect(screen.getByRole('button', { name: /문서로 열기/ })).toBeDefined()
  })

  test('그래프 mode: node click shows the run staged draft (preferred over disk)', async () => {
    harnessReadStagedDoc.mockResolvedValueOnce({ ok: true, content: '# staged draft body' } as never)
    render(<KnowledgeView />)
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    fireEvent.click(screen.getByText('GRAPH-STUB'))
    expect(await screen.findByText('staged draft body')).toBeDefined()
    expect(harnessReadStagedDoc).toHaveBeenCalledWith({ runId: 'RUN-w', relPath: 'docs/plan.md' })
    expect(fsReadDoc).not.toHaveBeenCalled()   // staging hit → no disk fallback
  })

  test('graph staged node resolves by node_id and 문서로 열기 keeps staged reader', async () => {
    harnessListStagedDocs.mockResolvedValueOnce({ docs: [
      { relPath: 'nodes/decision.real.md', isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' },
    ] } as never)
    harnessReadStagedDoc
      .mockResolvedValueOnce({ ok: true, content: '# Real Title\n\npeek body' } as never)
      .mockResolvedValueOnce({ ok: true, content: '# Real Title\n\ndoc body' } as never)
    render(<KnowledgeView />)
    await screen.findByText(/진짜 노드 1개/)
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    fireEvent.click(await screen.findByText('GRAPH-NODE'))
    expect(await screen.findByText('peek body')).toBeDefined()
    expect(harnessReadStagedDoc).toHaveBeenCalledWith({ runId: 'RUN-w', relPath: 'nodes/decision.real.md' })

    fireEvent.click(screen.getByRole('button', { name: /문서로 열기/ }))
    await waitFor(() => expect(harnessReadStagedDoc).toHaveBeenCalledTimes(2))
    expect(harnessReadStagedDoc).toHaveBeenLastCalledWith({ runId: 'RUN-w', relPath: 'nodes/decision.real.md' })
    expect(await screen.findByText('doc body')).toBeDefined()
    expect(fsReadDoc).not.toHaveBeenCalled()
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

  test('shows a project-wiki / latest-run toggle; wiki button enabled when a wiki is available', async () => {
    render(<KnowledgeView />)
    // switch to graph mode
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    const wikiBtn = await screen.findByRole('button', { name: '프로젝트 위키' })
    expect(wikiBtn).toBeDefined()
    expect((wikiBtn as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: '최신 런' })).toBeDefined()
  })
})
