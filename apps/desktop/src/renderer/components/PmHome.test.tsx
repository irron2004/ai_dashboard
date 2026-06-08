import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'

const dashboard: ProjectDashboardRes = {
  project: {
    id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', currentFocus: 'PM Home',
    startDate: '2026-06-01', targetDate: '2026-06-30', projectType: 'git', repoPaths: [], vaultPaths: [], sourcePaths: [],
  },
  activeTasks: [],
  reviewQueue: [
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [] },
  ],
  recentRuns: [
    { id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' },
  ],
  allTasks: [
    { id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress', assigneeType: 'agent', priority: 'high', dueDate: '2026-06-15', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [] },
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [] },
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
})
