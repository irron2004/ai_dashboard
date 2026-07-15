import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentType } from '@apc/shared'
import type { ConversationHistoryRes } from '../../shared/ipc-contract.js'
import { ConversationHistoryView } from './ConversationHistoryView.js'

function history(agent: AgentType): ConversationHistoryRes {
  const isCodex = agent === 'codex'
  return {
    projectId: 'p1',
    agent,
    scannedSources: 2,
    skippedSources: 0,
    truncated: false,
    sessions: isCodex ? [
      {
        id: 'codex-new', agent, startedAt: '2026-07-15T10:00:00Z', endedAt: '2026-07-15T10:20:00Z',
        branch: 'feat/history', preview: '로그인 오류를 고쳐 줘',
        exchanges: [
          { id: 'q1', askedAt: '2026-07-15T10:01:00Z', question: '로그인 오류를 고쳐 줘', answer: '원인을 확인하고 **수정했습니다.**' },
          { id: 'q2', askedAt: '2026-07-15T10:10:00Z', question: '테스트도 통과해?', answer: null },
        ],
      },
      {
        id: 'codex-old', agent, startedAt: '2026-07-14T08:00:00Z', endedAt: '2026-07-14T08:10:00Z',
        preview: '이전 질문', exchanges: [{ id: 'q1', question: '이전 질문', answer: '이전 답변' }],
      },
    ] : [
      {
        id: `${agent}-one`, agent, startedAt: '2026-07-13T08:00:00Z', endedAt: '2026-07-13T08:10:00Z',
        preview: `${agent} 질문`, exchanges: [{ id: 'q1', question: `${agent} 질문`, answer: `${agent} 답변` }],
      },
    ],
  }
}

function renderView(over: Partial<Parameters<typeof ConversationHistoryView>[0]> = {}) {
  const props = {
    projectId: 'p1' as string | null,
    focus: null,
    onFocusConsumed: vi.fn(),
    fetchHistory: vi.fn(async ({ agent }: { agent: AgentType }) => history(agent)),
    ...over,
  }
  return { ...render(<ConversationHistoryView {...props} />), props }
}

describe('ConversationHistoryView', () => {
  test('선택한 에이전트의 세션을 보이고 질문을 펼치면 답변을 렌더한다', async () => {
    const { props } = renderView()

    await waitFor(() => expect(screen.getByText('질문 2개 · feat/history')).toBeTruthy())
    expect(props.fetchHistory).toHaveBeenCalledWith({ projectId: 'p1', agent: 'codex', limit: 40 })
    expect(screen.queryByText(/원인을 확인하고/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }))

    expect(screen.getByText(/원인을 확인하고/)).toBeTruthy()
    expect(screen.getByText('수정했습니다.').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }).getAttribute('aria-expanded')).toBe('true')
  })

  test('에이전트 탭을 전환하면 해당 에이전트 세션을 불러온다', async () => {
    const { props } = renderView()
    await waitFor(() => screen.getByText('질문 2개 · feat/history'))

    fireEvent.click(screen.getByRole('tab', { name: 'Claude' }))

    await waitFor(() => expect(screen.getAllByText('claude 질문').length).toBeGreaterThan(0))
    expect(props.fetchHistory).toHaveBeenLastCalledWith({ projectId: 'p1', agent: 'claude', limit: 40 })
    expect(screen.getByRole('tab', { name: 'Claude' }).getAttribute('aria-selected')).toBe('true')
  })

  test('다른 세션을 선택하면 질문 목록이 교체된다', async () => {
    renderView()
    await waitFor(() => screen.getByText('질문 2개 · feat/history'))

    fireEvent.click(screen.getByTitle('이전 질문'))

    expect(screen.getByRole('button', { name: /^Q1 이전 질문/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ })).toBeNull()
  })

  test('에이전트별 빈 상태를 보이고 프로젝트가 없으면 fetch하지 않는다', async () => {
    const empty = { ...history('opencode'), sessions: [] }
    const fetchHistory = vi.fn(async () => empty)
    const { rerender } = renderView({
      focus: { agent: 'opencode' }, fetchHistory,
    })
    await waitFor(() => expect(screen.getByText(/OpenCode에서 이 프로젝트의 대화를 찾지 못했습니다/)).toBeTruthy())

    fetchHistory.mockClear()
    rerender(
      <ConversationHistoryView projectId={null} focus={null} onFocusConsumed={() => {}} fetchHistory={fetchHistory} />,
    )
    expect(screen.getByText(/프로젝트를 먼저 선택/)).toBeTruthy()
    expect(fetchHistory).not.toHaveBeenCalled()
  })

  test('focus 주입 시 세션을 선택하고 질문을 펼친 뒤 소거한다', async () => {
    const { props } = renderView({ focus: { agent: 'codex', sessionId: 'codex-old', exchangeId: 'q1' } })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Q1 이전 질문/ }).getAttribute('aria-expanded')).toBe('true'))
    expect(screen.getByTitle('이전 질문').className).toContain('question-history__session--active')
    expect(props.onFocusConsumed).toHaveBeenCalled()
  })

  test('focus의 sessionId가 목록에 없으면 무시하고 첫 세션을 기본 선택한다', async () => {
    renderView({ focus: { agent: 'codex', sessionId: 'no-such-session', exchangeId: 'q9' } })

    await waitFor(() => screen.getByText('질문 2개 · feat/history'))
    expect(screen.getByTitle('로그인 오류를 고쳐 줘').className).toContain('question-history__session--active')
    expect(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }).getAttribute('aria-expanded')).toBe('false')
  })
})
