import { TaskSchema, type NextNote, type Task } from '@apc/shared'
import type { Db } from '@apc/core'
import type { NextNoteStore } from './next-note-store.js'
import type { TaskStore } from './task-store.js'

export type ConvertNoteToTaskCommand = {
  projectId: string
  noteId: string
  title?: string
  priority?: Task['priority']
  dueDate?: string
}
export type ConvertNoteToTaskResult =
  | { ok: true; note: NextNote; task: Task; alreadyConverted: boolean }
  | { ok: false; reason: string }

function normalizeDueDate(value: string | undefined): string | undefined | null {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

/** Atomically turns a note into one manual-actionable Task and archives the note. */
export class NoteTaskService {
  constructor(
    private readonly db: Db,
    private readonly notes: NextNoteStore,
    private readonly tasks: TaskStore,
    private readonly projectExists: (projectId: string) => boolean,
    private readonly nextId: (projectId: string, noteId: string) => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  convert(command: ConvertNoteToTaskCommand): ConvertNoteToTaskResult {
    if (!this.projectExists(command.projectId)) return { ok: false, reason: 'project-not-found' }
    const dueDate = normalizeDueDate(command.dueDate)
    if (dueDate === null) return { ok: false, reason: 'invalid-due-date' }

    const initial = this.notes.get(command.noteId)
    if (!initial) return { ok: false, reason: 'note-not-found' }
    if (initial.projectId !== command.projectId) return { ok: false, reason: 'project-mismatch' }
    const existing = this.existingConversion(initial)
    if (existing) return existing

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const note = this.notes.get(command.noteId)
      if (!note || note.projectId !== command.projectId) throw new Error('note-changed')
      const raced = this.existingConversion(note)
      if (raced) {
        this.db.exec('COMMIT')
        return raced
      }

      const timestamp = this.now()
      const taskId = this.nextId(command.projectId, command.noteId)
      const task = this.tasks.create(TaskSchema.parse({
        id: taskId,
        projectId: command.projectId,
        title: command.title?.trim() || note.text,
        status: 'todo',
        assigneeType: 'human',
        priority: command.priority ?? 'medium',
        dueDate,
        source: 'note',
        sourceRef: note.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      }))
      if (task.id !== taskId || task.deletedAt || task.sourceRef !== note.id) throw new Error('task-id-collision')

      const converted = this.notes.markConverted(command.projectId, note.id, task.id, timestamp)
      if (!converted.ok) throw new Error(converted.reason)
      this.db.exec('COMMIT')
      return { ok: true, note: converted.note, task, alreadyConverted: false }
    } catch {
      try { this.db.exec('ROLLBACK') } catch { /* transaction already closed */ }
      return { ok: false, reason: 'conversion-failed' }
    }
  }

  private existingConversion(note: NextNote): ConvertNoteToTaskResult | null {
    if (!note.convertedTaskId) return null
    const task = this.tasks.getIncludingDeleted(note.convertedTaskId)
    if (!task) return { ok: false, reason: 'converted-task-missing' }
    if (task.deletedAt) return { ok: false, reason: 'already-converted-task-deleted' }
    return { ok: true, note, task, alreadyConverted: true }
  }
}
