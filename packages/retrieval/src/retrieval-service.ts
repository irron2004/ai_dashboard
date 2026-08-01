import {
  EvidenceCandidateSchema,
  RetrievalResponseSchema,
  RetrievalQuerySchema,
  RetrieverDiagnosticSchema,
  type EvidenceCandidate,
  type RetrievalQuery,
  type RetrievalResponse,
  type RetrieverDiagnostic,
} from '@apc/shared'
import { postProcessCandidates } from './post-process.js'
import { weightedRrf } from './rrf.js'
import {
  assertCandidatesInScope,
  validateProjectScope,
  type ProjectScopeRegistry,
} from './scope.js'
import {
  DEFAULT_RETRIEVAL_CORE_CONFIG,
  type RetrievalCoreConfig,
  type Retriever,
} from './types.js'

export class RetrievalUnavailableError extends Error {
  readonly code = 'retrieval-unavailable'

  constructor(readonly diagnostics: RetrieverDiagnostic[]) {
    super('all enabled retrievers failed')
    this.name = 'RetrievalUnavailableError'
  }
}

export type RetrievalServiceOptions = {
  retrievers: Retriever[]
  registry: ProjectScopeRegistry
  config?: Partial<Omit<RetrievalCoreConfig, 'retrieverWeights' | 'sourceCaps'>> & {
    retrieverWeights?: Readonly<Record<string, number>>
    sourceCaps?: Partial<RetrievalCoreConfig['sourceCaps']>
  }
  now?: () => number
}

function elapsedMs(startedAt: number, now: () => number): number {
  return Math.max(0, now() - startedAt)
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return (message.trim() || 'unknown retriever failure').slice(0, 500)
}

function validateRetrieverCandidates(retriever: Retriever, inputs: EvidenceCandidate[]): EvidenceCandidate[] {
  const candidates = inputs.map((candidate) => EvidenceCandidateSchema.parse(candidate))
  if (candidates.some((candidate) => candidate.sourceKind !== retriever.sourceKind)) {
    throw new TypeError(`retriever ${retriever.id} returned a mismatched sourceKind`)
  }
  if (candidates.length > 0) {
    const ranks = candidates.map((candidate) => candidate.sourceRank)
    if (Math.min(...ranks) !== 1 || new Set(ranks).size !== ranks.length) {
      throw new TypeError(`retriever ${retriever.id} must return unique source ranks beginning at 1`)
    }
  }
  return candidates
}

export class RetrievalService {
  private readonly retrievers: Retriever[]
  private readonly registry: ProjectScopeRegistry
  private readonly config: RetrievalCoreConfig
  private readonly now: () => number

  constructor(options: RetrievalServiceOptions) {
    if (options.retrievers.length === 0) throw new TypeError('at least one retriever is required')
    const ids = options.retrievers.map((retriever) => retriever.id)
    if (new Set(ids).size !== ids.length) throw new TypeError('retriever ids must be unique')
    this.retrievers = [...options.retrievers]
    this.registry = options.registry
    this.now = options.now ?? (() => performance.now())
    this.config = {
      ...DEFAULT_RETRIEVAL_CORE_CONFIG,
      ...options.config,
      retrieverWeights: {
        ...DEFAULT_RETRIEVAL_CORE_CONFIG.retrieverWeights,
        ...options.config?.retrieverWeights,
      },
      sourceCaps: {
        ...DEFAULT_RETRIEVAL_CORE_CONFIG.sourceCaps,
        ...options.config?.sourceCaps,
      },
    }
  }

  async search(input: RetrievalQuery): Promise<RetrievalResponse> {
    const query = RetrievalQuerySchema.parse(input)
    validateProjectScope(this.registry, query.scope.projectIds)
    const enabled = this.retrievers.filter((retriever) => (
      !query.sourceKinds || query.sourceKinds.includes(retriever.sourceKind)
    ))
    if (enabled.length === 0) throw new RetrievalUnavailableError([])

    const outcomes = await Promise.all(enabled.map(async (retriever) => {
      const startedAt = this.now()
      let rawCandidates: EvidenceCandidate[]
      try {
        rawCandidates = await retriever.search(query)
      } catch (error) {
        return {
          ok: false as const,
          retriever,
          candidates: [] as EvidenceCandidate[],
          diagnostic: RetrieverDiagnosticSchema.parse({
            id: retriever.id,
            candidates: 0,
            elapsedMs: elapsedMs(startedAt, this.now),
            error: { code: 'retriever-failed', message: safeErrorMessage(error) },
          }),
        }
      }

      try {
        const candidates = validateRetrieverCandidates(retriever, rawCandidates)
        assertCandidatesInScope(candidates, query.scope.projectIds)
        return {
          ok: true as const,
          retriever,
          candidates,
          diagnostic: RetrieverDiagnosticSchema.parse({
            id: retriever.id,
            candidates: candidates.length,
            elapsedMs: elapsedMs(startedAt, this.now),
          }),
        }
      } catch (error) {
        return {
          ok: false as const,
          retriever,
          candidates: [] as EvidenceCandidate[],
          diagnostic: RetrieverDiagnosticSchema.parse({
            id: retriever.id,
            candidates: 0,
            elapsedMs: elapsedMs(startedAt, this.now),
            error: {
              code: 'invalid-candidate',
              message: safeErrorMessage(error),
            },
          }),
        }
      }
    }))

    const diagnostics = outcomes.map((outcome) => outcome.diagnostic)
    const successful = outcomes.filter((outcome) => outcome.ok)
    if (successful.length === 0) throw new RetrievalUnavailableError(diagnostics)

    const fused = weightedRrf(successful.map((outcome) => ({
      retrieverId: outcome.retriever.id,
      candidates: outcome.candidates,
      weight: this.config.retrieverWeights[outcome.retriever.id] ?? 1,
    })), { k: this.config.rrfK })
    const processed = postProcessCandidates(fused, {
      limit: query.limit,
      perParentCap: this.config.perParentCap,
      sourceCaps: this.config.sourceCaps,
      prioritizeAuthority: true,
    })

    return RetrievalResponseSchema.parse({
      query,
      evidence: processed.candidates,
      diagnostics: {
        retrievers: diagnostics,
        droppedDuplicates: processed.droppedDuplicates,
        droppedByCap: processed.droppedByCap,
      },
    })
  }
}
