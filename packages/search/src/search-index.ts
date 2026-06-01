import type { DatabaseSync } from 'node:sqlite'
import type { NormalizedSession } from '@apc/shared'

export type SearchHit = { sessionId: string; projectId: string; role: string; snippet: string }

export class SearchIndex {
  constructor(private readonly db: DatabaseSync) {
    // contentless-external columns kept simple: store values directly in FTS table
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts USING fts5(session_id, project_id, role, body)`)
  }

  indexSession(session: NormalizedSession): void {
    const projectId = session.projectId ?? ''
    this.db.prepare('DELETE FROM turn_fts WHERE session_id = ?').run(session.id)
    const ins = this.db.prepare('INSERT INTO turn_fts (session_id, project_id, role, body) VALUES (?, ?, ?, ?)')
    for (const t of session.turns) {
      if (!t.text.trim()) continue
      ins.run(session.id, projectId, t.role, t.text)
    }
  }

  search(query: string, opts: { projectId?: string } = {}): SearchHit[] {
    const sql = opts.projectId
      ? `SELECT session_id, project_id, role, snippet(turn_fts, 3, '[', ']', '…', 10) AS snip
         FROM turn_fts WHERE turn_fts MATCH ? AND project_id = ? ORDER BY rank`
      : `SELECT session_id, project_id, role, snippet(turn_fts, 3, '[', ']', '…', 10) AS snip
         FROM turn_fts WHERE turn_fts MATCH ? ORDER BY rank`
    const rows = (opts.projectId
      ? this.db.prepare(sql).all(query, opts.projectId)
      : this.db.prepare(sql).all(query)) as { session_id: string; project_id: string; role: string; snip: string }[]
    return rows.map((r) => ({ sessionId: r.session_id, projectId: r.project_id, role: r.role, snippet: r.snip }))
  }
}
