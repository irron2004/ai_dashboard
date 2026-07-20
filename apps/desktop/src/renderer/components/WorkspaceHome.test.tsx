import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { WorkspaceOverview } from '@apc/dashboard-api'
import type { AgentActivity } from '@apc/shared'
import { WorkspaceHome } from './WorkspaceHome.js'

const overview: WorkspaceOverview = {
  generatedAt: '2026-07-02T00:00:00.000Z',
  projects: [
    {
      project: { id: 'a', name: 'Alpha', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: [], vaultPaths: [], sourcePaths: [] },
      activeTaskCount: 2, reviewQueueCount: 1,
      runningRuns: [{ id: 'R1', taskId: 'T1', agent: 'claude', repoPath: '/a', startedAt: '2026-07-02T09:30:00Z', status: 'running' }],
      nextUp: [{ id: 'T1', projectId: 'a', title: 'first task', status: 'todo', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] }],
    },
  ],
}

describe('WorkspaceHome', () => {
  test('shows a loading state when overview is null', () => {
    render(<WorkspaceHome overview={null} onRefresh={() => {}} onOpenProject={() => {}} />)
    expect(screen.getByText('불러오는 중…')).toBeDefined()
  })

  test('renders a per-project card with counts, running runs, and nextUp', () => {
    render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={() => {}} />)
    const card = screen.getByTestId('workspace-card-a')
    expect(within(card).getByText('Alpha')).toBeDefined()
    expect(within(card).getByText('진행중 2')).toBeDefined()
    expect(within(card).getByText('실행중 1')).toBeDefined()
    expect(within(card).getByText('리뷰 1')).toBeDefined()
    expect(within(card).getByText('claude')).toBeDefined()      // run-status span (exact)
    expect(within(card).getByText('first task')).toBeDefined()
  })

  test('clicking the project title calls onOpenProject', () => {
    const onOpenProject = vi.fn()
    render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={onOpenProject} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(onOpenProject).toHaveBeenCalledWith('a')
  })

  test('clicking a nextUp task opens its project', () => {
    const onOpenProject = vi.fn()
    render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={onOpenProject} />)
    fireEvent.click(screen.getByText('first task'))
    expect(onOpenProject).toHaveBeenCalledWith('a')
  })

  test('the refresh button fires onRefresh', () => {
    const onRefresh = vi.fn()
    render(<WorkspaceHome overview={overview} onRefresh={onRefresh} onOpenProject={() => {}} />)
    fireEvent.click(screen.getByLabelText('전체 새로고침'))
    expect(onRefresh).toHaveBeenCalled()
  })

  test('renders a project topNote when present', () => {
    const overview = { generatedAt: '', projects: [{
      project: { id: 'p1', name: 'coin', domain: 'prediction' }, activeTaskCount: 0, runningRuns: [], reviewQueueCount: 0, nextUp: [], topNote: '7/10 상장 반영',
    }] } as never
    render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={() => {}} />)
    expect(screen.getByText(/7\/10 상장 반영/)).toBeTruthy()
  })

  test('shows context provenance and routes exact activity and question targets', () => {
    const contextualOverview = {
      ...overview,
      projects: [{
        ...overview.projects[0],
        project: {
          ...overview.projects[0].project,
          goal: '안전한 데스크톱 출시',
          goalSource: 'agent' as const,
          currentFocus: '실시간 활동 통합',
          currentFocusSource: 'user' as const,
          currentFocusConfirmedAt: '2026-07-20T09:00:00Z',
        },
      }],
    }
    const activity: AgentActivity = {
      pane: {
        paneId: 'a:main:codex-1', projectId: 'a', worktreePath: '/repo/apc', slotId: 'codex-1', agent: 'codex',
      },
      launchId: 'launch-1', connection: 'connected', phase: 'awaiting_user', processAlive: true,
      lastActivityAt: '2026-07-20T10:00:00Z', currentLabel: '테스트 결과 검토 중',
      lastQuestion: {
        displayText: '배포해도 될까요?', askedAt: '2026-07-20T10:00:00Z', privacy: 'visible', source: 'pty',
      },
      revision: 3,
    }
    const onOpenActivityPane = vi.fn()
    const onOpenActivityQuestion = vi.fn()
    render(
      <WorkspaceHome
        overview={contextualOverview}
        onRefresh={() => {}}
        onOpenProject={() => {}}
        activities={[activity]}
        onOpenActivityPane={onOpenActivityPane}
        onOpenActivityQuestion={onOpenActivityQuestion}
      />,
    )
    const card = screen.getByTestId('workspace-card-a')
    expect(within(card).getByText('안전한 데스크톱 출시')).toBeDefined()
    expect(within(card).getByText('AI 제안')).toBeDefined()
    expect(within(card).getByText('실시간 활동 통합')).toBeDefined()
    expect(within(card).getByText('사용자 작성')).toBeDefined()
    expect(within(card).getByText('응답 대기')).toBeDefined()

    fireEvent.click(within(card).getByRole('button', { name: 'Codex apc codex-1 열기' }))
    expect(onOpenActivityPane).toHaveBeenCalledWith(activity.pane)
    fireEvent.click(within(card).getByRole('button', { name: /codex.*배포해도 될까요/ }))
    expect(onOpenActivityQuestion).toHaveBeenCalledWith(activity)
  })
})
