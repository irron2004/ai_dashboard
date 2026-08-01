import { z } from 'zod'
import { KnowledgeDocTypeSchema, KnowledgeStatusSchema } from './knowledge-schema.js'

const NonBlankStringSchema = z.string().trim().min(1)

function uniqueValues(values: string[], context: z.RefinementCtx, path: Array<string | number>): void {
  const seen = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate value: ${value}`,
        path: [...path, index],
      })
    }
    seen.add(value)
  }
}

export const RetrievalSourceKindSchema = z.enum(['session', 'knowledge'])
export type RetrievalSourceKind = z.infer<typeof RetrievalSourceKindSchema>

export const RetrievalAuthoritySchema = z.enum([
  'canonical',
  'accepted',
  'candidate',
  'raw',
  'deprecated',
  'unknown',
])
export type RetrievalAuthority = z.infer<typeof RetrievalAuthoritySchema>

export const RetrievalSignalsSchema = z.object({
  conflict: z.boolean(),
  stale: z.boolean(),
}).strict()
export type RetrievalSignals = z.infer<typeof RetrievalSignalsSchema>

export const RetrievalScopeSchema = z.object({
  projectIds: z.array(NonBlankStringSchema).min(1).superRefine((values, context) => {
    uniqueValues(values, context, [])
  }),
}).strict()
export type RetrievalScope = z.infer<typeof RetrievalScopeSchema>

export const RetrievalFiltersSchema = z.object({
  docTypes: z.array(KnowledgeDocTypeSchema).min(1).optional(),
  statuses: z.array(KnowledgeStatusSchema).min(1).optional(),
}).strict()
export type RetrievalFilters = z.infer<typeof RetrievalFiltersSchema>

export const RetrievalQuerySchema = z.object({
  text: NonBlankStringSchema,
  scope: RetrievalScopeSchema,
  limit: z.number().int().min(1).max(100),
  sourceKinds: z.array(RetrievalSourceKindSchema).min(1).superRefine((values, context) => {
    uniqueValues(values, context, [])
  }).optional(),
  filters: RetrievalFiltersSchema.optional(),
}).strict()
export type RetrievalQuery = z.infer<typeof RetrievalQuerySchema>

export const EvidenceCandidateSchema = z.object({
  candidateId: NonBlankStringSchema,
  parentId: NonBlankStringSchema,
  sourceKind: RetrievalSourceKindSchema,
  projectId: NonBlankStringSchema,
  title: NonBlankStringSchema,
  excerpt: z.string(),
  uri: NonBlankStringSchema,
  updatedAt: z.string().datetime({ offset: true }).optional(),
  sourceRank: z.number().int().min(1),
  rawScore: z.number().finite().optional(),
  fusedScore: z.number().finite().optional(),
  authority: RetrievalAuthoritySchema,
  signals: RetrievalSignalsSchema,
  reasons: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
}).strict()
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>

export const RetrieverErrorSchema = z.object({
  code: z.enum(['retriever-failed', 'invalid-candidate']),
  message: NonBlankStringSchema,
}).strict()
export type RetrieverError = z.infer<typeof RetrieverErrorSchema>

export const RetrieverDiagnosticSchema = z.object({
  id: NonBlankStringSchema,
  candidates: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  error: RetrieverErrorSchema.optional(),
}).strict()
export type RetrieverDiagnostic = z.infer<typeof RetrieverDiagnosticSchema>

export const RetrievalDiagnosticsSchema = z.object({
  retrievers: z.array(RetrieverDiagnosticSchema),
  droppedDuplicates: z.number().int().nonnegative(),
  droppedByCap: z.number().int().nonnegative(),
}).strict()
export type RetrievalDiagnostics = z.infer<typeof RetrievalDiagnosticsSchema>

export const RetrievalResponseSchema = z.object({
  query: RetrievalQuerySchema,
  evidence: z.array(EvidenceCandidateSchema),
  diagnostics: RetrievalDiagnosticsSchema,
}).strict().superRefine((response, context) => {
  const allowedProjects = new Set(response.query.scope.projectIds)
  for (const [index, item] of response.evidence.entries()) {
    if (!allowedProjects.has(item.projectId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `candidate project ${item.projectId} is outside query scope`,
        path: ['evidence', index, 'projectId'],
      })
    }
  }
})
export type RetrievalResponse = z.infer<typeof RetrievalResponseSchema>

// Compatibility boundary during Phase 1:
// SearchHit -> EvidenceCandidate(sourceKind=session)
// KnowledgeSearchHit -> EvidenceCandidate(sourceKind=knowledge)
// RetrievalResponse -> legacy UnifiedSearchResponse (temporary and intentionally lossy)
