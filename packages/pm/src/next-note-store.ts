import { NextNoteSchema, type NextNote, type NextNoteLifecycle } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  id: string
  project_id: string
  text: string
  created_at: string
  done: number
  updated_at: string | null
  pinned: number
  archived_at: string | null
  converted_task_id: string | null
}

export type NoteMutationResult =
  | { ok: true; note: NextNote }
  | { ok: false; reason: 'note-not-found' | 'project-mismatch' | 'empty-text' }

function toNote(row: Row): NextNote {
  return NextNoteSchema.parse({
    id: row.id,
    projectId: row.project_id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    done: row.done === 1,
    pinned: row.pinned === 1,
    archivedAt: row.archived_at ?? undefined,
    convertedTaskId: row.converted_task_id ?? undefined,
  })
}

/** Human project notes, kept backward-compatible with the original NextNote table/API. */
export class NextNoteStore {
  constructor(private readonly db: Db, private readonly now: () => string = () => new Date().toISOString()) {}

  add(projectId: string, text: string, now = this.now()): NextNote {
    const id = `note:${projectId}:${now}:${Math.random().toString(36).slice(2, 8)}`
    const note = NextNoteSchema.parse({
      id, projectId, text: text.trim(), createdAt: now, updatedAt: now, done: false, pinned: false,
    })
    this.db.prepare(
      `INSERT INTO next_notes
       (id, project_id, text, created_at, done, updated_at, pinned, archived_at, converted_task_id)
       VALUES (?, ?, ?, ?, 0, ?, 0, NULL, NULL)`,
    ).run(note.id, note.projectId, note.text, note.createdAt, note.updatedAt ?? note.createdAt)
    return this.get(note.id)!
  }

  get(id: string): NextNote | undefined {
    const row = this.db.prepare('SELECT * FROM next_notes WHERE id = ?').get(id) as Row | undefined
    return row ? toNote(row) : undefined
  }

  listByProject(
    projectId: string,
    opts: { includeDone?: boolean; includeCompleted?: boolean; includeArchived?: boolean } = {},
  ): NextNote[] {
    const includeCompleted = opts.includeCompleted ?? opts.includeDone ?? false
    const clauses = ['project_id = ?']
    if (!includeCompleted) clauses.push(opts.includeArchived ? '(done = 0 OR archived_at IS NOT NULL)' : 'done = 0')
    if (!opts.includeArchived) clauses.push('archived_at IS NULL')
    const rows = this.db.prepare(
      `SELECT * FROM next_notes
       WHERE ${clauses.join(' AND ')}
       ORDER BY pinned DESC, COALESCE(updated_at, created_at) DESC, id DESC`,
    ).all(projectId) as Row[]
    return rows.map(toNote)
  }

  updateText(projectId: string, id: string, text: string): NoteMutationResult {
    const note = this.get(id)
    if (!note) return { ok: false, reason: 'note-not-found' }
    if (note.projectId !== projectId) return { ok: false, reason: 'project-mismatch' }
    const normalized = text.trim()
    if (!normalized) return { ok: false, reason: 'empty-text' }
    this.db.prepare(
      'UPDATE next_notes SET text = ?, updated_at = ? WHERE id = ? AND project_id = ?',
    ).run(normalized, this.now(), id, projectId)
    return { ok: true, note: this.get(id)! }
  }

  setPinned(projectId: string, id: string, pinned: boolean): NoteMutationResult {
    const note = this.get(id)
    if (!note) return { ok: false, reason: 'note-not-found' }
    if (note.projectId !== projectId) return { ok: false, reason: 'project-mismatch' }
    this.db.prepare(
      'UPDATE next_notes SET pinned = ?, updated_at = ? WHERE id = ? AND project_id = ?',
    ).run(pinned ? 1 : 0, this.now(), id, projectId)
    return { ok: true, note: this.get(id)! }
  }

  setLifecycle(projectId: string, id: string, lifecycle: NextNoteLifecycle): NoteMutationResult {
    const note = this.get(id)
    if (!note) return { ok: false, reason: 'note-not-found' }
    if (note.projectId !== projectId) return { ok: false, reason: 'project-mismatch' }
    const now = this.now()
    if (lifecycle === 'archived') {
      // Keep done intact so restoring can return to the note's previous completion state.
      this.db.prepare(
        'UPDATE next_notes SET archived_at = ?, updated_at = ? WHERE id = ? AND project_id = ?',
      ).run(now, now, id, projectId)
    } else {
      this.db.prepare(
        'UPDATE next_notes SET done = ?, archived_at = NULL, updated_at = ? WHERE id = ? AND project_id = ?',
      ).run(lifecycle === 'completed' ? 1 : 0, now, id, projectId)
    }
    return { ok: true, note: this.get(id)! }
  }

  markConverted(projectId: string, id: string, taskId: string, at = this.now()): NoteMutationResult {
    const note = this.get(id)
    if (!note) return { ok: false, reason: 'note-not-found' }
    if (note.projectId !== projectId) return { ok: false, reason: 'project-mismatch' }
    this.db.prepare(
      `UPDATE next_notes
       SET converted_task_id = ?, archived_at = COALESCE(archived_at, ?), updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).run(taskId, at, at, id, projectId)
    return { ok: true, note: this.get(id)! }
  }

  /** Legacy compatibility wrapper. Completion removes the note from archive. */
  toggleDone(id: string, done: boolean): void {
    this.db.prepare(
      'UPDATE next_notes SET done = ?, archived_at = NULL, updated_at = ? WHERE id = ?',
    ).run(done ? 1 : 0, this.now(), id)
  }

  deleteForProject(projectId: string, id: string): NoteMutationResult {
    const note = this.get(id)
    if (!note) return { ok: false, reason: 'note-not-found' }
    if (note.projectId !== projectId) return { ok: false, reason: 'project-mismatch' }
    this.db.prepare('DELETE FROM next_notes WHERE id = ? AND project_id = ?').run(id, projectId)
    return { ok: true, note }
  }

  /** Legacy internal hard-delete wrapper. New IPC must call deleteForProject. */
  delete(id: string): void {
    this.db.prepare('DELETE FROM next_notes WHERE id = ?').run(id)
  }
}
