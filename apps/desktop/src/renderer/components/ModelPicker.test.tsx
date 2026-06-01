import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ModelPicker } from './ModelPicker.js'

describe('ModelPicker', () => {
  test('renders all engine options', () => {
    const onPick = vi.fn()
    render(<ModelPicker defaultEngine="codex" onPick={onPick} />)
    expect(screen.getByText('claude')).toBeDefined()
    expect(screen.getByText('codex')).toBeDefined()
    expect(screen.getByText('opencode')).toBeDefined()
  })

  test('calls onPick with the chosen engine when clicked', () => {
    const onPick = vi.fn()
    render(<ModelPicker defaultEngine="codex" onPick={onPick} />)
    fireEvent.click(screen.getByText('claude'))
    expect(onPick).toHaveBeenCalledWith('claude')
  })

  test('highlights the defaultEngine', () => {
    const onPick = vi.fn()
    render(<ModelPicker defaultEngine="codex" onPick={onPick} />)
    const codexBtn = screen.getByText('codex').closest('button')
    expect(codexBtn?.getAttribute('data-default')).toBe('true')
  })
})
