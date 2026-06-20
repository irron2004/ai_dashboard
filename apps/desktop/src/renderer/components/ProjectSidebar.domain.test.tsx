import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectSidebar } from './ProjectSidebar.js'

describe('ProjectSidebar domain', () => {
  test('passes the chosen domain to onAdd', () => {
    const onAdd = vi.fn()
    render(<ProjectSidebar projects={[]} selectedProjectId={null} collapsed={false} onToggleCollapse={() => {}} onSelect={() => {}} onAdd={onAdd} onUpdate={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByText('+ Add Project'))                // real trigger text (line 197)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Papers' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'paper' } })
    fireEvent.change(screen.getByLabelText('Repository path'), { target: { value: '/tmp/p' } })
    fireEvent.click(screen.getByText('Create'))                        // new-project submit is "Create"
    expect(onAdd).toHaveBeenCalledWith('Papers', 'git', '/tmp/p', 'paper')
  })
})
