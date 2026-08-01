import type {
  EvaluationRanking,
  RetrievalQualityMetrics,
  RetrievalReleaseThresholds,
} from './types.js'

function rounded(value: number): number {
  return Number(value.toFixed(6))
}

function recallAt(ranking: EvaluationRanking, k: number): number {
  const relevant = new Set(ranking.relevantParentIds)
  if (relevant.size === 0) return 1
  const found = new Set(
    ranking.results.slice(0, k)
      .map((result) => result.parentId)
      .filter((parentId) => relevant.has(parentId)),
  )
  return found.size / relevant.size
}

function reciprocalRank(ranking: EvaluationRanking): number {
  const relevant = new Set(ranking.relevantParentIds)
  if (relevant.size === 0) return 1
  const index = ranking.results.findIndex((result) => relevant.has(result.parentId))
  return index === -1 ? 0 : 1 / (index + 1)
}

export function evaluateRankings(rankings: readonly EvaluationRanking[]): RetrievalQualityMetrics {
  const judged = rankings.filter((ranking) => ranking.relevantParentIds.length > 0)
  const results = rankings.flatMap((ranking) => ranking.results)
  let duplicateParentOccupancy = 0
  let scopeLeakageCount = 0

  for (const ranking of rankings) {
    const parentCounts = new Map<string, number>()
    const scope = new Set(ranking.scopeProjectIds)
    for (const result of ranking.results) {
      const count = (parentCounts.get(result.parentId) ?? 0) + 1
      parentCounts.set(result.parentId, count)
      duplicateParentOccupancy = Math.max(duplicateParentOccupancy, count)
      if (!scope.has(result.projectId)) scopeLeakageCount++
    }
  }

  const divisor = judged.length || 1
  const cited = results.filter((result) => typeof result.uri === 'string' && result.uri.trim()).length
  return {
    evaluatedQueries: judged.length,
    recallAt5: rounded(judged.length ? judged.reduce((sum, ranking) => sum + recallAt(ranking, 5), 0) / divisor : 1),
    recallAt10: rounded(judged.length ? judged.reduce((sum, ranking) => sum + recallAt(ranking, 10), 0) / divisor : 1),
    mrr: rounded(judged.length ? judged.reduce((sum, ranking) => sum + reciprocalRank(ranking), 0) / divisor : 1),
    duplicateParentOccupancy,
    citationCompleteness: rounded(results.length ? cited / results.length : 1),
    scopeLeakage: rounded(results.length ? scopeLeakageCount / results.length : 0),
    scopeLeakageCount,
    resultCount: results.length,
    sourceDistribution: {
      session: results.filter((result) => result.sourceKind === 'session').length,
      knowledge: results.filter((result) => result.sourceKind === 'knowledge').length,
    },
  }
}

export function releaseThresholdFailures(
  current: RetrievalQualityMetrics,
  legacy: RetrievalQualityMetrics,
  thresholds: RetrievalReleaseThresholds,
): string[] {
  const failures: string[] = []
  const epsilon = 1e-9
  if (current.scopeLeakage > thresholds.maximumScopeLeakage + epsilon) {
    failures.push(`scope leakage ${current.scopeLeakage} exceeds ${thresholds.maximumScopeLeakage}`)
  }
  if (current.citationCompleteness + epsilon < thresholds.minimumCitationCompleteness) {
    failures.push(`citation completeness ${current.citationCompleteness} is below ${thresholds.minimumCitationCompleteness}`)
  }
  if (current.duplicateParentOccupancy > thresholds.maxParentOccupancy) {
    failures.push(`duplicate parent occupancy ${current.duplicateParentOccupancy} exceeds ${thresholds.maxParentOccupancy}`)
  }
  if (current.recallAt5 + epsilon < legacy.recallAt5) {
    failures.push(`Recall@5 ${current.recallAt5} regressed below legacy ${legacy.recallAt5}`)
  }
  if (current.mrr + epsilon < legacy.mrr) {
    failures.push(`MRR ${current.mrr} regressed below legacy ${legacy.mrr}`)
  }
  return failures
}
