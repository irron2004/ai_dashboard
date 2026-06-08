import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Task } from '@apc/shared'
import { TaskBoard } from './TaskBoard.js'

const t = (id: string, status: Task['status'], title: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: 'p1', title, status, assigneeType: 'agent', priority: 'medium',
  reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], ...extra,
})

describe('TaskBoard', () => {
  const tasks: Task[] = [
    t('T1', 'todo', 'plan it'),
    t('T2', 'in_progress', 'build it', { priority: 'high', dueDate: '2026-06-10' }),
    t('T3', 'review', 'check it'),
    t('T4', 'done', 'ship it'),
    t('T5', 'rejected', 'scrapped'),
  ]

  test('groups each task under its status column', () => {
    render(<TaskBoard tasks={tasks} />)
    expect(within(screen.getByTestId('col-todo')).getByText('plan it')).toBeDefined()
    expect(within(screen.getByTestId('col-in_progress')).getByText('build it')).toBeDefined()
    expect(within(screen.getByTestId('col-review')).getByText('check it')).toBeDefined()
    expect(within(screen.getByTestId('col-done')).getByText('ship it')).toBeDefined()
  })

  test('renders card priority and dueDate', () => {
    render(<TaskBoard tasks={tasks} />)
    const card = within(screen.getByTestId('col-in_progress')).getByText('build it').closest('.pm-board__card')!
    expect(within(card as HTMLElement).getByText('high')).toBeDefined()
    expect(within(card as HTMLElement).getByText('2026-06-10')).toBeDefined()
  })

  test('does not render a rejected column and shows — for empty columns', () => {
    render(<TaskBoard tasks={[t('T1', 'todo', 'only todo')]} />)
    expect(screen.queryByTestId('col-rejected')).toBeNull()
    expect(within(screen.getByTestId('col-done')).getByText('—')).toBeDefined()
  })
})
