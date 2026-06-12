import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { MainPanel } from './MainPanel.js'

vi.mock('./HomeView.js', () => ({ HomeView: () => <div>HOME-STUB</div> }))
vi.mock('./KnowledgeView.js', () => ({ KnowledgeView: () => <div>KNOWLEDGE-STUB</div> }))

vi.mock('./WikiGenDashboard.js', () => ({
  WikiGenDashboard: () => <div>WIKIGEN-STUB</div>,
}))

const dashboard: ProjectDashboardRes = {
  project: { id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', projectType: 'git', repoPaths: [], vaultPaths: [], sourcePaths: [] },
  activeTasks: [], reviewQueue: [], recentRuns: [], allTasks: [],
}

describe('MainPanel', () => {
  test('shows three tabs: Home / Knowledge / Wiki Gen', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} />)
    expect(screen.getByRole('button', { name: /Home/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Knowledge/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Wiki Gen/ })).toBeDefined()
  })

  test('home tab renders HomeView content', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} />)
    expect(screen.getByText('HOME-STUB')).toBeDefined()
    expect(screen.queryByText('HARNESS-STUB')).toBeNull()
  })

  test('knowledge tab renders KnowledgeView', () => {
    render(<MainPanel tab="knowledge" onTab={vi.fn()} dashboard={dashboard} />)
    expect(screen.getByText('KNOWLEDGE-STUB')).toBeDefined()
    expect(screen.queryByText('ship MVP')).toBeNull()
  })

  test('wikigen tab renders WikiGenDashboard', () => {
    render(<MainPanel tab="wikigen" onTab={vi.fn()} dashboard={dashboard} />)
    expect(screen.getByText('WIKIGEN-STUB')).toBeDefined()
  })

  test('fires onTab with the new tab id', () => {
    const onTab = vi.fn()
    render(<MainPanel tab="home" onTab={onTab} dashboard={dashboard} />)
    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))
    expect(onTab).toHaveBeenCalledWith('knowledge')
  })

  test('wiki gen tab shows running badge when wikiGenRunning', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} wikiGenRunning />)
    expect(screen.getByTestId('wikigen-running-dot')).toBeDefined()
  })
})
