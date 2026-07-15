import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentType } from '@apc/shared'
import type { ConversationHistoryRes } from '../../shared/ipc-contract.js'
import { QuestionHistory } from './QuestionHistory.js'

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

describe('QuestionHistory', () => {
  test('shows the selected agent sessions and expands a question to reveal its answer', async () => {
    const fetchHistory = vi.fn(async ({ agent }: { agent: AgentType }) => history(agent))
    render(<QuestionHistory open projectId="p1" initialAgent="codex" fetchHistory={fetchHistory} onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('질문 2개 · feat/history')).toBeTruthy())
    expect(fetchHistory).toHaveBeenCalledWith({ projectId: 'p1', agent: 'codex', limit: 40 })
    expect(screen.queryByText(/원인을 확인하고/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }))

    expect(screen.getByText(/원인을 확인하고/)).toBeTruthy()
    expect(screen.getByText('수정했습니다.').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }).getAttribute('aria-expanded')).toBe('true')
  })

  test('switches agents and loads that agent session list', async () => {
    const fetchHistory = vi.fn(async ({ agent }: { agent: AgentType }) => history(agent))
    render(<QuestionHistory open projectId="p1" initialAgent="codex" fetchHistory={fetchHistory} onClose={() => {}} />)
    await waitFor(() => screen.getByText('질문 2개 · feat/history'))

    fireEvent.click(screen.getByRole('tab', { name: 'Claude' }))

    await waitFor(() => expect(screen.getAllByText('claude 질문').length).toBeGreaterThan(0))
    expect(fetchHistory).toHaveBeenLastCalledWith({ projectId: 'p1', agent: 'claude', limit: 40 })
    expect(screen.getByRole('tab', { name: 'Claude' }).getAttribute('aria-selected')).toBe('true')
  })

  test('selecting another session replaces the question list', async () => {
    render(<QuestionHistory open projectId="p1" initialAgent="codex" fetchHistory={async () => history('codex')} onClose={() => {}} />)
    await waitFor(() => screen.getByText('질문 2개 · feat/history'))

    fireEvent.click(screen.getByTitle('이전 질문'))

    expect(screen.getByRole('button', { name: /^Q1 이전 질문/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ })).toBeNull()
  })

  test('shows an empty state per agent and does not fetch without a project', async () => {
    const empty = { ...history('opencode'), sessions: [] }
    const fetchHistory = vi.fn(async () => empty)
    const { rerender } = render(<QuestionHistory open projectId="p1" initialAgent="opencode" fetchHistory={fetchHistory} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/OpenCode에서 이 프로젝트의 대화를 찾지 못했습니다/)).toBeTruthy())

    fetchHistory.mockClear()
    rerender(<QuestionHistory open projectId={null} initialAgent="opencode" fetchHistory={fetchHistory} onClose={() => {}} />)
    expect(screen.getByText(/프로젝트를 먼저 선택/)).toBeTruthy()
    expect(fetchHistory).not.toHaveBeenCalled()
  })
})
