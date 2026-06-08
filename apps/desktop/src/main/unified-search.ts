import type { SearchIndex } from '@apc/search'
import type { UnifiedSearchResponse } from '@apc/shared'

/** Composes the result sets of the indexes into one normalized response.
 *  Session index is live; knowledge is a slot filled by sub-project B (`deps.knowledge`). */
export class UnifiedSearch {
  constructor(private readonly deps: { sessions: SearchIndex }) {}

  search(input: { query: string; projectId?: string }): UnifiedSearchResponse {
    const query = input.query.trim()
    if (!query) return { query, hits: [] }
    const sessionHits = this.deps.sessions.search(query, input.projectId ? { projectId: input.projectId } : {})
    const hits = sessionHits.map((h) => ({
      kind: 'session', id: h.sessionId, title: h.sessionId, excerpt: h.snippet, projectId: h.projectId,
    }))
    // knowledge hits = [] until sub-project B
    return { query, hits }
  }
}
