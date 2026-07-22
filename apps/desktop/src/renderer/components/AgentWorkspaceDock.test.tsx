import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentActivity, Project } from '@apc/shared'

const mocks = vi.hoisted(() => ({
  gitWorktrees: vi.fn(),
  paneOpened: vi.fn(),
  paneClosed: vi.fn(),
}))

vi.mock('../api.js', () => ({
  api: {
    gitWorktrees: mocks.gitWorktrees,
    paneOpened: mocks.paneOpened,
    paneClosed: mocks.paneClosed,
    killPty: vi.fn(),
  },
}))

vi.mock('./AgentTerminal.js', () => ({
  AgentTerminal: ({ sessionId, cwd, agent }: { sessionId: string; cwd: string; agent: string }) => (
    <div className="agent-terminal-stub" data-session-id={sessionId} data-cwd={cwd} data-agent={agent} />
  ),
}))

import {
  AgentWorkspaceDock, agentTerminalKey, agentWorkspaceKey, nextAgentSlot, paneIdentityForSlot, readAgentSlots,
} from './AgentWorkspaceDock.js'
import { useStore } from '../store.js'

const project: Project = {
  id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs',
  repoPaths: ['C:\\work\\apc'], vaultPaths: [], sourcePaths: [],
}

const worktrees = [
  { path: 'C:\\work\\apc', branch: 'main', head: 'aaaaaaa', detached: false, isMain: true },
  { path: 'C:\\work\\apc-auth', branch: 'feat/auth', head: 'bbbbbbb', detached: false, isMain: false },
]

function renderDock(activities: readonly AgentActivity[] = []) {
  return render(
    <AgentWorkspaceDock
      projects={[project]}
      selectedProjectId="p1"
      openedProjectIds={['p1']}
      collapsed={false}
      activities={activities}
      onToggleCollapsed={vi.fn()}
      onActiveAgentChange={vi.fn()}
    />,
  )
}

function activity(worktreePath: string, question: string, revision = 1): AgentActivity {
  return {
    pane: {
      paneId: `${worktreePath}:codex-1`, projectId: 'p1', worktreePath, slotId: 'codex-1', agent: 'codex',
    },
    launchId: `launch-${revision}`,
    connection: 'connected', phase: 'working', processAlive: true,
    lastActivityAt: '2026-07-20T10:00:00Z',
    lastQuestion: { displayText: question, askedAt: '2026-07-20T10:00:00Z', privacy: 'visible', source: 'pty' },
    revision,
  }
}

function seedSlots(path: string): void {
  const hash = agentWorkspaceKey('p1', path).split(':').at(-1)
  localStorage.setItem(`apc:agent-slots:p1:${hash}`, JSON.stringify({
    path,
    slots: [{ id: 'codex-1', agent: 'codex' }],
  }))
}

function workspaceFor(container: HTMLElement, path: string): HTMLElement | null {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-worktree-path]'))
    .find((element) => element.dataset.worktreePath === path) ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.gitWorktrees.mockResolvedValue({ ok: true, worktrees })
  useStore.setState({
    selectedProjectId: 'p1', agentStatus: {}, openPanes: {}, restartNonce: {}, stoppingKeys: {},
    activeWorktrees: {}, paneTarget: null,
  })
})

describe('AgentWorkspaceDock', () => {
  test('shows Git worktrees as tabs and starts every unconfigured worktree empty', async () => {
    const { container } = renderDock()

    await screen.findByRole('tab', { name: /main/ })
    expect(mocks.gitWorktrees).toHaveBeenCalledWith({ projectId: 'p1' })
    const mainWorkspace = workspaceFor(container, 'C:\\work\\apc') as HTMLElement
    expect(mainWorkspace).not.toBeNull()
    expect(mainWorkspace.querySelectorAll('.agent-terminal-stub')).toHaveLength(0)
    expect(within(mainWorkspace).getByText('이 worktree에는 아직 에이전트가 없습니다.')).toBeDefined()

    fireEvent.click(screen.getByRole('tab', { name: 'feat/auth' }))

    await waitFor(() => {
      const featureWorkspace = workspaceFor(container, 'C:\\work\\apc-auth') as HTMLElement
      expect(featureWorkspace).not.toBeNull()
      expect(featureWorkspace.querySelectorAll('.agent-terminal-stub')).toHaveLength(0)
    })
    const featureWorkspace = workspaceFor(container, 'C:\\work\\apc-auth') as HTMLElement
    expect(mainWorkspace.style.display).toBe('none')
    expect(featureWorkspace.style.display).toBe('flex')
  })

  test('adds duplicate agent kinds with + and lets the user remove a slot', async () => {
    const { container } = renderDock()
    await screen.findByRole('tab', { name: /main/ })

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    const menu = screen.getByRole('menu', { name: '추가할 에이전트 선택' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Codex/ }))

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Codex/ }))

    const workspace = workspaceFor(container, 'C:\\work\\apc') as HTMLElement
    await waitFor(() => expect(workspace.querySelectorAll('[data-agent="codex"]')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Codex 2 에이전트 제거' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Codex 2 에이전트 제거' }))
    await waitFor(() => expect(workspace.querySelectorAll('[data-agent="codex"]')).toHaveLength(1))
  })

  test('reports the exact worktree and slot identity when a pane opens and closes', async () => {
    renderDock()
    await screen.findByRole('tab', { name: /main/ })

    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Claude/ }))
    const pane = paneIdentityForSlot('p1', 'C:\\work\\apc', { id: 'claude-1', agent: 'claude' })
    expect(mocks.paneOpened).toHaveBeenCalledWith(pane)

    fireEvent.click(screen.getByRole('button', { name: 'Claude 에이전트 제거' }))

    expect(mocks.paneClosed).toHaveBeenCalledWith(pane)
  })

  test('persists the configured slots independently for each worktree', async () => {
    const first = renderDock()
    await screen.findByRole('tab', { name: /main/ })
    fireEvent.click(screen.getByRole('tab', { name: 'feat/auth' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'feat/auth' }).getAttribute('aria-selected')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: '에이전트 추가' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Claude/ }))
    await screen.findByRole('button', { name: 'Claude 에이전트 제거' })
    first.unmount()

    const second = renderDock()
    await waitFor(() => {
      const workspace = workspaceFor(second.container, 'C:\\work\\apc-auth') as HTMLElement
      expect(workspace?.querySelectorAll('[data-agent="claude"]')).toHaveLength(1)
    })
    expect(screen.getByRole('tab', { name: 'feat/auth' }).getAttribute('aria-selected')).toBe('true')
  })

  test('does not mix recent questions for the same agent across worktrees and slots', async () => {
    seedSlots('C:\\work\\apc')
    seedSlots('C:\\work\\apc-auth')
    const { container } = renderDock([
      activity('C:\\work\\apc', 'main 질문', 2),
      activity('C:\\work\\apc-auth', 'auth 질문', 3),
    ])

    await screen.findByRole('tab', { name: /main/ })
    const mainWorkspace = workspaceFor(container, 'C:\\work\\apc') as HTMLElement
    expect(within(mainWorkspace).getByText('[main 질문]')).toBeDefined()
    expect(within(mainWorkspace).queryByText('[auth 질문]')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'feat/auth' }))
    await waitFor(() => {
      const authWorkspace = workspaceFor(container, 'C:\\work\\apc-auth') as HTMLElement
      expect(within(authWorkspace).getByText('[auth 질문]')).toBeDefined()
      expect(within(authWorkspace).queryByText('[main 질문]')).toBeNull()
    })
  })

  test('consumes an exact pane target by selecting its worktree and slot', async () => {
    seedSlots('C:\\work\\apc-auth')
    const { container } = renderDock()
    await screen.findByRole('tab', { name: /main/ })
    const target = paneIdentityForSlot('p1', 'C:\\work\\apc-auth', { id: 'codex-2', agent: 'codex' })

    act(() => useStore.getState().focusAgentPane(target))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'feat/auth' }).getAttribute('aria-selected')).toBe('true'))
    await waitFor(() => {
      const featureWorkspace = workspaceFor(container, 'C:\\work\\apc-auth') as HTMLElement
      expect(featureWorkspace.querySelector(`[data-session-id="${agentTerminalKey('p1', 'C:\\work\\apc-auth', 'codex-2')}"]`)).not.toBeNull()
    })
    expect(mocks.paneOpened).toHaveBeenCalledWith(target)
    expect(useStore.getState().paneTarget).toBeNull()
    expect(useStore.getState().activeWorktrees.p1).toBe('C:\\work\\apc-auth')
  })
})

describe('agent slot persistence helpers', () => {
  test('defaults to empty, keeps it empty, and allocates duplicate ids monotonically', () => {
    expect(readAgentSlots('p1', 'C:\\work\\new')).toEqual([])
    const key = `apc:agent-slots:p1:${agentWorkspaceKey('p1', 'C:\\work\\apc').split(':').at(-1)}`
    localStorage.setItem(key, JSON.stringify({ path: 'C:\\work\\apc', slots: [] }))
    expect(readAgentSlots('p1', 'C:\\work\\apc')).toEqual([])
    expect(nextAgentSlot([{ id: 'codex-1', agent: 'codex' }, { id: 'codex-2', agent: 'codex' }], 'codex'))
      .toEqual({ id: 'codex-3', agent: 'codex' })
  })
})
