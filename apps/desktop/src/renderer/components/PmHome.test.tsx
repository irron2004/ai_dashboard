import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { CH } from '../../shared/ipc-contract.js'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'

const dashboard: ProjectDashboardRes = {
  project: {
    id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', currentFocus: 'PM Home',
    startDate: '2026-06-01', targetDate: '2026-06-30', projectType: 'git', domain: 'project-docs', repoPaths: [], vaultPaths: [], sourcePaths: [],
  },
  activeTasks: [],
  reviewQueue: [
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] },
  ],
  recentRuns: [
    { id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' },
  ],
  allTasks: [
    { id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress', assigneeType: 'agent', priority: 'high', dueDate: '2026-06-15', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] },
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] },
  ],
}

describe('PmHome', () => {
  test('renders goal and current focus', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.getByText('PM Home')).toBeDefined()
    expect(screen.getByRole('progressbar', { name: '작업 완료율' }).getAttribute('aria-valuetext')).toBe('0/2개 완료')
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
    const runs = screen.getByText('최근 실행').closest('section') as HTMLElement
    expect(within(runs).getByText('do work')).toBeDefined()
    expect(within(runs).getByText('Codex')).toBeDefined()
    expect(within(runs).getByText('성공')).toBeDefined()
    expect(within(runs).queryByText(/R1/)).toBeNull()
    expect((within(runs).getByRole('button', { name: 'do work 실행 transcript 열기' }) as HTMLButtonElement).disabled).toBe(true)
    const time = runs.querySelector('time')
    expect(time?.dateTime).toBe('2026-06-01T10:00:00Z')
    expect(time?.title).toBeTruthy()
  })

  test('renders the 다음 할 일 widget with unblocked actionable tasks', () => {
    render(<PmHome dashboard={dashboard} />)
    const nextUp = screen.getByTestId('next-up')
    // T1 (in_progress) is actionable; T2 (review) is not listed here
    expect(within(nextUp).getByText('do work')).toBeDefined()
    expect(within(nextUp).queryByText('needs review')).toBeNull()
  })

  test('opens the shared editor from nextUp and refreshes only after a successful save', async () => {
    const updated = { ...dashboard.allTasks[0], title: 'edited work' }
    const invoke = vi.fn((channel: string) => Promise.resolve(
      channel === CH.taskUpdate ? { ok: true, task: updated } : { ok: true },
    ))
    const onChanged = vi.fn()
    ;(window as unknown as { apc: unknown }).apc = {
      invoke,
      onDevHarnessLog: () => () => {},
      onDevHarnessStarted: () => () => {},
    }
    try {
      render(<PmHome dashboard={dashboard} onChanged={onChanged} />)
      fireEvent.click(within(screen.getByTestId('next-up')).getByRole('button', { name: 'do work 편집' }))
      fireEvent.change(screen.getByLabelText('Task 제목'), { target: { value: 'edited work' } })
      fireEvent.click(screen.getByRole('button', { name: '저장' }))
      await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.taskUpdate, {
        projectId: 'p1', taskId: 'T1', title: 'edited work', status: 'in_progress', priority: 'high', dueDate: '2026-06-15',
      }))
      expect(onChanged).toHaveBeenCalled()
      expect(screen.queryByRole('dialog', { name: 'Task 편집' })).toBeNull()
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })

  test('opens a blank Task editor from the next-up heading', () => {
    render(<PmHome dashboard={dashboard} />)
    fireEvent.click(screen.getByRole('button', { name: '새 Task' }))
    expect(screen.getByRole('dialog', { name: '새 Task' })).toBeDefined()
    expect((screen.getByLabelText('Task 제목') as HTMLInputElement).value).toBe('')
  })

  test('composes the exact 다음 할 일 task without selecting it again', async () => {
    const invoke = vi.fn((channel: string) => Promise.resolve(
      channel === CH.composeContext ? { ok: true, prompt: 'context for do work' } : { ok: true },
    ))
    ;(window as unknown as { apc: unknown }).apc = {
      invoke,
      onDevHarnessLog: () => () => {},
      onDevHarnessStarted: () => () => {},
    }
    try {
      render(<PmHome dashboard={dashboard} />)
      fireEvent.click(within(screen.getByTestId('next-up')).getByRole('button', { name: 'do work 컨텍스트 조립' }))
      await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.composeContext, { projectId: 'p1', taskId: 'T1' }))
      expect(screen.getByRole('dialog', { name: '컨텍스트 패키지 — do work' })).toBeDefined()
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })

  test('starts the exact Task Board card without selecting it again', async () => {
    const invoke = vi.fn((channel: string) => Promise.resolve(
      channel === CH.devHarnessRun ? { ok: true, runId: 'RUN-T1' } : { ok: true },
    ))
    ;(window as unknown as { apc: unknown }).apc = {
      invoke,
      onDevHarnessLog: () => () => {},
      onDevHarnessStarted: () => () => {},
    }
    try {
      render(<PmHome dashboard={dashboard} />)
      const cardColumn = screen.getByTestId('col-in_progress')
      fireEvent.click(within(cardColumn).getByRole('button', { name: 'do work Harness 실행' }))
      await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.devHarnessRun, { projectId: 'p1', taskId: 'T1' }))
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })

  test('opens an available recent-run transcript from the human-readable row', async () => {
    const harnessDashboard: ProjectDashboardRes = {
      ...dashboard,
      recentRuns: [{
        id: 'RUN-H1', taskId: 'T1', agent: 'harness', repoPath: '/p1',
        startedAt: '2026-07-14T10:00:00Z', status: 'failed', transcriptPath: '/runs/RUN-H1/transcript.log',
      }],
    }
    const invoke = vi.fn((channel: string) => Promise.resolve(
      channel === CH.devHarnessReadTranscript ? { ok: true, content: 'failure details' } : { ok: true },
    ))
    ;(window as unknown as { apc: unknown }).apc = {
      invoke,
      onDevHarnessLog: () => () => {},
      onDevHarnessStarted: () => () => {},
    }
    try {
      render(<PmHome dashboard={harnessDashboard} />)
      expect(screen.getByText('Harness')).toBeDefined()
      expect(screen.getByText('실패')).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: 'do work 실행 transcript 열기' }))
      await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.devHarnessReadTranscript, { runId: 'RUN-H1' }))
      expect(screen.getByTestId('transcript-content').textContent).toContain('failure details')
      expect(screen.queryByText('RUN-H1')).toBeNull()
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })
  test('reverts the optimistic overlay when the bridge rejects the dependency', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: false, reason: 'cycle' }))
    ;(window as unknown as { apc: unknown }).apc = { invoke, onDevHarnessLog: () => () => {} }
    try {
      render(<PmHome dashboard={dashboard} />)
      fireEvent.click(screen.getByLabelText('의존성 편집 do work'))
      const select = screen.getByLabelText('차단 작업 선택 do work') as HTMLSelectElement
      ;(within(select).getByText('needs review') as HTMLOptionElement).selected = true
      fireEvent.change(select)
      await waitFor(() => {
        expect(screen.queryByText('🚫 차단')).toBeNull()
      })
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })

  test('editing a dependency persists via the bridge, marks the task blocked, and refreshes surfaces', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true }))
    const onChanged = vi.fn()
    ;(window as unknown as { apc: unknown }).apc = { invoke, onDevHarnessLog: () => () => {} }
    try {
      render(<PmHome dashboard={dashboard} onChanged={onChanged} />)
      fireEvent.click(screen.getByLabelText('의존성 편집 do work'))
      const select = screen.getByLabelText('차단 작업 선택 do work') as HTMLSelectElement
      ;(within(select).getByText('needs review') as HTMLOptionElement).selected = true
      fireEvent.change(select)
      expect(invoke).toHaveBeenCalledWith(CH.taskSetBlockedBy, { taskId: 'T1', blockedBy: ['T2'] })
      expect(screen.getByText('🚫 차단')).toBeDefined() // optimistic overlay reflects blockage
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    } finally {
      delete (window as unknown as { apc?: unknown }).apc
    }
  })
})
