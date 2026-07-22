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

  test('clicking outside closes the menu', () => {
    render(<GlobalMenu items={[{ label: '⭳ Update', onClick: vi.fn() }]} />)
    fireEvent.click(screen.getByRole('button', { name: '메뉴' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('⭳ Update')).toBeNull()
  })

  test('supports a discoverable custom trigger and disables the whole menu', () => {
    const { rerender } = render(
      <GlobalMenu
        ariaLabel="프로젝트로 가져오기"
        trigger="↑ 가져오기"
        disabled
        items={[{ label: '파일 가져오기…', onClick: vi.fn() }]}
      />,
    )
    expect(screen.getByRole('button', { name: '프로젝트로 가져오기' }).hasAttribute('disabled')).toBe(true)

    rerender(
      <GlobalMenu
        ariaLabel="프로젝트로 가져오기"
        trigger="↑ 가져오기"
        items={[{ label: '파일 가져오기…', onClick: vi.fn() }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '프로젝트로 가져오기' }))
    expect(screen.getByRole('menuitem', { name: '파일 가져오기…' })).toBeDefined()
  })
})
