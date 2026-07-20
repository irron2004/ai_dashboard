import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TerminalContextMenu } from './TerminalContextMenu.js'

describe('TerminalContextMenu', () => {
  test('routes Copy and Paste to the supplied controller callbacks', () => {
    const onCopy = vi.fn()
    const onPaste = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(<TerminalContextMenu x={10} y={20} canCopy={false} onCopy={onCopy} onPaste={onPaste} onClose={onClose} />)
    expect((screen.getByRole('menuitem', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))
    expect(onPaste).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<TerminalContextMenu x={10} y={20} canCopy onCopy={onCopy} onPaste={onPaste} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  test('closes on Escape', () => {
    const onClose = vi.fn()
    render(<TerminalContextMenu x={0} y={0} canCopy onCopy={() => {}} onPaste={() => {}} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
