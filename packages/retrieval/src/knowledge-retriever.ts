import {
  EvidenceCandidateSchema,
  type EvidenceCandidate,
  type KnowledgeSearchHit,
  type KnowledgeStatus,
  type RetrievalAuthority,
  type RetrievalQuery,
} from '@apc/shared'
import type { KnowledgeRetrieval } from '@apc/knowledge'
import { buildPlainTextFtsQuery } from '@apc/search'
import type { Retriever } from './types.js'

export type KnowledgeFtsRetrieverOptions = {
  candidateLimitMultiplier?: number
}

function authorityFor(status: KnowledgeStatus): RetrievalAuthority {
  switch (status) {
    case 'canonical':
    case 'accepted':
    case 'candidate':
      return status
    case 'superseded':
    case 'deprecated':
      return 'deprecated'
    case 'conflict':
    case 'unknown':
      return 'unknown'
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export class KnowledgeFtsRetriever implements Retriever {
  readonly id = 'knowledge-fts'
  readonly sourceKind = 'knowledge' as const
  private readonly candidateLimitMultiplier: number

  constructor(
    private readonly retrieval: Pick<KnowledgeRetrieval, 'searchLexical'>,
    options: KnowledgeFtsRetrieverOptions = {},
  ) {
    this.candidateLimitMultiplier = options.candidateLimitMultiplier ?? 5
    if (!Number.isInteger(this.candidateLimitMultiplier) || this.candidateLimitMultiplier < 1) {
      throw new RangeError('candidateLimitMultiplier must be a positive integer')
    }
  }

  async search(query: RetrievalQuery): Promise<EvidenceCandidate[]> {
    if (query.sourceKinds && !query.sourceKinds.includes('knowledge')) return []
    const matchQuery = buildPlainTextFtsQuery(query.text)
    if (!matchQuery) return []
    const perProjectLimit = Math.min(1000, query.limit * this.candidateLimitMultiplier)
    const hits: KnowledgeSearchHit[] = []
    for (const projectId of query.scope.projectIds) {
      hits.push(...this.retrieval.searchLexical({ projectId, query: matchQuery, limit: perProjectLimit }))
    }

    const filtered = hits
      .filter((hit) => !query.filters?.docTypes || query.filters.docTypes.includes(hit.doc.docType))
      .filter((hit) => !query.filters?.statuses || query.filters.statuses.includes(hit.doc.status))
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))

    return filtered.map((hit, index) => this.mapHit(hit, index + 1))
  }

  private mapHit(hit: KnowledgeSearchHit, sourceRank: number): EvidenceCandidate {
    const conflict = hit.doc.status === 'conflict'
    const deprecated = hit.doc.status === 'deprecated' || hit.doc.status === 'superseded'
    const warnings = unique([
      ...hit.warnings,
      ...(conflict ? ['conflict-document'] : []),
      ...(deprecated ? ['deprecated-document'] : []),
    ])
    const base = {
      candidateId: hit.chunk.id,
      parentId: hit.doc.id,
      sourceKind: 'knowledge' as const,
      projectId: hit.doc.projectId,
      title: hit.doc.title,
      excerpt: hit.chunk.body.slice(0, 500),
      uri: hit.chunk.uri,
      sourceRank,
      rawScore: hit.score,
      authority: authorityFor(hit.doc.status),
      signals: { conflict, stale: false },
      reasons: unique(['fts:knowledge', ...hit.reasons]),
      warnings,
    }
    const withTimestamp = EvidenceCandidateSchema.safeParse({ ...base, updatedAt: hit.doc.updatedAt })
    if (withTimestamp.success) return withTimestamp.data
    return EvidenceCandidateSchema.parse({
      ...base,
      warnings: unique([...warnings, 'invalid-knowledge-timestamp']),
    })
  }
}
