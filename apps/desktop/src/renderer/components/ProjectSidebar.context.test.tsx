import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Project } from '@apc/shared'
import { ProjectSidebar } from './ProjectSidebar.js'

const baseProps = {
  selectedProjectId: null,
  collapsed: false,
  onToggleCollapse: () => {},
  onSelect: () => {},
  onDelete: () => {},
}

const project: Project = {
  id: 'p1', name: 'Dashboard', status: 'active', projectType: 'git', domain: 'project-docs',
  repoPaths: ['/repo'], vaultPaths: [], sourcePaths: [],
  goal: 'Agent proposal', goalSource: 'agent',
  currentFocus: 'Existing focus', currentFocusSource: 'user', currentFocusConfirmedAt: '2026-07-20T00:00:00Z',
}

function openEdit() {
  fireEvent.contextMenu(screen.getByText('Dashboard'))
  fireEvent.click(screen.getByText('✎ 프로젝트 편집'))
}

describe('ProjectSidebar context editing', () => {
  test('submits trimmed goal and focus with the project fields', async () => {
    const onUpdate = vi.fn(async () => ({ ok: true }))
    render(
      <ProjectSidebar
        {...baseProps}
        projects={[project]}
        onAdd={() => {}}
        onUpdate={onUpdate}
      />,
    )
    openEdit()
    fireEvent.change(screen.getByLabelText('프로젝트 목표'), { target: { value: '  User goal  ' } })
    fireEvent.change(screen.getByLabelText('현재 집중 항목'), { target: { value: '  Ship form  ' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onUpdate).toHaveBeenCalledWith(
      'p1', 'Dashboard', 'git', '/repo', 'project-docs',
      { goal: 'User goal', currentFocus: 'Ship form' },
    )
    await waitFor(() => expect(screen.queryByText('Edit Project')).toBeNull())
  })

  test('keeps the dialog and entered values when an async save fails', async () => {
    const onUpdate = vi.fn(async () => ({ ok: false, reason: 'disk full' }))
    render(
      <ProjectSidebar
        {...baseProps}
        projects={[project]}
        onAdd={() => {}}
        onUpdate={onUpdate}
      />,
    )
    openEdit()
    fireEvent.change(screen.getByLabelText('프로젝트 목표'), { target: { value: 'Keep this value' } })
    fireEvent.click(screen.getByText('Save'))

    expect((await screen.findByRole('alert')).textContent).toContain('disk full')
    expect((screen.getByLabelText('프로젝트 목표') as HTMLTextAreaElement).value).toBe('Keep this value')
    expect(screen.getByText('Edit Project')).toBeTruthy()
  })

  test('confirms an agent proposal explicitly and refreshes its provenance', async () => {
    const onConfirmContext = vi.fn(async () => ({
      ok: true,
      project: { ...project, goalConfirmedAt: '2026-07-20T12:00:00Z' },
    }))
    render(
      <ProjectSidebar
        {...baseProps}
        projects={[project]}
        onAdd={() => {}}
        onUpdate={() => {}}
        onConfirmContext={onConfirmContext}
      />,
    )
    openEdit()
    fireEvent.click(screen.getByLabelText('목표 AI 제안 확정'))

    await waitFor(() => expect(onConfirmContext).toHaveBeenCalledWith({ projectId: 'p1', field: 'goal' }))
    expect(await screen.findByText('AI 제안 · 사용자 확정')).toBeTruthy()
    expect(screen.queryByLabelText('목표 AI 제안 확정')).toBeNull()
  })
})
