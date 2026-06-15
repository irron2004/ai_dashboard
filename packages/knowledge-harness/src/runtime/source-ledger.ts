/**
 * Port for tracking which source documents a project has already consumed in wiki generation.
 *
 * The harness stays storage-agnostic: the concrete implementation (SQLite-backed
 * ProcessedSourceStore in @apc/knowledge) is injected via DriverDeps. With a ledger present,
 * makeDrivers skips sources already processed (same id + same content hash) and records the
 * sources it consumed once a run reaches HUMAN_REVIEW_REQUIRED — so a re-requested or resumed
 * generation re-processes only new or changed sources instead of redoing everything.
 */
export interface SourceLedger {
  /** True iff this exact source (same id AND same content hash) was already processed for the project. */
  isProcessed(projectId: string, sourceId: string, sourceHash: string): boolean
  /** Record sources as processed for the project (upsert by source_id; no-op on an empty list). */
  markProcessed(
    projectId: string,
    runId: string,
    sources: ReadonlyArray<{ sourceId: string; sourceHash: string }>,
    at: string,
  ): void
}
