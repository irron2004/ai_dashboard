import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { WikiProgressSummarySchema } from '@apc/shared'
import { createWikiProgressState, type WikiProgressState } from '../wiki-progress-state.js'
import { WikiProgress } from './WikiProgress.js'

const NOW = Date.parse('2026-07-20T10:01:00.000Z')
const now = () => NOW

function progress(patch: Record<string, unknown> = {}): WikiProgressState {
  const snapshot = WikiProgressSummarySchema.parse({
    runId: 'RUN-1',
    projectId: 'p1',
    status: 'generating',
    health: 'active',
    phase: 'NODE_PROPOSALS_CREATED',
    startedAt: '2026-07-20T10:00:00.000Z',
    lastActivityAt: '2026-07-20T10:00:50.000Z',
    work: { total: 2, completed: 1, inProgress: 1, failed: 0, retries: 1 },
    workers: [
      { workerId: 'worker-docs', folder: 'docs', attempt: 1, status: 'completed', lastActivityAt: '2026-07-20T10:00:30.000Z' },
      { workerId: 'worker-src', folder: 'src', attempt: 2, status: 'retrying', lastActivityAt: '2026-07-20T10:00:50.000Z', message: 'rate limit 대기' },
    ],
    nodes: [
      { workerId: 'worker-docs', proposalId: 'proposal-a', title: '빌드 구조', nodeType: 'ConceptNode', sourceFolder: 'docs', status: 'accepted', discoveredAt: '2026-07-20T10:00:20.000Z', updatedAt: '2026-07-20T10:00:30.000Z' },
      { workerId: 'worker-src', proposalId: 'proposal-b', title: '폐기된 후보', nodeType: 'DecisionNode', sourceFolder: 'src', status: 'dropped', discoveredAt: '2026-07-20T10:00:40.000Z', updatedAt: '2026-07-20T10:00:50.000Z' },
    ],
    ...patch,
  })
  const state = createWikiProgressState({ snapshot, active: snapshot.health !== 'interrupted' })
  if (!state) throw new Error('progress state missing')
  return state
}

describe('WikiProgress', () => {
  test('shows user status, separate worker counts, nodes, and timing', () => {
    render(<WikiProgress progress={progress()} now={now} />)
    expect(screen.getAllByText('생성 중').length).toBeGreaterThan(0)
    expect(screen.getByText('경과 1분')).toBeDefined()
    expect(screen.getByText('마지막 활동 10초 전')).toBeDefined()
    expect(screen.getByLabelText('작업 집계').textContent).toContain('전체 작업2')
    expect(screen.getByRole('region', { name: '워커 진행' })).toBeDefined()
    expect(screen.getAllByText('docs')).toHaveLength(2)
    expect(screen.getByText('rate limit 대기')).toBeDefined()
    expect(screen.getByRole('region', { name: '노드 생성 진행' })).toBeDefined()
    expect(screen.getByText('빌드 구조')).toBeDefined()
    expect(screen.getByText('ConceptNode')).toBeDefined()
    expect(screen.getByText('폐기된 후보')).toBeDefined()
  })

  test('keeps detailed logs collapsed and requests capped logs only when opened', async () => {
    const onReadLog = vi.fn(async () => ({ ok: true, content: 'persisted output' }))
    render(<WikiProgress progress={progress()} onReadLog={onReadLog} now={now} />)
    const toggle = screen.getByRole('button', { name: /상세 로그 보기/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(onReadLog).not.toHaveBeenCalled()
    expect(screen.queryByText('persisted output')).toBeNull()

    fireEvent.click(toggle)
    await waitFor(() => expect(onReadLog).toHaveBeenCalledWith('RUN-1'))
    expect(await screen.findByText('persisted output')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /상세 로그 접기/ }))
    fireEvent.click(screen.getByRole('button', { name: /상세 로그 보기/ }))
    expect(onReadLog).toHaveBeenCalledTimes(1)
  })

  test('shows interrupted guidance and resumes the exact run', () => {
    const onResume = vi.fn()
    render(<WikiProgress
      progress={progress({ status: 'waiting', health: 'interrupted' })}
      onResume={onResume}
      now={now}
    />)
    expect(screen.getByText('중단 가능성')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /이어하기/ }))
    expect(onResume).toHaveBeenCalledWith('RUN-1')
  })

  test('does not invent reconnecting from silence', () => {
    render(<WikiProgress progress={progress({ lastActivityAt: '2026-07-20T09:58:00.000Z' })} now={now} />)
    expect(screen.getByText('중단 가능성')).toBeDefined()
    expect(screen.queryByText('재연결 중')).toBeNull()
    expect(screen.getAllByText('생성 중').length).toBeGreaterThan(0)
  })
})
