import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Project } from '@apc/shared'
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

const sshProject = (path: string): Project => ({
  id: 'p1', name: 'Remote', status: 'active', projectType: 'git', domain: 'paper',
  repoPaths: [path], vaultPaths: [], sourcePaths: [],
} as Project)

function openEditMenu() {
  fireEvent.contextMenu(screen.getByText('Remote'))
  fireEvent.click(screen.getByText('✎ 연결 편집'))
}

describe('ProjectSidebar edit-connection save validation', () => {
  // An ssh path with no `user@` → url.username is '' → the old code silently no-op'd on Save.
  test('Save is disabled with a reason when a required ssh field (username) is empty', () => {
    const onUpdate = vi.fn()
    render(<ProjectSidebar projects={[sshProject('ssh://a6000:22/home/me/proj')]} selectedProjectId={null} collapsed={false} onToggleCollapse={() => {}} onSelect={() => {}} onAdd={() => {}} onUpdate={onUpdate} onDelete={() => {}} />)
    openEditMenu()
    const save = screen.getByText('Save') as HTMLButtonElement
    expect(save.disabled).toBe(true)                       // not a silent no-op anymore
    fireEvent.click(save)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByText(/모두 입력하세요/)).toBeTruthy()   // tells the user what's missing
  })

  test('filling the missing username enables Save and submits the full ssh path', () => {
    const onUpdate = vi.fn()
    render(<ProjectSidebar projects={[sshProject('ssh://a6000:22/home/me/proj')]} selectedProjectId={null} collapsed={false} onToggleCollapse={() => {}} onSelect={() => {}} onAdd={() => {}} onUpdate={onUpdate} onDelete={() => {}} />)
    openEditMenu()
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'me' } })
    const save = screen.getByText('Save') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(onUpdate).toHaveBeenCalledWith('p1', 'Remote', 'git', 'ssh://me@a6000:22/home/me/proj', 'paper')
  })
})
