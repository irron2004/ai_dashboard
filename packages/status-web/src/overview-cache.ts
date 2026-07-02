import type { WorkspaceOverview } from '@apc/dashboard-api'

export type CachedOverview = { overview: WorkspaceOverview; stale: boolean }

/**
 * Rebuilds the workspace overview on demand with a short TTL, and — because the
 * desktop writes the same sqlite file concurrently — falls back to the last good
 * snapshot (flagged `stale`) if a rebuild throws (e.g. transient SQLITE_BUSY).
 */
export class OverviewCache {
  private last?: { overview: WorkspaceOverview; at: number }
  constructor(
    private readonly build: () => WorkspaceOverview,
    private readonly ttlMs = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  get(): CachedOverview {
    const t = this.now()
    if (this.last && t - this.last.at < this.ttlMs) return { overview: this.last.overview, stale: false }
    try {
      const overview = this.build()
      this.last = { overview, at: t }
      return { overview, stale: false }
    } catch (err) {
      if (this.last) return { overview: this.last.overview, stale: true }
      throw err
    }
  }
}
