import {
  EvidenceCandidateSchema,
  type EvidenceCandidate,
  type RetrievalQuery,
} from '@apc/shared'
import type { SearchIndex } from '@apc/search'
import type { Retriever } from './types.js'

export type SessionFtsRetrieverOptions = {
  candidateLimitMultiplier?: number
}

export class SessionFtsRetriever implements Retriever {
  readonly id = 'session-fts'
  readonly sourceKind = 'session' as const
  private readonly candidateLimitMultiplier: number

  constructor(
    private readonly index: Pick<SearchIndex, 'search'>,
    options: SessionFtsRetrieverOptions = {},
  ) {
    this.candidateLimitMultiplier = options.candidateLimitMultiplier ?? 5
    if (!Number.isInteger(this.candidateLimitMultiplier) || this.candidateLimitMultiplier < 1) {
      throw new RangeError('candidateLimitMultiplier must be a positive integer')
    }
  }

  async search(query: RetrievalQuery): Promise<EvidenceCandidate[]> {
    if (query.sourceKinds && !query.sourceKinds.includes('session')) return []
    const searchLimit = Math.min(1000, query.limit * this.candidateLimitMultiplier)
    const hits = this.index.search(query.text, {
      projectIds: query.scope.projectIds,
      limit: searchLimit,
    })

    return hits.map((hit, index) => {
      const encodedSessionId = encodeURIComponent(hit.sessionId)
      const base = {
        candidateId: `session:${encodedSessionId}:turn:${hit.turnOrdinal}`,
        parentId: `session:${encodedSessionId}`,
        sourceKind: 'session' as const,
        projectId: hit.projectId,
        title: `Session ${hit.sessionId}`,
        excerpt: hit.snippet,
        uri: hit.uri,
        sourceRank: index + 1,
        rawScore: hit.rawScore,
        authority: 'raw' as const,
        signals: { conflict: false, stale: false },
        reasons: ['fts:session', `role:${hit.role}`],
        warnings: [] as string[],
      }
      if (!hit.timestamp) return EvidenceCandidateSchema.parse(base)

      const withTimestamp = EvidenceCandidateSchema.safeParse({ ...base, updatedAt: hit.timestamp })
      if (withTimestamp.success) return withTimestamp.data
      return EvidenceCandidateSchema.parse({
        ...base,
        warnings: ['invalid-session-timestamp'],
      })
    })
  }
}
