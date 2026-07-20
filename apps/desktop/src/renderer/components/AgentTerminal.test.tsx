import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const startPty = vi.fn()
const writePty = vi.fn()
const resizePty = vi.fn()
const clipboardReadText = vi.fn()
const terminalInstances: Array<{
  unicode: { activeVersion: string }
  options: { fontFamily?: string; fontSize?: number }
  modes: { bracketedPasteMode: boolean }
  paste: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  selection: string
  keyHandler?: (event: KeyboardEvent) => boolean
  dataHandler?: (data: string) => void
  output: string[]
}> = []

vi.mock('../api.js', () => ({
  api: {
    startPty: (req: unknown) => startPty(req),
    killPty: vi.fn(),
    writePty: (req: unknown) => writePty(req),
    resizePty: (req: unknown) => resizePty(req),
    clipboardReadText: () => clipboardReadText(),
    terminalGetPreferences: vi.fn(() => Promise.resolve({ ok: false })),
    onPtyData: () => () => {},
    onPtyExit: () => () => {},
  },
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    unicode = { activeVersion: '6' }
    options: { fontFamily?: string; fontSize?: number }
    modes = { bracketedPasteMode: true }
    paste = vi.fn()
    refresh = vi.fn()
    selection = ''
    keyHandler?: (event: KeyboardEvent) => boolean
    dataHandler?: (data: string) => void
    output: string[] = []
    constructor(options: { fontFamily?: string; fontSize?: number } = {}) {
      this.options = { ...options }
      terminalInstances.push(this)
    }
    loadAddon() {}
    open() {}
    write(value: string, callback?: () => void) { this.output.push(value); callback?.() }
    dispose() {}
    getSelection() { return this.selection }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { this.keyHandler = handler }
    onData(handler: (data: string) => void) { this.dataHandler = handler; return { dispose() {} } }
    onSelectionChange() { return { dispose() {} } }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class { activate() {}; dispose() {} } }))

import { AgentTerminal } from './AgentTerminal.js'

beforeEach(() => {
  vi.clearAllMocks()
  terminalInstances.length = 0
  clipboardReadText.mockResolvedValue({ ok: true, text: '' })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  })
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('AgentTerminal', () => {
  it('activates Unicode 11 and starts with a CJK-capable font stack', () => {
    render(<AgentTerminal sessionId="pane-1" command="" args={[]} cwd="/repo" />)

    expect(terminalInstances[0].unicode.activeVersion).toBe('11')
    expect(terminalInstances[0].options.fontFamily).toContain('D2Coding')
  })

  it('re-spawns the pty when restartNonce changes', () => {
    const props = { sessionId: 'p1:claude', command: 'claude', args: [] as string[], cwd: '/x', agent: 'claude' as const }
    const { rerender } = render(<AgentTerminal {...props} restartNonce={0} />)
    expect(startPty).toHaveBeenCalledTimes(1)
    rerender(<AgentTerminal {...props} restartNonce={1} />)
    expect(startPty).toHaveBeenCalledTimes(2)
    expect(startPty).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1:claude' }))
  })

  it('uses main clipboard read and term.paste for Ctrl+V without rewriting the text', async () => {
    const text = '한글\nC:\\repo\\app.py\n'
    clipboardReadText.mockResolvedValue({ ok: true, text })
    render(<AgentTerminal sessionId="pane-1" command="" args={[]} cwd="/repo" />)
    const terminal = terminalInstances[0]
    expect(terminal.keyHandler?.({
      type: 'keydown', key: 'v', ctrlKey: true, shiftKey: false, metaKey: false, altKey: false,
    } as KeyboardEvent)).toBe(false)
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledWith(text))
    expect(writePty).not.toHaveBeenCalledWith({ id: 'pane-1', data: text })
    expect(screen.getByRole('status').textContent).toContain('붙여넣었습니다')
  })

  it('shows clipboard failures through an aria-live terminal notice', async () => {
    clipboardReadText.mockResolvedValue({ ok: false, reason: 'permission-denied' })
    render(<AgentTerminal sessionId="pane-1" command="" args={[]} cwd="/repo" />)
    terminalInstances[0].keyHandler?.({
      type: 'keydown', key: 'Insert', ctrlKey: false, shiftKey: true, metaKey: false, altKey: false,
    } as KeyboardEvent)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('권한'))
    expect(terminalInstances[0].paste).not.toHaveBeenCalled()
  })

  it('routes right-click Paste through the same controller', async () => {
    clipboardReadText.mockResolvedValue({ ok: true, text: 'context paste' })
    const { container } = render(<AgentTerminal sessionId="pane-1" command="" args={[]} cwd="/repo" />)
    fireEvent.contextMenu(container.querySelector('.agent-terminal-shell') as HTMLElement, { clientX: 20, clientY: 30 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))
    await waitFor(() => expect(terminalInstances[0].paste).toHaveBeenCalledWith('context paste'))
  })

  it('emits only reliable non-secure Enter candidates while still writing every key to PTY', () => {
    const onQuestionCandidate = vi.fn()
    render(<AgentTerminal sessionId="pane-1" command="" args={[]} cwd="/repo" onQuestionCandidate={onQuestionCandidate} />)
    terminalInstances[0].dataHandler?.('테스트해줘\r')
    expect(onQuestionCandidate).toHaveBeenCalledWith('테스트해줘')
    expect(writePty).toHaveBeenCalledWith({ id: 'pane-1', data: '테스트해줘\r' })
  })
})
