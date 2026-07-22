import { afterEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { NextNote, Task } from '@apc/shared'
import { CH } from '../../shared/ipc-contract.js'
import { ProjectNotesDrawer } from './ProjectNotesDrawer.js'

const active: NextNote = {
  id: 'N1', projectId: 'p1', text: '활성 메모', createdAt: '2026-07-20T09:00:00Z', updatedAt: '2026-07-20T09:00:00Z', done: false, pinned: false,
}
const completed: NextNote = {
  id: 'N2', projectId: 'p1', text: '완료 메모', createdAt: '2026-07-20T08:00:00Z', updatedAt: '2026-07-20T08:00:00Z', done: true, pinned: false,
}
const archived: NextNote = {
  id: 'N3', projectId: 'p1', text: '보관 메모', createdAt: '2026-07-20T07:00:00Z', updatedAt: '2026-07-20T07:00:00Z', done: true,
  pinned: false, archivedAt: '2026-07-20T10:00:00Z',
}

function bridge(invoke: ReturnType<typeof vi.fn>) {
  ;(window as unknown as { apc: unknown }).apc = { invoke }
}

afterEach(() => {
  delete (window as unknown as { apc?: unknown }).apc
  vi.restoreAllMocks()
})

describe('ProjectNotesDrawer', () => {
  test('loads every lifecycle once and filters active, completed, and archived notes', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: true, notes: [active, completed, archived] }))
    bridge(invoke)
    render(<ProjectNotesDrawer projectId="p1" onClose={() => {}} />)

    await screen.findByText('활성 메모')
    expect(invoke).toHaveBeenCalledWith(CH.nextNotesList, { projectId: 'p1', includeCompleted: true, includeArchived: true })
    expect(screen.queryByText('완료 메모')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '완료 1' }))
    expect(screen.getByText('완료 메모')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '보관됨 1' }))
    expect(screen.getByText('보관 메모')).toBeDefined()
  })

  test('adds, edits, and pins notes while notifying the owner after each success', async () => {
    const edited = { ...active, text: '편집 완료', updatedAt: '2026-07-20T11:00:00Z' }
    const pinned = { ...edited, pinned: true, updatedAt: '2026-07-20T12:00:00Z' }
    const added = { ...active, id: 'N4', text: '새 메모' }
    const invoke = vi.fn((channel: string) => {
      if (channel === CH.nextNotesList) return Promise.resolve({ ok: true, notes: [active] })
      if (channel === CH.nextNoteAdd) return Promise.resolve({ ok: true, note: added })
      if (channel === CH.nextNoteUpdate) return Promise.resolve({ ok: true, note: edited })
      if (channel === CH.nextNoteSetPinned) return Promise.resolve({ ok: true, note: pinned })
      return Promise.resolve({ ok: false, reason: 'unexpected' })
    })
    const onChanged = vi.fn()
    bridge(invoke)
    render(<ProjectNotesDrawer projectId="p1" onClose={() => {}} onChanged={onChanged} />)
    await screen.findByText('활성 메모')

    fireEvent.change(screen.getByLabelText('새 프로젝트 메모'), { target: { value: ' 새 메모 ' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await screen.findByText('새 메모')
    expect(invoke).toHaveBeenCalledWith(CH.nextNoteAdd, { projectId: 'p1', text: '새 메모' })

    const originalItem = screen.getByText('활성 메모').closest('li') as HTMLElement
    fireEvent.click(within(originalItem).getByRole('button', { name: '편집' }))
    fireEvent.change(screen.getByLabelText('활성 메모 메모 편집'), { target: { value: '편집 완료' } })
    fireEvent.click(within(originalItem).getByRole('button', { name: '저장' }))
    await screen.findByText('편집 완료')
    fireEvent.click(within(screen.getByText('편집 완료').closest('li') as HTMLElement).getByRole('button', { name: '고정' }))
    await waitFor(() => expect(screen.getByLabelText('고정됨')).toBeDefined())
    expect(onChanged).toHaveBeenCalledTimes(3)
  })

  test('keeps the edit draft visible when an update fails', async () => {
    const invoke = vi.fn((channel: string) => Promise.resolve(
      channel === CH.nextNotesList ? { ok: true, notes: [active] } : { ok: false, reason: 'write-failed' },
    ))
    bridge(invoke)
    render(<ProjectNotesDrawer projectId="p1" onClose={() => {}} />)
    const text = await screen.findByText('활성 메모')
    const item = text.closest('li') as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: '편집' }))
    fireEvent.change(screen.getByLabelText('활성 메모 메모 편집'), { target: { value: '지워지면 안 됨' } })
    fireEvent.click(within(item).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('write-failed'))
    expect((screen.getByLabelText('활성 메모 메모 편집') as HTMLInputElement).value).toBe('지워지면 안 됨')
  })

  test('restores an archived completed note to completed and deletes with project ownership', async () => {
    const restored = { ...archived, archivedAt: undefined }
    const invoke = vi.fn((channel: string) => {
      if (channel === CH.nextNotesList) return Promise.resolve({ ok: true, notes: [archived] })
      if (channel === CH.nextNoteSetLifecycle) return Promise.resolve({ ok: true, note: restored })
      if (channel === CH.nextNoteDelete) return Promise.resolve({ ok: true })
      return Promise.resolve({ ok: false })
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    bridge(invoke)
    render(<ProjectNotesDrawer projectId="p1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '보관됨 1' })).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: '보관됨 1' }))
    const item = (await screen.findByText('보관 메모')).closest('li') as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: '복원' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.nextNoteSetLifecycle, { projectId: 'p1', noteId: 'N3', lifecycle: 'completed' }))

    fireEvent.click(screen.getByRole('button', { name: '완료 1' }))
    const restoredItem = screen.getByText('보관 메모').closest('li') as HTMLElement
    fireEvent.click(within(restoredItem).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(CH.nextNoteDelete, { projectId: 'p1', id: 'N3' }))
    expect(screen.queryByText('보관 메모')).toBeNull()
  })

  test('converts a note and exposes the created Task through onOpenTask', async () => {
    const task: Task = {
      id: 'T-N1', projectId: 'p1', title: '활성 메모', status: 'todo', assigneeType: 'human', priority: 'medium',
      reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], source: 'note', sourceRef: 'N1',
    }
    const converted = { ...active, archivedAt: '2026-07-20T12:00:00Z', convertedTaskId: task.id }
    const invoke = vi.fn((channel: string) => Promise.resolve(
      channel === CH.nextNotesList ? { ok: true, notes: [active] } : { ok: true, note: converted, task },
    ))
    const onOpenTask = vi.fn()
    bridge(invoke)
    render(<ProjectNotesDrawer projectId="p1" onClose={() => {}} onOpenTask={onOpenTask} />)
    const item = (await screen.findByText('활성 메모')).closest('li') as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: 'Task로 전환' }))

    await screen.findByText(/Task를 만들었습니다/)
    fireEvent.click(screen.getByRole('button', { name: 'Task 열기' }))
    expect(invoke).toHaveBeenCalledWith(CH.nextNoteConvertToTask, { projectId: 'p1', noteId: 'N1' })
    expect(onOpenTask).toHaveBeenCalledWith(task)
  })
})
