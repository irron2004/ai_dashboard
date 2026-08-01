import type { EvidenceCandidate, RetrievalQuery, RetrievalSourceKind } from '@apc/shared'

export interface Retriever {
  readonly id: string
  readonly sourceKind: RetrievalSourceKind
  search(query: RetrievalQuery): Promise<EvidenceCandidate[]>
}

export class CandidateIdentityConflictError extends Error {
  readonly code = 'candidate-identity-conflict'

  constructor(readonly candidateId: string) {
    super(`candidateId ${candidateId} refers to conflicting evidence identities`)
    this.name = 'CandidateIdentityConflictError'
  }
}

export function assertSameCandidateIdentity(
  left: EvidenceCandidate,
  right: EvidenceCandidate,
): void {
  if (
    left.candidateId === right.candidateId
    && (
      left.projectId !== right.projectId
      || left.parentId !== right.parentId
      || left.sourceKind !== right.sourceKind
      || left.uri !== right.uri
    )
  ) {
    throw new CandidateIdentityConflictError(left.candidateId)
  }
}

export type RankedCandidateSet = {
  retrieverId: string
  candidates: EvidenceCandidate[]
  weight?: number
  enabled?: boolean
}

export type RetrievalCoreConfig = {
  rrfK: number
  retrieverWeights: Readonly<Record<string, number>>
  perParentCap: number
  sourceCaps: Readonly<Record<RetrievalSourceKind, number>>
}

export const DEFAULT_RETRIEVAL_CORE_CONFIG: RetrievalCoreConfig = {
  rrfK: 60,
  retrieverWeights: {},
  perParentCap: 1,
  sourceCaps: { session: 5, knowledge: 5 },
}
