import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Task } from '@apc/shared'
import { CH } from '../../shared/ipc-contract.js'
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

  test('always identifies source and marks a user-edited Task', () => {
    render(<TaskBoard tasks={[t('S1', 'todo', 'from note', { source: 'note', userEditedAt: '2026-07-20T10:00:00Z' })]} />)
    expect(screen.getByText('출처: 메모 전환')).toBeDefined()
    expect(screen.getByText('사용자 수정')).toBeDefined()
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

  test('hands the exact card task to compose and Run without a second selection', () => {
    const onComposeTask = vi.fn()
    const onRunTask = vi.fn()
    render(<TaskBoard tasks={tasks} onComposeTask={onComposeTask} onRunTask={onRunTask} />)

    fireEvent.click(screen.getByRole('button', { name: 'build it 컨텍스트 조립' }))
    fireEvent.click(screen.getByRole('button', { name: 'build it Harness 실행' }))

    expect(onComposeTask).toHaveBeenCalledWith('T2')
    expect(onRunTask).toHaveBeenCalledWith('T2')
  })

  test('disables unsafe card actions for blocked, review, and completed tasks', () => {
    const list: Task[] = [
      t('B1', 'todo', 'blocked one', { blockedBy: ['B2'] }),
      t('B2', 'in_progress', 'blocker task'),
      t('R1', 'review', 'review me'),
      t('D1', 'done', 'already done'),
    ]
    render(<TaskBoard tasks={list} onComposeTask={() => {}} onRunTask={() => {}} />)

    expect((screen.getByRole('button', { name: 'blocked one Harness 실행' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'blocked one 컨텍스트 조립' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'review me Harness 실행' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'already done 컨텍스트 조립' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'already done Harness 실행' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('opens the exact Task and completes it only after persistence succeeds', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true, task: { ...tasks[1], status: 'done' } }))
    const onOpenTask = vi.fn()
    const onChanged = vi.fn()
    ;(window as unknown as { apc: unknown }).apc = { invoke }
    render(<TaskBoard tasks={[tasks[1]]} onOpenTask={onOpenTask} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'build it 편집' }))
    expect(onOpenTask).toHaveBeenCalledWith(tasks[1])
    fireEvent.click(screen.getByRole('button', { name: 'build it 완료' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.taskUpdate, {
      projectId: 'p1', taskId: 'T2', title: 'build it', status: 'done', priority: 'high', dueDate: '2026-06-10',
    }))
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  test('does not notify a completion when persistence fails', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: false, reason: 'write-failed' }))
    const onChanged = vi.fn()
    ;(window as unknown as { apc: unknown }).apc = { invoke }
    render(<TaskBoard tasks={[tasks[0]]} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'plan it 완료' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('write-failed'))
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('confirms deletion and sends the project-scoped command', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true, task: { ...tasks[0], deletedAt: 'now' } }))
    const onChanged = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    ;(window as unknown as { apc: unknown }).apc = { invoke }
    render(<TaskBoard tasks={[tasks[0]]} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'plan it 삭제' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.taskDelete, { projectId: 'p1', taskId: 'T1' }))
    expect(onChanged).toHaveBeenCalled()
  })
})

afterEach(() => {
  delete (window as unknown as { apc?: unknown }).apc
  vi.restoreAllMocks()
})
