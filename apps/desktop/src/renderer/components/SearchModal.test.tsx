import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SearchModal } from './SearchModal.js'

const searchEvidence = vi.fn()
const resolveEvidenceSource = vi.fn()

vi.mock('../api.js', () => ({
  api: {
    searchEvidence: (...args: unknown[]) => searchEvidence(...args),
    resolveEvidenceSource: (...args: unknown[]) => resolveEvidenceSource(...args),
  },
}))

const response = {
  ok: true as const,
  response: {
    query: { text: 'auth', scope: { projectIds: ['p1'] }, limit: 20 },
    evidence: [{
      candidateId: 'session:s1:turn:0',
      parentId: 'session:s1',
      sourceKind: 'session' as const,
      projectId: 'p1',
      title: 'Authentication session',
      excerpt: 'jwt auth flow',
      uri: 'apc://session/s1#turn-0',
      sourceRank: 1,
      fusedScore: 0.999,
      authority: 'raw' as const,
      signals: { conflict: true, stale: true },
      reasons: ['fts:session'],
      warnings: ['conflict-document'],
    }],
    diagnostics: {
      retrievers: [{
        id: 'session-fts',
        candidates: 1,
        elapsedMs: 2,
      }, {
        id: 'knowledge-fts',
        candidates: 0,
        elapsedMs: 3,
        error: { code: 'retriever-failed' as const, message: 'knowledge temporarily unavailable' },
      }],
      droppedDuplicates: 1,
      droppedByCap: 2,
    },
  },
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function responseWithTitle(title: string) {
  return {
    ...response,
    response: {
      ...response.response,
      evidence: [{
        ...response.response.evidence[0],
        candidateId: `candidate:${title}`,
        title,
      }],
    },
  }
}

describe('SearchModal', () => {
  beforeEach(() => {
    searchEvidence.mockReset()
    searchEvidence.mockResolvedValue(response)
    resolveEvidenceSource.mockReset()
    resolveEvidenceSource.mockResolvedValue({
      ok: true,
      source: {
        uri: 'apc://session/s1#turn-0',
        sourceKind: 'session',
        projectId: 'p1',
        title: 'Authentication session',
        selectedOrdinal: 0,
        content: '[turn 0 · user]\nfull source context',
        truncated: true,
        warnings: ['source-content-truncated'],
      },
    })
  })

  test('renders nothing when closed', () => {
    const { container } = render(<SearchModal open={false} onClose={vi.fn()} onSelectProject={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  test('renders evidence metadata and diagnostics without presenting fused score as confidence', async () => {
    render(<SearchModal open onClose={vi.fn()} onSelectProject={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'auth' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })

    const projectButton = await screen.findByRole('button', { name: '프로젝트 열기: Authentication session' })
    const result = projectButton.closest('li')
    expect(result).toBeTruthy()
    expect(within(result!).getByText('Authentication session')).toBeTruthy()
    expect(within(result!).getByText('jwt auth flow')).toBeTruthy()
    expect(within(result!).getByText('session')).toBeTruthy()
    expect(within(result!).getByText('p1')).toBeTruthy()
    expect(within(result!).getByText('raw')).toBeTruthy()
    expect(within(result!).getByText('conflict')).toBeTruthy()
    expect(within(result!).getByText('stale')).toBeTruthy()
    expect(within(result!).getByText('conflict-document')).toBeTruthy()
    expect(screen.getByText(/knowledge temporarily unavailable/)).toBeTruthy()
    expect(screen.getByText(/중복 1/)).toBeTruthy()
    expect(screen.queryByText(/99\.9%/)).toBeNull()
    expect(screen.queryByText('0.999')).toBeNull()
  })

  test('keeps project selection and source-open as separate actions', async () => {
    const onClose = vi.fn()
    const onSelectProject = vi.fn()
    const onOpenSource = vi.fn()
    render(
      <SearchModal
        open
        onClose={onClose}
        onSelectProject={onSelectProject}
        onOpenSource={onOpenSource}
      />,
    )
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'auth' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })

    fireEvent.click(await screen.findByRole('button', { name: '원문 보기: Authentication session' }))
    expect(onOpenSource).toHaveBeenCalledWith('apc://session/s1#turn-0')
    expect(resolveEvidenceSource).not.toHaveBeenCalled()
    expect(onSelectProject).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '프로젝트 열기: Authentication session' }))
    expect(onSelectProject).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalled()
  })

  test('resolves and renders bounded source detail through the default IPC action', async () => {
    render(<SearchModal open onClose={vi.fn()} onSelectProject={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'auth' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })

    fireEvent.click(await screen.findByRole('button', { name: '원문 보기: Authentication session' }))

    expect(resolveEvidenceSource).toHaveBeenCalledWith({ uri: 'apc://session/s1#turn-0', neighbors: 1 })
    const detail = await screen.findByRole('region', { name: '원문 상세' })
    expect(within(detail).getByText('full source context', { exact: false })).toBeTruthy()
    expect(within(detail).getByText('source-content-truncated')).toBeTruthy()
    expect(within(detail).queryByText(/secret\.jsonl/)).toBeNull()
  })

  test('shows a typed source-resolution failure without closing search results', async () => {
    resolveEvidenceSource.mockResolvedValue({
      ok: false,
      error: { code: 'source-not-found', message: '원문을 찾을 수 없습니다.' },
    })
    render(<SearchModal open onClose={vi.fn()} onSelectProject={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'auth' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('button', { name: '원문 보기: Authentication session' }))

    expect(await screen.findByText('source-not-found: 원문을 찾을 수 없습니다.')).toBeTruthy()
    expect(screen.getByText('Authentication session')).toBeTruthy()
  })

  test('shows a typed empty-registry diagnostic and no fake result', async () => {
    searchEvidence.mockResolvedValue({
      ok: false,
      evidence: [],
      diagnostic: {
        code: 'no-registered-projects',
        message: '검색할 등록 프로젝트가 없습니다.',
        retrievers: [],
      },
    })
    render(<SearchModal open onClose={vi.fn()} onSelectProject={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'auth' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })

    expect(await screen.findByText('검색할 등록 프로젝트가 없습니다.')).toBeTruthy()
    expect(screen.getByText('결과 없음')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^프로젝트 열기:/ })).toBeNull()
  })

  test('does not invoke IPC for a whitespace-only query', () => {
    render(<SearchModal open onClose={vi.fn()} onSelectProject={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('search'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })
    expect(searchEvidence).not.toHaveBeenCalled()
    expect(screen.getByText('검색어를 입력하세요.')).toBeTruthy()
  })

  test('discards a stale response when a newer search finishes first', async () => {
    const first = deferred<ReturnType<typeof responseWithTitle>>()
    const second = deferred<ReturnType<typeof responseWithTitle>>()
    searchEvidence
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    render(<SearchModal open onClose={vi.fn()} onSelectProject={vi.fn()} />)
    const input = screen.getByLabelText('search')

    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'second' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await act(async () => { second.resolve(responseWithTitle('Second result')) })
    expect(await screen.findByText('Second result')).toBeTruthy()
    await act(async () => { first.resolve(responseWithTitle('Stale first result')) })

    expect(screen.getByText('Second result')).toBeTruthy()
    expect(screen.queryByText('Stale first result')).toBeNull()
  })
})
