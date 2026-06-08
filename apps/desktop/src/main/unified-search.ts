import type { SearchIndex } from '@apc/search'
import type { KnowledgeRetrieval } from '@apc/knowledge'
import type { UnifiedSearchResponse, UnifiedSearchHit } from '@apc/shared'

/**
 * Composes session + knowledge indexes into one normalized response.
 * Session hits come first, then knowledge hits appended per project.
 * NOTE: `knowledge` requires either `input.projectId` or `deps.projectIds` to produce
 * results — KnowledgeRetrieval is project-scoped, so a global search with `knowledge`
 * but no `projectIds` yields session hits only. Each project contributes up to 10 knowledge hits.
 */
export class UnifiedSearch {
  constructor(
    private readonly deps: {
      sessions: SearchIndex
      knowledge?: KnowledgeRetrieval
      projectIds?: () => string[]
    },
  ) {}

  search(input: { query: string; projectId?: string }): UnifiedSearchResponse {
    const query = input.query.trim()
    if (!query) return { query, hits: [] }

    const sessionHits = this.deps.sessions.search(query, input.projectId ? { projectId: input.projectId } : {})
    const hits: UnifiedSearchHit[] = sessionHits.map((h) => ({
      kind: 'session',
      id: h.sessionId,
      title: h.sessionId,
      excerpt: h.snippet,
      projectId: h.projectId,
    }))

    if (this.deps.knowledge) {
      const projectIds = input.projectId ? [input.projectId] : (this.deps.projectIds?.() ?? [])
      for (const projectId of projectIds) {
        let knowledgeHits
        try {
          knowledgeHits = this.deps.knowledge.search({ projectId, query, limit: 10 })
        } catch {
          continue // FTS MATCH parse error etc. → skip this project only
        }
        for (const hit of knowledgeHits) {
          hits.push({
            kind: hit.doc.docType,
            id: hit.doc.id,
            title: hit.doc.title,
            excerpt: hit.chunk.body.slice(0, 200),
            projectId: hit.doc.projectId,
            score: hit.score,
          })
        }
      }
    }

    return { query, hits }
  }
}
