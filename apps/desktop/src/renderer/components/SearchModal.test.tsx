import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { SearchModal } from './SearchModal.js'

vi.mock('../api.js', () => ({
  api: { search: vi.fn().mockResolvedValue({ query: 'auth', hits: [{ kind: 'session', id: 's1', title: 's1', excerpt: 'jwt auth flow', projectId: 'p1' }] }) },
}))

describe('SearchModal', () => {
  test('renders nothing when closed', () => {
    const { container } = render(<SearchModal open={false} onClose={vi.fn()} onSelectProject={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  test('searches on Enter and renders hits; clicking a hit switches project and closes', async () => {
    const onClose = vi.fn(); const onSelectProject = vi.fn()
    render(<SearchModal open onClose={onClose} onSelectProject={onSelectProject} />)
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'auth' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })
    const hit = await screen.findByText('jwt auth flow')
    fireEvent.click(hit)
    expect(onSelectProject).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalled()
  })
})
