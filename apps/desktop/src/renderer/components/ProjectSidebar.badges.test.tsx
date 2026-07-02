import { describe, expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Project } from '@apc/shared'
import { ProjectSidebar } from './ProjectSidebar.js'

const projects: Project[] = [
  { id: 'p1', name: 'Alpha', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: [], vaultPaths: [], sourcePaths: [] },
]

describe('ProjectSidebar badges', () => {
  test('renders running/review counts from the badges prop', () => {
    render(
      <ProjectSidebar
        projects={projects} selectedProjectId={null} collapsed={false}
        onToggleCollapse={() => {}} onSelect={() => {}} onAdd={() => {}} onUpdate={() => {}} onDelete={() => {}}
        badges={{ p1: { running: 2, review: 1 } }}
      />,
    )
    const btn = screen.getByRole('button', { name: /Alpha/ })
    expect(within(btn).getByText('2')).toBeDefined()
    expect(within(btn).getByText('1')).toBeDefined()
  })

  test('renders no badge when counts are zero or missing', () => {
    render(
      <ProjectSidebar
        projects={projects} selectedProjectId={null} collapsed={false}
        onToggleCollapse={() => {}} onSelect={() => {}} onAdd={() => {}} onUpdate={() => {}} onDelete={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: /Alpha/ })
    expect(within(btn).queryByText('2')).toBeNull()
  })
})
