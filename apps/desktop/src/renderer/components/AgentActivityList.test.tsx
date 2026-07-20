import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentActivity } from '@apc/shared'
import { AgentActivityList, formatAgentActivityAge } from './AgentActivityList.js'

function activity(
  paneId: string,
  connection: AgentActivity['connection'],
  phase: AgentActivity['phase'],
  patch: Partial<AgentActivity> = {},
): AgentActivity {
  return {
    pane: {
      paneId,
      projectId: 'p1',
      worktreePath: `/repo/${paneId}`,
      slotId: paneId,
      agent: paneId.includes('claude') ? 'claude' : paneId.includes('open') ? 'opencode' : 'codex',
    },
    launchId: `launch-${paneId}`,
    connection,
    phase,
    processAlive: true,
    lastActivityAt: '2026-07-20T09:58:00Z',
    currentLabel: `현재 작업 ${paneId}`,
    revision: 1,
    ...patch,
  }
}

describe('AgentActivityList', () => {
  it('renders all five human statuses without merging process liveness into them', () => {
    render(
      <AgentActivityList
        now="2026-07-20T10:00:00Z"
        onSelectPane={vi.fn()}
        activities={[
          activity('codex-working', 'connected', 'working'),
          activity('claude-waiting', 'connected', 'awaiting_user'),
          activity('open-idle', 'starting', 'idle', { processAlive: false }),
          activity('codex-error', 'error', 'working', { processAlive: false }),
          activity('claude-disconnected', 'disconnected', 'awaiting_user', { processAlive: false }),
        ]}
      />,
    )

    for (const label of ['작업 중', '응답 대기', '유휴', '오류', '연결 끊김']) {
      expect(screen.getByText(label)).toBeDefined()
    }
    expect(screen.getAllByLabelText('프로세스 실행 중')).toHaveLength(2)
    expect(screen.getAllByLabelText('프로세스 종료')).toHaveLength(3)
  })

  it('shows current label, relative last activity, and a stale warning without changing status', () => {
    render(
      <AgentActivityList
        now="2026-07-20T10:00:00Z"
        onSelectPane={vi.fn()}
        activities={[activity('codex-1', 'connected', 'working', {
          staleSince: '2026-07-20T09:59:00Z', currentLabel: '테스트 실행',
        })]}
      />,
    )

    expect(screen.getByText('작업 중')).toBeDefined()
    expect(screen.getByText('테스트 실행')).toBeDefined()
    expect(screen.getByText('마지막 활동 2분 전 · 중단 가능성')).toBeDefined()
  })

  it('returns the exact pane identity when its row is selected', () => {
    const onSelectPane = vi.fn()
    const row = activity('codex-2', 'connected', 'idle')
    render(<AgentActivityList activities={[row]} onSelectPane={onSelectPane} />)

    fireEvent.click(screen.getByRole('button', { name: /Codex codex-2 codex-2 열기/ }))
    expect(onSelectPane).toHaveBeenCalledWith(row.pane)
  })

  it('renders a useful empty state and deterministic relative ages', () => {
    render(<AgentActivityList activities={[]} onSelectPane={vi.fn()} />)
    expect(screen.getByText('에이전트 활동이 없습니다.')).toBeDefined()
    expect(formatAgentActivityAge('2026-07-20T09:59:20Z', '2026-07-20T10:00:00Z')).toBe('40초 전')
    expect(formatAgentActivityAge('invalid', '2026-07-20T10:00:00Z')).toBe('시각 확인 불가')
  })
})
