import { ContextPackageSchema, type ContextPackage } from '@apc/shared'
import type { KnowledgeRetrieval } from './retrieval.js'

export type BuildContextPackageInput = { projectId: string; taskId: string; query: string; limit?: number }

export class ContextPackageBuilder {
  constructor(
    private readonly retrieval: KnowledgeRetrieval,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  build(input: BuildContextPackageInput): ContextPackage {
    const hits = this.retrieval.search({ projectId: input.projectId, query: input.query, limit: input.limit ?? 10 })
    const files = [...new Set(hits.map((hit) => hit.doc.relPath))]
    return ContextPackageSchema.parse({
      id: `ctx-${input.taskId}`,
      projectId: input.projectId,
      taskId: input.taskId,
      query: input.query,
      hits,
      files,
      generatedAt: this.now(),
    })
  }
}
