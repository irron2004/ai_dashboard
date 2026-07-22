import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
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
const runBtn = () => screen.getByRole('button', { name: /harness 실행/i }) as HTMLButtonElement
const cancelBtn = () => screen.getByRole('button', { name: /중단/i }) as HTMLButtonElement

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
    expect(screen.getByRole('dialog', { name: '컨텍스트 패키지 — do work' })).toBeDefined()
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toContain('# 작업: do work')
  })

  it('injects the composed prompt into the selected agent pty without a trailing newline', async () => {
    composeContext.mockResolvedValue({ ok: true, prompt: 'PROMPT-BODY' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /컨텍스트 조립/ })) })
    fireEvent.change(screen.getByLabelText('주입 대상 에이전트'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: /터미널에 주입/ }))
    expect(writePty).toHaveBeenCalledWith({ id: 'p1:codex', data: 'PROMPT-BODY' })
    expect((writePty.mock.calls[0]?.[0] as { data: string }).data.endsWith('\n')).toBe(false)
    expect(screen.getByText(/자동 전송하지 않습니다/)).toBeDefined()
  })

  it('honours a compose request for a specific task without using the current selection', async () => {
    composeContext.mockResolvedValue({ ok: true, prompt: 'context for T2' })
    render(
      <DevHarnessPanel
        projectId="p1"
        tasks={[task('T1', 'first'), task('T2', 'selected from card')]}
        request={{ requestId: 1, projectId: 'p1', action: 'compose', taskId: 'T2' }}
      />,
    )

    await waitFor(() => expect(composeContext).toHaveBeenCalledWith({ projectId: 'p1', taskId: 'T2' }))
    expect((screen.getByLabelText('실행할 작업') as HTMLSelectElement).value).toBe('T2')
    expect(screen.getByRole('dialog', { name: '컨텍스트 패키지 — selected from card' })).toBeDefined()
    expect((screen.getByLabelText('조립된 컨텍스트 검토') as HTMLTextAreaElement).value).toBe('context for T2')
  })

  it('honours a Run request for a specific task only once', async () => {
    devHarnessRun.mockResolvedValue({ ok: true, runId: 'RUN-T2' })
    const tasks = [task('T1', 'first'), task('T2', 'from board')]
    const request = { requestId: 2, projectId: 'p1', action: 'run' as const, taskId: 'T2' }
    const { rerender } = render(<DevHarnessPanel projectId="p1" tasks={tasks} request={request} />)

    await waitFor(() => expect(devHarnessRun).toHaveBeenCalledWith({ projectId: 'p1', taskId: 'T2' }))
    rerender(<DevHarnessPanel projectId="p1" tasks={tasks} request={request} />)
    expect(devHarnessRun).toHaveBeenCalledTimes(1)
  })

  it('opens a transcript modal from an external recent-run request', async () => {
    devHarnessReadTranscript.mockResolvedValue({ ok: true, content: 'transcript body here' })
    render(
      <DevHarnessPanel
        projectId="p1"
        tasks={[task('T1', 'do work')]}
        request={{ requestId: 3, projectId: 'p1', action: 'open-transcript', runId: 'RUN7', title: 'do work' }}
      />,
    )

    await waitFor(() => expect(devHarnessReadTranscript).toHaveBeenCalledWith({ runId: 'RUN7' }))
    const dialog = screen.getByRole('dialog', { name: 'dev-run transcript' })
    expect(within(dialog).getByText('do work')).toBeDefined()
    expect(screen.getByTestId('transcript-content').textContent).toContain('transcript body here')
  })

  it('closes the composer dialog from its accessible close button', async () => {
    composeContext.mockResolvedValue({ ok: true, prompt: 'PROMPT' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /컨텍스트 조립/ })) })
    fireEvent.click(screen.getByRole('button', { name: '컨텍스트 패키지 닫기' }))
    expect(screen.queryByRole('dialog', { name: /컨텍스트 패키지/ })).toBeNull()
  })

  it('disables conflicting controls while context composition is in progress', async () => {
    let resolveCompose!: (value: unknown) => void
    composeContext.mockImplementation(() => new Promise((resolve) => { resolveCompose = resolve }))
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    fireEvent.click(screen.getByRole('button', { name: /컨텍스트 조립/ }))

    await waitFor(() => expect(runBtn().disabled).toBe(true))
    expect(screen.getByRole('dialog', { name: '컨텍스트 패키지 조립 중' })).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('조립하고 있습니다')
    expect((screen.getByRole('button', { name: /컨텍스트 조립/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('실행할 작업') as HTMLSelectElement).disabled).toBe(true)
    await act(async () => { resolveCompose({ ok: true, prompt: 'ready' }) })
  })
})
