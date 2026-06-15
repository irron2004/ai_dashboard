import type { Db } from '@apc/core'

/** One source document the wiki harness has already consumed for a project. */
export type ProcessedSource = { projectId: string; sourceId: string; sourceHash: string; runId: string; processedAt: string }

type Row = { project_id: string; source_id: string; source_hash: string; run_id: string; processed_at: string }

/**
 * Tracks which source documents (the `raw/` files the LLM explores to build the wiki) a project's
 * harness runs have already processed, keyed by `source_id` with the content `source_hash`.
 *
 * Purpose: make wiki generation idempotent/incremental. A re-requested or resumed run can SKIP
 * sources it already consumed (`isProcessed` true) and re-process only those whose content changed
 * (hash differs). This is the persistence behind the `SourceLedger` port the harness drivers use.
 */
export class ProcessedSourceStore {
  constructor(private readonly db: Db) {}

  /** True iff this exact source (same id AND same content hash) is already recorded for the project. */
  isProcessed(projectId: string, sourceId: string, sourceHash: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS one FROM wiki_processed_sources WHERE project_id = ? AND source_id = ? AND source_hash = ?')
      .get(projectId, sourceId, sourceHash)
    return row !== undefined
  }

  /** Record sources as processed for the project. Upsert by (project_id, source_id): a changed source
   *  overwrites its prior hash so the latest consumed content wins. No-op on an empty list. */
  markProcessed(projectId: string, runId: string, sources: ReadonlyArray<{ sourceId: string; sourceHash: string }>, at: string): void {
    if (sources.length === 0) return
    const stmt = this.db.prepare(`INSERT OR REPLACE INTO wiki_processed_sources
      (project_id, source_id, source_hash, run_id, processed_at) VALUES (?, ?, ?, ?, ?)`)
    for (const s of sources) stmt.run(projectId, s.sourceId, s.sourceHash, runId, at)
  }

  /** All recorded sources for a project (newest run first is not guaranteed; ordered by source_id). */
  listProcessed(projectId: string): ProcessedSource[] {
    const rows = this.db
      .prepare('SELECT * FROM wiki_processed_sources WHERE project_id = ? ORDER BY source_id')
      .all(projectId) as Row[]
    return rows.map((r) => ({ projectId: r.project_id, sourceId: r.source_id, sourceHash: r.source_hash, runId: r.run_id, processedAt: r.processed_at }))
  }

  /** Forget all processed-source records for a project, forcing the next run to re-process everything. */
  clearProject(projectId: string): void {
    this.db.prepare('DELETE FROM wiki_processed_sources WHERE project_id = ?').run(projectId)
  }
}
