import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  workspaceOverview: vi.fn(),
}))

vi.mock('./api.js', () => ({
  api: {
    listProjects: mocks.listProjects,
    workspaceOverview: mocks.workspaceOverview,
    onHarnessProgress: () => () => {},
    onHarnessEngineLog: () => () => {},
    onHarnessNodes: () => () => {},
    onWorkspaceRestore: () => () => {},
    selectProject: vi.fn(),
    paneOpened: vi.fn(),
    paneClosed: vi.fn(),
  },
}))

vi.mock('./components/AgentTerminal.js', () => ({ AgentTerminal: () => null }))
vi.mock('./components/ProjectSidebar.js', () => ({ ProjectSidebar: () => null }))
vi.mock('./components/MainPanel.js', () => ({
  MainPanel: ({ actions }: { actions?: ReactNode }) => <main>{actions}</main>,
}))
vi.mock('./components/DiffPanel.js', () => ({
  DiffPanel: ({ open }: { open: boolean }) => open ? <aside role="dialog" aria-label="변경사항" /> : null,
}))

import { App } from './App.js'
import { useStore } from './store.js'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // These requests are unrelated to this interaction test. Keeping them pending avoids
  // post-assertion store updates leaking between mounted App instances.
  mocks.listProjects.mockReturnValue(new Promise(() => {}))
  mocks.workspaceOverview.mockReturnValue(new Promise(() => {}))
  useStore.setState({
    projects: [],
    selectedProjectId: null,
    dashboard: null,
    workspaceOverview: null,
    resumeCard: null,
    resumeBannerOpen: false,
    openPanes: {},
    error: null,
  })
})

describe('App Diff 패널 배선', () => {
  test('Ctrl+Shift+D로 패널을 토글한다', () => {
    render(<App />)
    fireEvent.keyDown(window, { code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('dialog', { name: '변경사항' })).toBeDefined()

    fireEvent.keyDown(window, { code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true })
    expect(screen.queryByRole('dialog', { name: '변경사항' })).toBeNull()
  })

  test('툴바 ± 버튼으로 패널을 연다', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '변경사항 (Ctrl+Shift+D)' }))
    expect(screen.getByRole('dialog', { name: '변경사항' })).toBeDefined()
  })
})
