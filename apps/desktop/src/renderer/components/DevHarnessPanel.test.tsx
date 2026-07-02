import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Task } from '@apc/shared'

const devHarnessRun = vi.fn()
const devHarnessCancel = vi.fn()
const composeContext = vi.fn()
const writePty = vi.fn()
const devHarnessReadTranscript = vi.fn()
type LogCb = (e: { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
type StartedCb = (e: { runId: string; taskId: string; projectId: string }) => void
let logCb: LogCb = () => {}
let startedCb: StartedCb = () => {}
vi.mock('../api.js', () => ({
  api: {
    devHarnessRun: (...a: unknown[]) => devHarnessRun(...a),
    devHarnessCancel: (...a: unknown[]) => devHarnessCancel(...a),
    composeContext: (...a: unknown[]) => composeContext(...a),
    devHarnessReadTranscript: (...a: unknown[]) => devHarnessReadTranscript(...a),
    writePty: (...a: unknown[]) => writePty(...a),
    onDevHarnessLog: (cb: LogCb) => { logCb = cb; return () => {} },
    onDevHarnessStarted: (cb: StartedCb) => { startedCb = cb; return () => {} },
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
  beforeEach(() => { vi.clearAllMocks(); logCb = () => {}; startedCb = () => {} })

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

  it('captures runId from the started ack so cancel works before any log arrives', async () => {
    let resolveRun!: (v: unknown) => void
    devHarnessRun.mockImplementation(() => new Promise((r) => { resolveRun = r }))
    devHarnessCancel.mockResolvedValue({ ok: true })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    fireEvent.click(runBtn())
    act(() => startedCb({ runId: 'RUN-START', taskId: 'T1', projectId: 'p1' }))
    fireEvent.click(cancelBtn())
    expect(devHarnessCancel).toHaveBeenCalledWith({ runId: 'RUN-START' })
    await act(async () => { resolveRun({ ok: false, runId: 'RUN-START', reason: 'cancelled' }) })
  })

  it('composes a prompt into the editable textarea', async () => {
    composeContext.mockResolvedValue({ ok: true, prompt: '# 작업: do work\n## 지시\n수행하라' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /컨텍스트 조립/ })) })
    expect(composeContext).toHaveBeenCalledWith({ projectId: 'p1', taskId: 'T1' })
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toContain('# 작업: do work')
  })

  it('injects the composed prompt into the selected agent pty without a trailing newline', async () => {
    composeContext.mockResolvedValue({ ok: true, prompt: 'PROMPT-BODY' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /컨텍스트 조립/ })) })
    fireEvent.change(screen.getByLabelText('주입 대상 에이전트'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: /터미널에 주입/ }))
    expect(writePty).toHaveBeenCalledWith({ id: 'p1:codex', data: 'PROMPT-BODY' })
  })
})
