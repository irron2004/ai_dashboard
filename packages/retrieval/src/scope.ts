import type { EvidenceCandidate } from '@apc/shared'

export interface ProjectScopeRegistry {
  list(): Array<{ id: string }>
}

export type RetrievalScopeErrorCode =
  | 'empty-scope'
  | 'unknown-project'
  | 'candidate-outside-scope'

export class RetrievalScopeError extends Error {
  constructor(
    readonly code: RetrievalScopeErrorCode,
    readonly projectIds: string[],
    message: string,
  ) {
    super(message)
    this.name = 'RetrievalScopeError'
  }
}

function registeredIds(registry: ProjectScopeRegistry): string[] {
  return registry.list().map((project) => project.id)
}

export function validateProjectScope(
  registry: ProjectScopeRegistry,
  requestedProjectIds: string[],
): string[] {
  if (requestedProjectIds.length === 0) {
    throw new RetrievalScopeError('empty-scope', [], 'retrieval scope must contain at least one project')
  }
  const known = new Set(registeredIds(registry))
  const unknown = requestedProjectIds.filter((projectId) => !known.has(projectId))
  if (unknown.length > 0) {
    throw new RetrievalScopeError(
      'unknown-project',
      unknown,
      `retrieval scope contains unknown projects: ${unknown.join(', ')}`,
    )
  }
  return [...requestedProjectIds]
}

export function expandGlobalScope(registry: ProjectScopeRegistry): { projectIds: string[] } {
  const projectIds = registeredIds(registry)
  validateProjectScope(registry, projectIds)
  return { projectIds }
}

export function assertCandidatesInScope(
  candidates: EvidenceCandidate[],
  requestedProjectIds: string[],
): void {
  const allowed = new Set(requestedProjectIds)
  const outside = [...new Set(
    candidates.filter((candidate) => !allowed.has(candidate.projectId)).map((candidate) => candidate.projectId),
  )]
  if (outside.length > 0) {
    throw new RetrievalScopeError(
      'candidate-outside-scope',
      outside,
      `retriever returned candidates outside the requested scope: ${outside.join(', ')}`,
    )
  }
}
