import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@apc/shared'

const appMocks = vi.hoisted(() => ({
  restoreCallback: null as ((payload: {
    panes: Array<{ projectId: string; agent: 'claude' | 'opencode' | 'codex'; lastSessionId: string | null }>
    selectedProjectId: string | null
  }) => void) | null,
  listProjects: vi.fn(),
  workspaceOverview: vi.fn(),
  projectDashboard: vi.fn(),
  resumeCard: vi.fn(),
  conversationHistory: vi.fn(),
  paneOpened: vi.fn(),
  paneClosed: vi.fn(),
  persistSelectedProject: vi.fn(),
}))

vi.mock('./api.js', () => ({
  api: {
    listProjects: appMocks.listProjects,
    workspaceOverview: appMocks.workspaceOverview,
    projectDashboard: appMocks.projectDashboard,
    resumeCard: appMocks.resumeCard,
    conversationHistory: appMocks.conversationHistory,
    paneOpened: appMocks.paneOpened,
    paneClosed: appMocks.paneClosed,
    selectProject: appMocks.persistSelectedProject,
    onHarnessProgress: () => () => {},
    onHarnessEngineLog: () => () => {},
    onHarnessNodes: () => () => {},
    onWorkspaceRestore: (callback: NonNullable<typeof appMocks.restoreCallback>) => {
      appMocks.restoreCallback = callback
      return () => { appMocks.restoreCallback = null }
    },
  },
}))

vi.mock('./components/AgentTerminal.js', () => ({ AgentTerminal: () => null }))
vi.mock('./components/ProjectSidebar.js', () => ({
  ProjectSidebar: ({ onSelect }: { onSelect: (projectId: string) => void }) => (
    <button type="button" onClick={() => onSelect('p1')}>sidebar project</button>
  ),
}))
vi.mock('./components/MainPanel.js', () => ({
  MainPanel: ({
    tab, projectLoadState, onOpenProject, historyFocus,
  }: {
    tab: string
    projectLoadState: string
    onOpenProject: (projectId: string) => void
    historyFocus?: { agent: string } | null
  }) => (
    <div>
      <span data-testid="active-main-tab">{tab}</span>
      <span data-testid="project-load-state">{projectLoadState}</span>
      <span data-testid="history-focus-agent">{historyFocus?.agent ?? ''}</span>
      <button type="button" onClick={() => onOpenProject('p1')}>workspace project</button>
    </div>
  ),
}))

import { App, STATUS_COLOR } from './App.js'
import { useStore } from './store.js'

const project: Project = {
  id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs',
  repoPaths: ['/repo'], vaultPaths: [], sourcePaths: [],
}
const dashboard = { project, activeTasks: [], reviewQueue: [], recentRuns: [], allTasks: [] }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  appMocks.restoreCallback = null
  appMocks.listProjects.mockResolvedValue([project])
  appMocks.workspaceOverview.mockResolvedValue({ generatedAt: '', projects: [] })
  appMocks.projectDashboard.mockResolvedValue(dashboard)
  appMocks.resumeCard.mockResolvedValue(null)
  appMocks.conversationHistory.mockResolvedValue({
    projectId: 'p1', agent: 'claude', sessions: [], scannedSources: 0, skippedSources: 0, truncated: false,
  })
  useStore.setState({
    projects: [project],
    selectedProjectId: null,
    dashboard: null,
    workspaceOverview: null,
    resumeCard: null,
    resumeBannerOpen: false,
    openPanes: {},
    error: null,
  })
})

describe('agent dock status colors', () => {
  it('uses conventional status semantics and reserves red for errors', () => {
    expect(STATUS_COLOR).toEqual({
      idle: '#666',
      running: '#4ade80',
      attention: '#facc15',
      done: '#378add',
    })
    expect(Object.values(STATUS_COLOR)).not.toContain('#f87171')
  })
})

describe('App project navigation', () => {
  it('loads the restored project dashboard without leaving the default workspace', async () => {
    render(<App />)
    await waitFor(() => expect(appMocks.restoreCallback).not.toBeNull())

    act(() => {
      appMocks.restoreCallback?.({
        panes: [{ projectId: 'p1', agent: 'claude', lastSessionId: 'session-1' }],
        selectedProjectId: 'p1',
      })
    })

    await waitFor(() => expect(appMocks.projectDashboard).toHaveBeenCalledWith({ projectId: 'p1' }))
    await waitFor(() => expect(screen.getByTestId('project-load-state').textContent).toBe('ready'))
    expect(screen.getByTestId('active-main-tab').textContent).toBe('workspace')
  })

  it('enters project home when a project is selected from the workspace', async () => {
    render(<App />)
    expect(screen.getByTestId('active-main-tab').textContent).toBe('workspace')

    fireEvent.click(screen.getByRole('button', { name: 'sidebar project' }))

    expect(screen.getByTestId('active-main-tab').textContent).toBe('home')
    await waitFor(() => expect(appMocks.projectDashboard).toHaveBeenCalledWith({ projectId: 'p1' }))
  })

  it('uses the same workspace-to-home rule for the project keyboard shortcut', async () => {
    render(<App />)
    fireEvent.keyDown(window, { code: 'Digit1', key: '1', ctrlKey: true })

    expect(screen.getByTestId('active-main-tab').textContent).toBe('home')
    await waitFor(() => expect(appMocks.projectDashboard).toHaveBeenCalledWith({ projectId: 'p1' }))
  })

  it('preserves a project-specific tab when switching projects there', async () => {
    localStorage.setItem('apc:mainTab', 'knowledge')
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'sidebar project' }))

    expect(screen.getByTestId('active-main-tab').textContent).toBe('knowledge')
    await waitFor(() => expect(appMocks.projectDashboard).toHaveBeenCalledWith({ projectId: 'p1' }))
  })

  it('restores the history tab from localStorage', () => {
    appMocks.listProjects.mockReturnValue(new Promise(() => {}))
    localStorage.setItem('apc:mainTab', 'history')

    render(<App />)

    expect(screen.getByTestId('active-main-tab').textContent).toBe('history')
  })

  it('opens the history tab with the resume card agent focus', () => {
    appMocks.listProjects.mockReturnValue(new Promise(() => {}))
    appMocks.workspaceOverview.mockReturnValue(new Promise(() => {}))
    appMocks.resumeCard.mockReturnValue(new Promise(() => {}))
    useStore.setState({
      selectedProjectId: 'p1',
      dashboard,
      resumeBannerOpen: true,
      resumeCard: {
        project,
        lastSummary: null,
        lastQuestion: { text: '이 질문을 이어서 봐 줘', ts: '2026-07-15T10:00:00Z', agent: 'claude' },
        nextNotes: [],
        resumeTarget: { agent: 'codex', sessionId: 'session-1' },
        hasHistory: true,
      },
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '질문 히스토리' }))

    expect(screen.getByTestId('active-main-tab').textContent).toBe('history')
    expect(screen.getByTestId('history-focus-agent').textContent).toBe('claude')
    expect(screen.queryByRole('dialog', { name: /이어서/ })).toBeNull()
  })
})
