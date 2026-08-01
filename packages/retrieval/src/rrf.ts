import { EvidenceCandidateSchema, type EvidenceCandidate } from '@apc/shared'
import { assertSameCandidateIdentity, type RankedCandidateSet } from './types.js'

export type WeightedRrfOptions = {
  k?: number
  weights?: Readonly<Record<string, number>>
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function chooseRepresentative(
  current: { candidate: EvidenceCandidate; retrieverId: string } | undefined,
  next: EvidenceCandidate,
  retrieverId: string,
): { candidate: EvidenceCandidate; retrieverId: string } {
  if (!current) return { candidate: next, retrieverId }
  if (next.sourceRank < current.candidate.sourceRank) return { candidate: next, retrieverId }
  if (next.sourceRank > current.candidate.sourceRank) return current
  return retrieverId.localeCompare(current.retrieverId) < 0 ? { candidate: next, retrieverId } : current
}

/**
 * Fuse source-local rankings without comparing their raw score spaces.
 * Inputs and their candidate objects are never mutated.
 */
export function weightedRrf(
  sets: RankedCandidateSet[],
  options: WeightedRrfOptions = {},
): EvidenceCandidate[] {
  const k = options.k ?? 60
  if (!Number.isFinite(k) || k < 0) throw new RangeError('RRF k must be a finite non-negative number')

  const aggregates = new Map<string, {
    score: number
    representative?: { candidate: EvidenceCandidate; retrieverId: string }
    reasons: string[]
    warnings: string[]
    conflict: boolean
    stale: boolean
  }>()

  const orderedSets = [...sets].sort((a, b) => a.retrieverId.localeCompare(b.retrieverId))
  for (const set of orderedSets) {
    if (set.enabled === false) continue
    const weight = set.weight ?? options.weights?.[set.retrieverId] ?? 1
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`retriever weight must be finite and non-negative: ${set.retrieverId}`)
    }
    if (weight === 0) continue

    for (const input of set.candidates) {
      const candidate = EvidenceCandidateSchema.parse(input)
      const contribution = weight / (k + candidate.sourceRank)
      const aggregate = aggregates.get(candidate.candidateId) ?? {
        score: 0,
        reasons: [],
        warnings: [],
        conflict: false,
        stale: false,
      }
      if (aggregate.representative) {
        assertSameCandidateIdentity(aggregate.representative.candidate, candidate)
      }
      aggregate.score += contribution
      aggregate.representative = chooseRepresentative(aggregate.representative, candidate, set.retrieverId)
      aggregate.reasons.push(...candidate.reasons, `rrf:${set.retrieverId}:rank=${candidate.sourceRank}:weight=${weight}`)
      aggregate.warnings.push(...candidate.warnings)
      aggregate.conflict ||= candidate.signals.conflict
      aggregate.stale ||= candidate.signals.stale
      aggregates.set(candidate.candidateId, aggregate)
    }
  }

  return [...aggregates.values()]
    .map((aggregate) => {
      const representative = aggregate.representative?.candidate
      if (!representative) throw new Error('RRF aggregate has no representative')
      return EvidenceCandidateSchema.parse({
        ...representative,
        fusedScore: aggregate.score,
        signals: { conflict: aggregate.conflict, stale: aggregate.stale },
        reasons: unique(aggregate.reasons),
        warnings: unique(aggregate.warnings),
      })
    })
    .sort((a, b) => (b.fusedScore ?? 0) - (a.fusedScore ?? 0) || a.candidateId.localeCompare(b.candidateId))
}
