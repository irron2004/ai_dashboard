import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const startPty = vi.fn()
vi.mock('../api.js', () => ({
  api: {
    startPty: (req: unknown) => startPty(req),
    killPty: vi.fn(), writePty: vi.fn(), resizePty: vi.fn(),
    onPtyData: () => () => {},
    onPtyExit: () => () => {},
  },
}))
// xterm needs canvas/measureText (absent in jsdom) → mock to no-ops.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24
    loadAddon() {} open() {} write() {} dispose() {} getSelection() { return '' }
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} } }
    onSelectionChange() { return { dispose() {} } }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

import { AgentTerminal } from './AgentTerminal.js'

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom lacks ResizeObserver
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  }
})

describe('AgentTerminal restart', () => {
  it('re-spawns the pty (startPty) when restartNonce changes', () => {
    const props = { sessionId: 'p1:claude', command: 'claude', args: [] as string[], cwd: '/x', agent: 'claude' as const }
    const { rerender } = render(<AgentTerminal {...props} restartNonce={0} />)
    expect(startPty).toHaveBeenCalledTimes(1)
    rerender(<AgentTerminal {...props} restartNonce={1} />)
    expect(startPty).toHaveBeenCalledTimes(2)
    expect(startPty).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1:claude' }))
  })
})
