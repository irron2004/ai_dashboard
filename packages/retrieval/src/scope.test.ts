import { describe, expect, test } from 'vitest'
import type { EvidenceCandidate } from '@apc/shared'
import {
  RetrievalScopeError,
  assertCandidatesInScope,
  expandGlobalScope,
  validateProjectScope,
} from './scope.js'

const registry = { list: () => [{ id: 'p1' }, { id: 'p2' }] }

function candidate(projectId: string): EvidenceCandidate {
  return {
    candidateId: `candidate:${projectId}`,
    parentId: `parent:${projectId}`,
    sourceKind: 'knowledge',
    projectId,
    title: projectId,
    excerpt: projectId,
    uri: `pmw://project/${projectId}/doc.md#chunk-0`,
    sourceRank: 1,
    authority: 'candidate',
    signals: { conflict: false, stale: false },
    reasons: [],
    warnings: [],
  }
}

describe('retrieval scope', () => {
  test('rejects an empty scope', () => {
    expect(() => validateProjectScope(registry, [])).toThrowError(
      expect.objectContaining({ code: 'empty-scope' }),
    )
  })

  test('rejects an unknown project instead of ignoring it', () => {
    expect(() => validateProjectScope(registry, ['missing'])).toThrowError(
      expect.objectContaining({ code: 'unknown-project', projectIds: ['missing'] }),
    )
  })

  test('rejects the whole mixed scope when one project is unknown', () => {
    expect(() => validateProjectScope(registry, ['p1', 'missing'])).toThrow(RetrievalScopeError)
  })

  test('expands global search explicitly to current registered IDs', () => {
    expect(expandGlobalScope(registry)).toEqual({ projectIds: ['p1', 'p2'] })
  })

  test('rejects candidate output outside the requested scope', () => {
    expect(() => assertCandidatesInScope([candidate('p2')], ['p1'])).toThrowError(
      expect.objectContaining({ code: 'candidate-outside-scope', projectIds: ['p2'] }),
    )
  })
})
