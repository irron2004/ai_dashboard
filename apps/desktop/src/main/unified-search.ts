import type { RetrievalResponse, UnifiedSearchHit, UnifiedSearchResponse } from '@apc/shared'
import {
  RetrievalScopeError,
  RetrievalUnavailableError,
  type RetrievalService,
} from '@apc/retrieval'
import type {
  SearchEvidenceReq,
  SearchEvidenceRes,
  SearchReq,
} from '../shared/ipc-contract.js'

type RetrievalSearch = Pick<RetrievalService, 'search'>

export type UnifiedSearchDeps = {
  retrieval: RetrievalSearch
  /** Returns the projects registered in the desktop control plane. */
  projectIds: () => string[]
}

function explicitProjectScope(deps: UnifiedSearchDeps, projectId?: string): string[] {
  if (projectId) return [projectId]
  return [...new Set(deps.projectIds())]
}

function toLegacyResponse(response: RetrievalResponse): UnifiedSearchResponse {
  const hits: UnifiedSearchHit[] = response.evidence.map((candidate) => ({
    kind: candidate.sourceKind,
    id: candidate.parentId,
    title: candidate.title,
    excerpt: candidate.excerpt,
    projectId: candidate.projectId,
  }))
  return { query: response.query.text, hits }
}

/**
 * Desktop boundary for the evidence-rich retrieval service.
 *
 * `searchEvidence` is the canonical path. `search` is an intentionally lossy compatibility
 * adapter for q:search and must not be used by new consumers.
 */
export class UnifiedSearch {
  constructor(private readonly deps: UnifiedSearchDeps) {}

  async searchEvidence(input: SearchEvidenceReq): Promise<SearchEvidenceRes> {
    const query = input.query.trim()
    if (!query) throw new TypeError('search query must not be blank')
    const projectIds = explicitProjectScope(this.deps, input.projectId)
    if (projectIds.length === 0) {
      return {
        ok: false,
        evidence: [],
        diagnostic: {
          code: 'no-registered-projects',
          message: '검색할 등록 프로젝트가 없습니다.',
          retrievers: [],
        },
      }
    }

    try {
      const response = await this.deps.retrieval.search({
        text: query,
        scope: { projectIds },
        limit: input.limit ?? 20,
      })
      return { ok: true, response }
    } catch (error) {
      if (error instanceof RetrievalScopeError && error.code === 'unknown-project') {
        return {
          ok: false,
          evidence: [],
          diagnostic: {
            code: 'unknown-project',
            message: `등록되지 않은 프로젝트는 검색할 수 없습니다: ${error.projectIds.join(', ')}`,
            retrievers: [],
          },
        }
      }
      if (error instanceof RetrievalUnavailableError) {
        return {
          ok: false,
          evidence: [],
          diagnostic: {
            code: 'retrieval-unavailable',
            message: '모든 검색 소스를 현재 사용할 수 없습니다.',
            retrievers: error.diagnostics,
          },
        }
      }
      return {
        ok: false,
        evidence: [],
        diagnostic: {
          code: 'retrieval-unavailable',
          message: '검색 서비스를 현재 사용할 수 없습니다.',
          retrievers: [],
        },
      }
    }
  }

  /** @deprecated Use searchEvidence. This adapter discards URI, authority, signals and diagnostics. */
  async search(input: SearchReq): Promise<UnifiedSearchResponse> {
    const query = input.query.trim()
    if (!query) return { query, hits: [] }
    const result = await this.searchEvidence({ query, projectId: input.projectId })
    return result.ok ? toLegacyResponse(result.response) : { query, hits: [] }
  }
}
