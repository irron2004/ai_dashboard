import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { MainPanel } from './MainPanel.js'

vi.mock('./HarnessDashboard.js', () => ({
  HarnessDashboard: () => <div>HARNESS-STUB</div>,
}))

const dashboard: ProjectDashboardRes = {
  project: { id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', projectType: 'git', repoPaths: [], vaultPaths: [], sourcePaths: [] },
  activeTasks: [], reviewQueue: [], recentRuns: [], allTasks: [],
}

describe('MainPanel', () => {
  test('shows three tabs: Home / Knowledge / Wiki Gen', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Home/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Knowledge/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Wiki Gen/ })).toBeDefined()
  })

  test('home tab renders PmHome content', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.queryByText('HARNESS-STUB')).toBeNull()
  })

  test('knowledge tab renders HarnessDashboard (temporary until Phase 3)', () => {
    render(<MainPanel tab="knowledge" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('HARNESS-STUB')).toBeDefined()
    expect(screen.queryByText('ship MVP')).toBeNull()
  })

  test('wikigen tab renders placeholder (until Phase 2)', () => {
    render(<MainPanel tab="wikigen" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText(/Phase 2/)).toBeDefined()
  })

  test('fires onTab with the new tab id', () => {
    const onTab = vi.fn()
    render(<MainPanel tab="home" onTab={onTab} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))
    expect(onTab).toHaveBeenCalledWith('knowledge')
  })

  test('wiki gen tab shows running badge when wikiGenRunning', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} wikiGenRunning />)
    expect(screen.getByTestId('wikigen-running-dot')).toBeDefined()
  })
})
