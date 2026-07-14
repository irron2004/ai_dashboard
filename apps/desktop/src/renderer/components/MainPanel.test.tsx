import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'

vi.mock('./HomeView.js', () => ({
  HomeView: () => <div>PM dashboard</div>,
  ProjectDocumentsView: () => <div>Project documents</div>,
}))
vi.mock('./KnowledgeView.js', () => ({ KnowledgeView: () => <div>Knowledge view</div> }))
vi.mock('./WikiGenDashboard.js', () => ({ WikiGenDashboard: () => <div>Wiki generation</div> }))
vi.mock('./WorkspaceHome.js', () => ({ WorkspaceHome: () => <div>Workspace overview</div> }))

import { MainPanel, type MainTab, type ProjectLoadState } from './MainPanel.js'

const dashboard: ProjectDashboardRes = {
  project: {
    id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs',
    repoPaths: ['/repo'], vaultPaths: [], sourcePaths: [],
  },
  activeTasks: [], reviewQueue: [], recentRuns: [], allTasks: [],
}

function renderPanel({
  tab = 'home',
  onTab = vi.fn(),
  projectDashboard = dashboard,
  projectLoadState = 'ready',
  wikiGenRunning = false,
}: {
  tab?: MainTab
  onTab?: (tab: MainTab) => void
  projectDashboard?: ProjectDashboardRes | null
  projectLoadState?: ProjectLoadState
  wikiGenRunning?: boolean
} = {}) {
  return render(
    <MainPanel
      tab={tab}
      onTab={onTab}
      dashboard={projectDashboard}
      projectLoadState={projectLoadState}
      wikiGenRunning={wikiGenRunning}
    />,
  )
}

describe('MainPanel information architecture', () => {
  test('orders the global overview first and keeps project documents separate from PM home', () => {
    renderPanel({ tab: 'documents' })

    const tablist = screen.getByRole('tablist', { name: '주 화면 탭' })
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '🌐 전체', '🏠 홈', '📄 문서', '📖 지식', '⚙ 위키 생성',
    ])
    expect(screen.getByText('Project documents')).toBeDefined()
    expect(screen.queryByText('PM dashboard')).toBeNull()
  })

  test.each([
    ['home', 'PM dashboard'],
    ['documents', 'Project documents'],
    ['knowledge', 'Knowledge view'],
    ['wikigen', 'Wiki generation'],
    ['workspace', 'Workspace overview'],
  ] as const)('renders the %s view', (tab, expected) => {
    renderPanel({ tab })
    expect(screen.getByText(expected)).toBeDefined()
  })

  test('exposes the selected tab and its controlled panel and handles clicks', () => {
    const onTab = vi.fn()
    renderPanel({ tab: 'home', onTab })

    const home = screen.getByRole('tab', { name: '홈' })
    const documents = screen.getByRole('tab', { name: '문서' })
    expect(home.getAttribute('aria-selected')).toBe('true')
    expect(home.tabIndex).toBe(0)
    expect(documents.getAttribute('aria-selected')).toBe('false')
    expect(documents.tabIndex).toBe(-1)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(home.id)

    fireEvent.click(documents)
    expect(onTab).toHaveBeenCalledWith('documents')
  })

  test('supports ArrowLeft/ArrowRight and Home/End tab keyboard navigation', () => {
    const onTab = vi.fn()
    renderPanel({ tab: 'home', onTab })
    const home = screen.getByRole('tab', { name: '홈' })

    fireEvent.keyDown(home, { key: 'ArrowRight' })
    expect(onTab).toHaveBeenLastCalledWith('documents')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '문서' }))

    fireEvent.keyDown(home, { key: 'ArrowLeft' })
    expect(onTab).toHaveBeenLastCalledWith('workspace')
    fireEvent.keyDown(home, { key: 'Home' })
    expect(onTab).toHaveBeenLastCalledWith('workspace')
    fireEvent.keyDown(home, { key: 'End' })
    expect(onTab).toHaveBeenLastCalledWith('wikigen')
  })

  test('distinguishes an unselected project from a loading project', () => {
    const { rerender } = render(
      <MainPanel tab="home" onTab={() => {}} dashboard={null} projectLoadState="unselected" />,
    )
    expect(screen.getByRole('status').textContent).toContain('프로젝트를 선택')
    expect(screen.queryByText('PM dashboard')).toBeNull()

    rerender(<MainPanel tab="home" onTab={() => {}} dashboard={null} projectLoadState="loading" />)
    expect(screen.getByRole('status').textContent).toBe('프로젝트를 불러오는 중…')
  })

  test('renders the global overview without a selected project or dashboard', () => {
    renderPanel({ tab: 'workspace', projectDashboard: null, projectLoadState: 'unselected' })
    expect(screen.getByText('Workspace overview')).toBeDefined()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('announces an active wiki generation run in the tab name', () => {
    renderPanel({ wikiGenRunning: true })
    expect(screen.getByRole('tab', { name: '위키 생성 (실행 중)' })).toBeDefined()
    expect(screen.getByTestId('wikigen-running-dot')).toBeDefined()
  })
})
