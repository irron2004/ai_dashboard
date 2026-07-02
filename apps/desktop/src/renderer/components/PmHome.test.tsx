import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { CH } from '../../shared/ipc-contract.js'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'

const dashboard: ProjectDashboardRes = {
  project: {
    id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', currentFocus: 'PM Home',
    startDate: '2026-06-01', targetDate: '2026-06-30', projectType: 'git', domain: 'project-docs', repoPaths: [], vaultPaths: [], sourcePaths: [],
  },
  activeTasks: [],
  reviewQueue: [
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] },
  ],
  recentRuns: [
    { id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' },
  ],
  allTasks: [
    { id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress', assigneeType: 'agent', priority: 'high', dueDate: '2026-06-15', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] },
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] },
  ],
}

describe('PmHome', () => {
  test('renders goal and current focus', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.getByText('PM Home')).toBeDefined()
  })

  test('renders the task board with cards in the right columns', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(within(screen.getByTestId('col-in_progress')).getByText('do work')).toBeDefined()
    expect(within(screen.getByTestId('col-review')).getByText('needs review')).toBeDefined()
  })

  test('renders a timeline marker for the dated task', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByTitle('do work')).toBeDefined()
  })

  test('renders the review queue and recent runs', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByText(/R1/)).toBeDefined()
    expect(screen.getByText('completed')).toBeDefined()
  })

  test('renders the 다음 할 일 widget with unblocked actionable tasks', () => {
    render(<PmHome dashboard={dashboard} />)
    const nextUp = screen.getByTestId('next-up')
    // T1 (in_progress) is actionable; T2 (review) is not listed here
    expect(within(nextUp).getByText('do work')).toBeDefined()
    expect(within(nextUp).queryByText('needs review')).toBeNull()
  })
  test('reverts the optimistic overlay when the bridge rejects the dependency', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: false, reason: 'cycle' }))
    ;(window as unknown as { apc: unknown }).apc = { invoke, onDevHarnessLog: () => () => {} }
    try {
      render(<PmHome dashboard={dashboard} />)
      fireEvent.click(screen.getByLabelText('의존성 편집 do work'))
      const select = screen.getByLabelText('차단 작업 선택 do work') as HTMLSelectElement
      ;(within(select).getByText('needs review') as HTMLOptionElement).selected = true
      fireEvent.change(select)
      await waitFor(() => {
        expect(screen.queryByText('🚫 차단')).toBeNull()
      })
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })

  test('editing a dependency persists via the bridge and marks the task blocked', () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true }))
    ;(window as unknown as { apc: unknown }).apc = { invoke, onDevHarnessLog: () => () => {} }
    try {
      render(<PmHome dashboard={dashboard} />)
      fireEvent.click(screen.getByLabelText('의존성 편집 do work'))
      const select = screen.getByLabelText('차단 작업 선택 do work') as HTMLSelectElement
      ;(within(select).getByText('needs review') as HTMLOptionElement).selected = true
      fireEvent.change(select)
      expect(invoke).toHaveBeenCalledWith(CH.taskSetBlockedBy, { taskId: 'T1', blockedBy: ['T2'] })
      expect(screen.getByText('🚫 차단')).toBeDefined() // optimistic overlay reflects blockage
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })
})
