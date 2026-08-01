import { EvidenceCandidateSchema, type EvidenceCandidate, type RetrievalSourceKind } from '@apc/shared'
import { assertSameCandidateIdentity } from './types.js'

export type PostProcessOptions = {
  limit: number
  perParentCap: number
  sourceCaps: Readonly<Record<RetrievalSourceKind, number>>
  prioritizeAuthority?: boolean
}

export type PostProcessResult = {
  candidates: EvidenceCandidate[]
  droppedDuplicates: number
  droppedByCap: number
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function mergeDuplicate(current: EvidenceCandidate, next: EvidenceCandidate): EvidenceCandidate {
  assertSameCandidateIdentity(current, next)
  const winner = (next.fusedScore ?? 0) > (current.fusedScore ?? 0) ? next : current
  return EvidenceCandidateSchema.parse({
    ...winner,
    fusedScore: Math.max(current.fusedScore ?? 0, next.fusedScore ?? 0),
    signals: {
      conflict: current.signals.conflict || next.signals.conflict,
      stale: current.signals.stale || next.signals.stale,
    },
    reasons: unique([...current.reasons, ...next.reasons]),
    warnings: unique([...current.warnings, ...next.warnings]),
  })
}

function validateCap(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`)
}

const AUTHORITY_PRIORITY: Record<EvidenceCandidate['authority'], number> = {
  canonical: 5,
  accepted: 4,
  candidate: 3,
  raw: 2,
  unknown: 1,
  deprecated: 0,
}

/** Apply deterministic exact/parent dedupe, source caps, then the final result limit. */
export function postProcessCandidates(
  inputs: EvidenceCandidate[],
  options: PostProcessOptions,
): PostProcessResult {
  validateCap('limit', options.limit)
  validateCap('perParentCap', options.perParentCap)
  validateCap('session source cap', options.sourceCaps.session)
  validateCap('knowledge source cap', options.sourceCaps.knowledge)

  const ordered = inputs
    .map((item) => EvidenceCandidateSchema.parse(item))
    .sort((a, b) => (
      (b.fusedScore ?? 0) - (a.fusedScore ?? 0)
      || (options.prioritizeAuthority ? AUTHORITY_PRIORITY[b.authority] - AUTHORITY_PRIORITY[a.authority] : 0)
      || a.sourceRank - b.sourceRank
      || a.candidateId.localeCompare(b.candidateId)
    ))

  const byCandidate = new Map<string, EvidenceCandidate>()
  let droppedDuplicates = 0
  for (const item of ordered) {
    const existing = byCandidate.get(item.candidateId)
    if (existing) {
      byCandidate.set(item.candidateId, mergeDuplicate(existing, item))
      droppedDuplicates++
    } else {
      byCandidate.set(item.candidateId, item)
    }
  }

  const parentCounts = new Map<string, number>()
  const sourceCounts = new Map<RetrievalSourceKind, number>()
  const candidates: EvidenceCandidate[] = []
  let droppedByCap = 0

  for (const item of byCandidate.values()) {
    const parentCount = parentCounts.get(item.parentId) ?? 0
    if (parentCount >= options.perParentCap) {
      droppedDuplicates++
      continue
    }
    const sourceCount = sourceCounts.get(item.sourceKind) ?? 0
    if (sourceCount >= options.sourceCaps[item.sourceKind] || candidates.length >= options.limit) {
      droppedByCap++
      continue
    }
    candidates.push(item)
    parentCounts.set(item.parentId, parentCount + 1)
    sourceCounts.set(item.sourceKind, sourceCount + 1)
  }

  return { candidates, droppedDuplicates, droppedByCap }
}
