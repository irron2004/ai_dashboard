import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Task } from '@apc/shared'
import { TaskBoard } from './TaskBoard.js'

const t = (id: string, status: Task['status'], title: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: 'p1', title, status, assigneeType: 'agent', priority: 'medium',
  reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], ...extra,
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

  test('shows a 차단 badge whose tooltip lists unresolved blocker titles', () => {
    const list: Task[] = [
      t('B1', 'todo', 'blocked one', { blockedBy: ['B2'] }),
      t('B2', 'in_progress', 'blocker task'),
    ]
    render(<TaskBoard tasks={list} />)
    const card = within(screen.getByTestId('col-todo')).getByText('blocked one').closest('.pm-board__card')!
    const badge = within(card as HTMLElement).getByText('🚫 차단')
    expect(badge.getAttribute('title')).toContain('blocker task')
  })
  test('no 차단 badge once the blocker is done', () => {
    const list: Task[] = [
      t('B1', 'todo', 'now free', { blockedBy: ['B2'] }),
      t('B2', 'done', 'finished'),
    ]
    render(<TaskBoard tasks={list} />)
    expect(screen.queryByText('🚫 차단')).toBeNull()
  })
  test('the ⛓ editor calls onSetBlockedBy with the selected ids', () => {
    const calls: Array<[string, string[]]> = []
    const list: Task[] = [t('E1', 'todo', 'pick deps'), t('E2', 'todo', 'other task')]
    render(<TaskBoard tasks={list} onSetBlockedBy={(id, deps) => calls.push([id, deps])} />)
    fireEvent.click(screen.getByLabelText('의존성 편집 pick deps'))
    const select = screen.getByLabelText('차단 작업 선택 pick deps') as HTMLSelectElement
    ;(within(select).getByText('other task') as HTMLOptionElement).selected = true
    fireEvent.change(select)
    expect(calls).toEqual([['E1', ['E2']]])
  })
  test('no ⛓ editor button when onSetBlockedBy is absent', () => {
    render(<TaskBoard tasks={[t('X', 'todo', 'solo')]} />)
    expect(screen.queryByLabelText('의존성 편집 solo')).toBeNull()
  })
})
