import type { SourceCursor } from '@apc/shared'
import type { Db } from './db.js'

export class IngestCursorStore {
  constructor(private readonly db: Db) {}

  get(sourceId: string): SourceCursor | undefined {
    const row = this.db
      .prepare('SELECT source_id, cursor, updated_at FROM ingest_cursors WHERE source_id = ?')
      .get(sourceId) as { source_id: string; cursor: string; updated_at: string } | undefined
    if (!row) return undefined
    return { sourceId: row.source_id, position: row.cursor, updatedAt: row.updated_at }
  }

  set(sourceId: string, position: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ingest_cursors (source_id, cursor, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(sourceId, position)
  }
}
