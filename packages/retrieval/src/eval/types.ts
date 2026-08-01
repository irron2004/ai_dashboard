import type { KnowledgeStatus, RetrievalSourceKind } from '@apc/shared'

export type RetrievalEvaluationFixture = {
  version: number
  format?: string
  projects: string[]
  sessions: Array<{ id: string; projectId: string; text: string }>
  documents: Array<{
    projectId: string
    relPath: string
    status: KnowledgeStatus
    markdown: string
  }>
  queries: Array<{
    id: string
    text: string
    scope: string[]
    relevantParents: string[]
  }>
}

export type LegacyEvaluationBaseline = {
  fixtureVersion: number
  rankings: Array<Pick<EvaluationRanking, 'queryId' | 'results'>>
  metrics: RetrievalQualityMetrics
}

export type EvaluationResultItem = {
  parentId: string
  projectId: string
  sourceKind: RetrievalSourceKind
  uri: string | null
}

export type EvaluationRanking = {
  queryId: string
  scopeProjectIds: string[]
  relevantParentIds: string[]
  results: EvaluationResultItem[]
}

export type RetrievalQualityMetrics = {
  evaluatedQueries: number
  recallAt5: number
  recallAt10: number
  mrr: number
  duplicateParentOccupancy: number
  citationCompleteness: number
  scopeLeakage: number
  scopeLeakageCount: number
  resultCount: number
  sourceDistribution: Record<RetrievalSourceKind, number>
}

export type RetrievalReleaseThresholds = {
  maxParentOccupancy: number
  minimumCitationCompleteness: number
  maximumScopeLeakage: number
}

export type RetrievalEvaluationReport = {
  fixtureVersion: number
  queryCount: number
  legacy: RetrievalQualityMetrics
  current: RetrievalQualityMetrics
  thresholds: RetrievalReleaseThresholds
  passed: boolean
  failures: string[]
}
