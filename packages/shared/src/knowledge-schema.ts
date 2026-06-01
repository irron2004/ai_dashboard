import { z } from 'zod'

export const KnowledgeDocTypeSchema = z.enum([
  'current', 'task', 'review', 'decision', 'wiki', 'agent-run', 'reference', 'conflict', 'unknown',
])
export type KnowledgeDocType = z.infer<typeof KnowledgeDocTypeSchema>

export const KnowledgeStatusSchema = z.enum([
  'canonical', 'accepted', 'candidate', 'superseded', 'deprecated', 'conflict', 'unknown',
])
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>

export const KnowledgeCollectionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  include: z.array(z.string()).default(['**/*.md']),
  exclude: z.array(z.string()).default([]),
  includeByDefault: z.boolean().default(true),
})
export type KnowledgeCollection = z.infer<typeof KnowledgeCollectionSchema>

export const KnowledgeContextNodeSchema = z.object({
  collectionId: z.string().min(1),
  pathPrefix: z.string().min(1),
  description: z.string().min(1),
  docType: KnowledgeDocTypeSchema.default('unknown'),
  statusHint: KnowledgeStatusSchema.default('unknown'),
})
export type KnowledgeContextNode = z.infer<typeof KnowledgeContextNodeSchema>

export const KnowledgeDocumentSchema = z.object({
  id: z.string().min(1),
  collectionId: z.string().min(1),
  projectId: z.string().min(1),
  uri: z.string().min(1),
  relPath: z.string().min(1),
  title: z.string().min(1),
  docType: KnowledgeDocTypeSchema.default('unknown'),
  status: KnowledgeStatusSchema.default('unknown'),
  hash: z.string().min(1),
  updatedAt: z.string().min(1),
  contextText: z.string().default(''),
})
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>

export const KnowledgeChunkSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  projectId: z.string().min(1),
  uri: z.string().min(1),
  headingPath: z.array(z.string()).default([]),
  body: z.string(),
  ordinal: z.number().int().nonnegative(),
  tokenEstimate: z.number().int().nonnegative(),
  contextText: z.string().default(''),
})
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>

export const KnowledgeSearchHitSchema = z.object({
  doc: KnowledgeDocumentSchema,
  chunk: KnowledgeChunkSchema,
  score: z.number(),
  reasons: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})
export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHitSchema>

export const ContextPackageSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  query: z.string().min(1),
  hits: z.array(KnowledgeSearchHitSchema).default([]),
  files: z.array(z.string()).default([]),
  generatedAt: z.string().min(1),
})
export type ContextPackage = z.infer<typeof ContextPackageSchema>
