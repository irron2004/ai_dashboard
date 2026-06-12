import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { GlobalMenu } from './GlobalMenu.js'

describe('GlobalMenu', () => {
  test('menu is closed by default and opens on ⋯ click', () => {
    render(<GlobalMenu items={[{ label: '⭳ Update', onClick: vi.fn() }]} />)
    expect(screen.queryByText('⭳ Update')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '메뉴' }))
    expect(screen.getByText('⭳ Update')).toBeDefined()
  })

  test('clicking an item fires its handler and closes the menu', () => {
    const onClick = vi.fn()
    render(<GlobalMenu items={[{ label: '⭳ Update', onClick }]} />)
    fireEvent.click(screen.getByRole('button', { name: '메뉴' }))
    fireEvent.click(screen.getByText('⭳ Update'))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByText('⭳ Update')).toBeNull()
  })

  test('disabled item does not fire', () => {
    const onClick = vi.fn()
    render(<GlobalMenu items={[{ label: '⭳ Update', onClick, disabled: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: '메뉴' }))
    fireEvent.click(screen.getByText('⭳ Update'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
