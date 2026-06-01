import type { ProjectRegistry, IngestCursorStore } from '@apc/core'
import type { SearchIndex } from '@apc/search'
import type { AgentIngestAdapter } from '@apc/agents'

export type IngestDeps = { registry: ProjectRegistry; cursors: IngestCursorStore; index: SearchIndex }
export type IngestResult = { sources: number; sessions: number }

export class IngestService {
  constructor(private readonly deps: IngestDeps) {}

  async ingestAll(adapters: AgentIngestAdapter[]): Promise<IngestResult> {
    let sources = 0, sessions = 0
    for (const adapter of adapters) {
      const found = await adapter.discoverSources((id) => this.deps.cursors.get(id))
      sources += found.length
      for (const source of found) {
        const { session, position } = await adapter.parseSource(source)
        const repoPath = session.repoPath ?? source.repoPath
        const project = repoPath ? this.deps.registry.findByRepoPath(repoPath) : undefined
        const withProject = { ...session, projectId: project?.id ?? session.projectId }
        this.deps.index.indexSession(withProject)
        this.deps.cursors.set(source.id, position)
        sessions++
      }
    }
    return { sources, sessions }
  }
}
