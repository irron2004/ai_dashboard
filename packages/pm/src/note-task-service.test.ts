import { beforeEach, describe, expect, test, vi } from 'vitest'
import { migrate, openDb, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { NextNoteStore } from './next-note-store.js'
import { TaskStore } from './task-store.js'
import { NoteTaskService } from './note-task-service.js'

describe('NoteTaskService', () => {
  let db: Db
  let notes: NextNoteStore
  let tasks: TaskStore
  let service: NoteTaskService
  let ids: number

  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    const now = () => '2026-07-20T10:00:00.000Z'
    notes = new NextNoteStore(db, now)
    tasks = new TaskStore(db, now)
    ids = 0
    service = new NoteTaskService(
      db, notes, tasks, (projectId) => ['p1', 'p2'].includes(projectId),
      (projectId) => `task:${projectId}:note-${++ids}`, now,
    )
  })

  test('atomically creates a note-sourced task and archives the note', () => {
    const note = notes.add('p1', 'Turn this into work')
    const result = service.convert({ projectId: 'p1', noteId: note.id, priority: 'high', dueDate: '2026-07-31' })
    expect(result).toMatchObject({
      ok: true,
      alreadyConverted: false,
      task: {
        id: 'task:p1:note-1', title: 'Turn this into work', status: 'todo', priority: 'high',
        source: 'note', sourceRef: note.id, assigneeType: 'human',
      },
      note: { convertedTaskId: 'task:p1:note-1', archivedAt: '2026-07-20T10:00:00.000Z' },
    })
    expect(notes.listByProject('p1')).toEqual([])
  })

  test('is idempotent and returns the original task', () => {
    const note = notes.add('p1', 'Only once')
    const first = service.convert({ projectId: 'p1', noteId: note.id })
    const second = service.convert({ projectId: 'p1', noteId: note.id, title: 'Do not replace' })
    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: true, alreadyConverted: true, task: { id: 'task:p1:note-1', title: 'Only once' } })
    expect(ids).toBe(1)
    expect(tasks.listByProject('p1')).toHaveLength(1)
  })

  test('rolls the task back if the note transition fails', () => {
    const note = notes.add('p1', 'Rollback')
    vi.spyOn(notes, 'markConverted').mockReturnValue({ ok: false, reason: 'note-not-found' })
    expect(service.convert({ projectId: 'p1', noteId: note.id })).toEqual({ ok: false, reason: 'conversion-failed' })
    expect(tasks.listByProject('p1')).toEqual([])
    expect(notes.get(note.id)?.convertedTaskId).toBeUndefined()
  })

  test('does not silently recreate a deleted converted task', () => {
    const note = notes.add('p1', 'Converted')
    const first = service.convert({ projectId: 'p1', noteId: note.id })
    if (!first.ok) throw new Error('conversion failed')
    tasks.softDeleteUser('p1', first.task.id)
    expect(service.convert({ projectId: 'p1', noteId: note.id })).toEqual({
      ok: false, reason: 'already-converted-task-deleted',
    })
  })

  test('validates project ownership and due date before opening a transaction', () => {
    const note = notes.add('p1', 'Validate')
    expect(service.convert({ projectId: 'missing', noteId: note.id })).toEqual({ ok: false, reason: 'project-not-found' })
    expect(service.convert({ projectId: 'p2', noteId: note.id })).toEqual({ ok: false, reason: 'project-mismatch' })
    expect(service.convert({ projectId: 'p1', noteId: note.id, dueDate: 'soon' })).toEqual({ ok: false, reason: 'invalid-due-date' })
  })
})
