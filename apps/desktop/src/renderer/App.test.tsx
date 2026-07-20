import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivity, Project, ResolvedFileReference } from '@apc/shared'

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
  agentActivitySnapshot: vi.fn(),
  activityCallback: null as ((activity: AgentActivity) => void) | null,
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
    agentActivitySnapshot: appMocks.agentActivitySnapshot,
    paneOpened: appMocks.paneOpened,
    paneClosed: appMocks.paneClosed,
    selectProject: appMocks.persistSelectedProject,
    onHarnessProgress: () => () => {},
    onHarnessEngineLog: () => () => {},
    onHarnessNodes: () => () => {},
    onAgentActivity: (callback: (activity: AgentActivity) => void) => {
      appMocks.activityCallback = callback
      return () => {
        if (appMocks.activityCallback === callback) appMocks.activityCallback = null
      }
    },
    onWorkspaceRestore: (callback: NonNullable<typeof appMocks.restoreCallback>) => {
      appMocks.restoreCallback = callback
      return () => { appMocks.restoreCallback = null }
    },
  },
}))

vi.mock('./components/AgentTerminal.js', () => ({ AgentTerminal: () => null }))
vi.mock('./components/ProjectNotesDrawer.js', () => ({
  ProjectNotesDrawer: ({ projectId }: { projectId: string }) => (
    <div role="dialog" aria-label="프로젝트 메모">notes:{projectId}</div>
  ),
}))
vi.mock('./components/FilePreviewPanel.js', () => ({
  FilePreviewPanel: ({ reference }: { reference: ResolvedFileReference | null }) => (
    reference ? <aside aria-label="파일 미리보기">{reference.displayPath}</aside> : null
  ),
}))
vi.mock('./components/ProjectSidebar.js', () => ({
  ProjectSidebar: ({ onSelect }: { onSelect: (projectId: string) => void }) => (
    <button type="button" onClick={() => onSelect('p1')}>sidebar project</button>
  ),
}))
vi.mock('./components/MainPanel.js', () => ({
  MainPanel: ({
    tab, projectLoadState, onOpenProject, historyFocus, onOpenFileReference, onOpenActivityQuestion,
  }: {
    tab: string
    projectLoadState: string
    onOpenProject: (projectId: string) => void
    historyFocus?: { agent: string; sessionId?: string } | null
    onOpenFileReference?: (reference: ResolvedFileReference) => void
    onOpenActivityQuestion?: (activity: AgentActivity) => void
  }) => (
    <div>
      <span data-testid="active-main-tab">{tab}</span>
      <span data-testid="project-load-state">{projectLoadState}</span>
      <span data-testid="history-focus-agent">{historyFocus?.agent ?? ''}</span>
      <span data-testid="history-focus-session">{historyFocus?.sessionId ?? ''}</span>
      <button type="button" onClick={() => onOpenProject('p1')}>workspace project</button>
      <button
        type="button"
        onClick={() => onOpenFileReference?.({
          raw: 'docs/spec.md', path: 'docs/spec.md', form: 'bare', start: 0, end: 12,
          projectId: 'p1', token: 'preview-token', canonicalPath: '/repo/docs/spec.md',
          displayPath: 'docs/spec.md', kind: 'markdown', workspaceRoot: '/repo', size: 42,
        })}
      >open file preview</button>
      <button
        type="button"
        onClick={() => onOpenActivityQuestion?.({
          pane: {
            paneId: 'p1:main:claude-1', projectId: 'p1', worktreePath: '/repo', slotId: 'claude-1', agent: 'claude',
          },
          launchId: 'launch-transcript', connection: 'connected', phase: 'awaiting_user', processAlive: false,
          lastActivityAt: '2026-07-20T10:00:00Z', revision: 2,
          lastQuestion: {
            displayText: '히스토리 질문', askedAt: '2026-07-20T10:00:00Z', privacy: 'visible',
            source: 'transcript', sessionId: 'session-question', exchangeId: 'exchange-1',
          },
        })}
      >open transcript question</button>
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
  appMocks.activityCallback = null
  appMocks.listProjects.mockResolvedValue([project])
  appMocks.workspaceOverview.mockResolvedValue({ generatedAt: '', projects: [] })
  appMocks.projectDashboard.mockResolvedValue(dashboard)
  appMocks.resumeCard.mockResolvedValue(null)
  appMocks.agentActivitySnapshot.mockResolvedValue({ activities: [], asOf: '2026-07-20T00:00:00Z' })
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
    activities: [],
    activitySnapshotAsOf: null,
    activityLoadGeneration: 0,
    activeWorktrees: {},
    paneTarget: null,
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

  it('restores the daily retro tab from localStorage', () => {
    appMocks.listProjects.mockReturnValue(new Promise(() => {}))
    localStorage.setItem('apc:mainTab', 'retro')

    render(<App />)

    expect(screen.getByTestId('active-main-tab').textContent).toBe('retro')
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

  it('opens project notes from Ctrl/Cmd+Shift+N only when a project is selected', () => {
    useStore.setState({ selectedProjectId: 'p1', dashboard })
    render(<App />)

    fireEvent.keyDown(window, { code: 'KeyN', key: 'N', ctrlKey: true, shiftKey: true })

    expect(screen.getByRole('dialog', { name: '프로젝트 메모' }).textContent).toContain('p1')
  })

  it('mounts the right-side preview selected by the conversation surface', () => {
    useStore.setState({ selectedProjectId: 'p1', dashboard })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'open file preview' }))

    expect(screen.getByRole('complementary', { name: '파일 미리보기' }).textContent).toBe('docs/spec.md')
  })

  it('routes a transcript-backed recent question to the exact history session', () => {
    useStore.setState({ selectedProjectId: 'p1', dashboard })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'open transcript question' }))

    expect(screen.getByTestId('active-main-tab').textContent).toBe('history')
    expect(screen.getByTestId('history-focus-agent').textContent).toBe('claude')
    expect(screen.getByTestId('history-focus-session').textContent).toBe('session-question')
  })
})
