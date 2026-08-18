import { afterEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Task } from '@apc/shared'
import { CH } from '../../shared/ipc-contract.js'
import { TaskEditorDialog } from './TaskEditorDialog.js'

const task: Task = {
  id: 'T1', projectId: 'p1', title: '기존 Task', status: 'in_progress', assigneeType: 'human',
  priority: 'high', dueDate: '2026-07-30', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [],
  blockedBy: [], source: 'manual',
}

function bridge(invoke: ReturnType<typeof vi.fn>) {
  ;(window as unknown as { apc: unknown }).apc = { invoke }
}

afterEach(() => {
  delete (window as unknown as { apc?: unknown }).apc
  vi.restoreAllMocks()
})

describe('TaskEditorDialog', () => {
  test('limits file-managed projects to statuses represented by next.yml', () => {
    bridge(vi.fn())
    render(<TaskEditorDialog projectId="p1" task={task} fileManaged onClose={() => {}} />)
    const labels = Array.from(
      (screen.getByLabelText('Task 상태') as HTMLSelectElement).options,
      (option) => option.text,
    )
    expect(labels).toEqual(['할 일', '진행 중', '완료'])
  })

  test('validates title locally and creates a Task with all editor fields', async () => {
    const created = { ...task, id: 'T-new', title: '새 Task', status: 'todo' as const, priority: 'low' as const, dueDate: '2026-08-01' }
    const invoke = vi.fn(() => Promise.resolve({ ok: true, task: created }))
    const onChanged = vi.fn()
    const onClose = vi.fn()
    bridge(invoke)
    render(<TaskEditorDialog projectId="p1" onChanged={onChanged} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert').textContent).toContain('제목')
    expect(invoke).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Task 제목'), { target: { value: '  새 Task  ' } })
    fireEvent.change(screen.getByLabelText('Task 우선순위'), { target: { value: 'low' } })
    fireEvent.change(screen.getByLabelText('Task 마감일'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.taskCreate, {
      projectId: 'p1', title: '새 Task', status: 'todo', priority: 'low', dueDate: '2026-08-01',
    }))
    expect(onChanged).toHaveBeenCalledWith(created, 'created')
    expect(onClose).toHaveBeenCalled()
  })

  test('updates the existing Task and preserves input when persistence fails', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: false, reason: 'write-failed' }))
    const onChanged = vi.fn()
    bridge(invoke)
    render(<TaskEditorDialog projectId="p1" task={task} onChanged={onChanged} onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Task 제목'), { target: { value: '수정값 유지' } })
    fireEvent.change(screen.getByLabelText('Task 상태'), { target: { value: 'review' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('write-failed'))
    expect((screen.getByLabelText('Task 제목') as HTMLInputElement).value).toBe('수정값 유지')
    expect(invoke).toHaveBeenCalledWith(CH.taskUpdate, {
      projectId: 'p1', taskId: 'T1', title: '수정값 유지', status: 'review', priority: 'high', dueDate: '2026-07-30',
    })
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Task 편집' })).toBeDefined()
  })

  test('deletes only after confirmation and reports the tombstoned Task', async () => {
    const deleted = { ...task, deletedAt: '2026-07-20T10:00:00Z' }
    const invoke = vi.fn(() => Promise.resolve({ ok: true, task: deleted }))
    const onChanged = vi.fn()
    const onClose = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    bridge(invoke)
    render(<TaskEditorDialog projectId="p1" task={task} onChanged={onChanged} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.taskDelete, { projectId: 'p1', taskId: 'T1' }))
    expect(onChanged).toHaveBeenCalledWith(deleted, 'deleted')
    expect(onClose).toHaveBeenCalled()
  })
})
