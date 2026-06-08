import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { PmHome } from './PmHome.js'

const dashboard = {
  project: { id: 'p1', name: 'APC', status: 'active' as const, goal: 'ship MVP', projectType: 'git' as const, repoPaths: [], vaultPaths: [], sourcePaths: [] },
  activeTasks: [{ id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress' as const, assigneeType: 'agent' as const, priority: 'high' as const, reviewStatus: 'none' as const, acceptanceCriteria: [], linkedWikiPages: [] }],
  reviewQueue: [{ id: 'T2', projectId: 'p1', title: 'needs review', status: 'review' as const, assigneeType: 'agent' as const, priority: 'medium' as const, reviewStatus: 'pending' as const, acceptanceCriteria: [], linkedWikiPages: [] }],
  recentRuns: [{ id: 'R1', taskId: 'T1', agent: 'codex' as const, repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' as const }],
  allTasks: [
    { id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress' as const, assigneeType: 'agent' as const, priority: 'high' as const, reviewStatus: 'none' as const, acceptanceCriteria: [], linkedWikiPages: [] },
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review' as const, assigneeType: 'agent' as const, priority: 'medium' as const, reviewStatus: 'pending' as const, acceptanceCriteria: [], linkedWikiPages: [] },
  ],
}

describe('PmHome', () => {
  test('renders goal, active tasks, review queue, recent runs', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.getByText('do work')).toBeDefined()
    expect(screen.getByText('needs review')).toBeDefined()
    expect(screen.getByText(/R1/)).toBeDefined()
  })
})
