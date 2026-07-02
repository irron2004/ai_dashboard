import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Task } from '@apc/shared'

const devHarnessRun = vi.fn()
const devHarnessCancel = vi.fn()
type LogCb = (e: { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
let logCb: LogCb = () => {}
vi.mock('../api.js', () => ({
  api: {
    devHarnessRun: (...a: unknown[]) => devHarnessRun(...a),
    devHarnessCancel: (...a: unknown[]) => devHarnessCancel(...a),
    onDevHarnessLog: (cb: LogCb) => { logCb = cb; return () => {} },
  },
}))
import { DevHarnessPanel } from './DevHarnessPanel.js'

const task = (id: string, title: string): Task => ({
  id, projectId: 'p1', title, status: 'todo', assigneeType: 'agent', priority: 'medium',
  reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [],
})
const runBtn = () => screen.getByRole('button', { name: /run harness/i }) as HTMLButtonElement
const cancelBtn = () => screen.getByRole('button', { name: /cancel/i }) as HTMLButtonElement

describe('DevHarnessPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); logCb = () => {} })

  it('runs the harness for the selected task', async () => {
    devHarnessRun.mockResolvedValue({ ok: true, runId: 'R1' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(runBtn()) })
    expect(devHarnessRun).toHaveBeenCalledWith({ projectId: 'p1', taskId: 'T1' })
  })

  it('appends streamed log chunks to the log view', async () => {
    devHarnessRun.mockResolvedValue({ ok: true, runId: 'R1' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(runBtn()) })
    act(() => logCb({ runId: 'R1', label: 'harness', stream: 'stdout', chunk: 'building…' }))
    expect(screen.getByTestId('dev-harness-log').textContent).toContain('building…')
  })

  it('cancel sends the captured runId while running', async () => {
    let resolveRun!: (v: unknown) => void
    devHarnessRun.mockImplementation(() => new Promise((r) => { resolveRun = r }))
    devHarnessCancel.mockResolvedValue({ ok: true })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    fireEvent.click(runBtn())
    act(() => logCb({ runId: 'R1', label: 'harness', stream: 'stdout', chunk: 'x' }))
    fireEvent.click(cancelBtn())
    expect(devHarnessCancel).toHaveBeenCalledWith({ runId: 'R1' })
    await act(async () => { resolveRun({ ok: false, runId: 'R1', reason: 'cancelled' }) })
  })

  it('disables run when there are no tasks', () => {
    render(<DevHarnessPanel projectId="p1" tasks={[]} />)
    expect(runBtn().disabled).toBe(true)
  })
})
