import { NextNoteSchema, type NextNote } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = { id: string; project_id: string; text: string; created_at: string; done: number }

function toNote(r: Row): NextNote {
  return NextNoteSchema.parse({
    id: r.id, projectId: r.project_id, text: r.text, createdAt: r.created_at, done: r.done === 1,
  })
}

/** Human "next-time" notes — deliberately separate from auto-extracted Tasks (no status/AC/priority). */
export class NextNoteStore {
  constructor(private readonly db: Db) {}

  add(projectId: string, text: string, now = new Date().toISOString()): NextNote {
    const id = `note:${projectId}:${now}:${Math.random().toString(36).slice(2, 8)}`
    const note = NextNoteSchema.parse({ id, projectId, text, createdAt: now, done: false })
    this.db.prepare(
      'INSERT INTO next_notes (id, project_id, text, created_at, done) VALUES (?, ?, ?, ?, ?)',
    ).run(note.id, note.projectId, note.text, note.createdAt, 0)
    return note
  }

  listByProject(projectId: string, opts: { includeDone?: boolean } = {}): NextNote[] {
    const rows = (opts.includeDone
      ? this.db.prepare('SELECT * FROM next_notes WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : this.db.prepare('SELECT * FROM next_notes WHERE project_id = ? AND done = 0 ORDER BY created_at DESC').all(projectId)) as Row[]
    return rows.map(toNote)
  }

  toggleDone(id: string, done: boolean): void {
    this.db.prepare('UPDATE next_notes SET done = ? WHERE id = ?').run(done ? 1 : 0, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM next_notes WHERE id = ?').run(id)
  }
}
