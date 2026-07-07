import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { WorkspaceOverview } from '@apc/dashboard-api'
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
})
