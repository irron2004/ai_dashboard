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
  test('shows PmHome when tab is pm', () => {
    render(<MainPanel tab="pm" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.queryByText('HARNESS-STUB')).toBeNull()
  })

  test('shows HarnessDashboard when tab is harness', () => {
    render(<MainPanel tab="harness" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('HARNESS-STUB')).toBeDefined()
    expect(screen.queryByText('ship MVP')).toBeNull()
  })

  test('fires onTab when a tab button is clicked', () => {
    const onTab = vi.fn()
    render(<MainPanel tab="pm" onTab={onTab} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge Harness' }))
    expect(onTab).toHaveBeenCalledWith('harness')
  })
})
