import type { ProjectRegistry, IngestCursorStore } from '@apc/core'
import type { SearchIndex } from '@apc/search'
import type { AgentIngestAdapter } from '@apc/agents'
import type { NormalizedSession } from '@apc/shared'
import type { KnowledgeIndexer } from './knowledge-indexer.js'

export type IngestDeps = {
  registry: ProjectRegistry
  cursors: IngestCursorStore
  index: SearchIndex
  knowledge?: Pick<KnowledgeIndexer, 'reindexAll'>
  /** Return accepted:false when a durable downstream proposal was not recorded; the cursor will retry. */
  onSessionParsed?: (
    session: NormalizedSession,
    projectId: string,
  ) => Promise<void | { accepted: boolean }>
  questionLog?: { record(session: NormalizedSession): void }
}
export type IngestResult = { sources: number; sessions: number; documents: number }

export class IngestService {
  constructor(private readonly deps: IngestDeps) {}
  private ingestLock: Promise<void> | null = null

  async ingestAll(adapters: AgentIngestAdapter[]): Promise<IngestResult> {
    while (this.ingestLock) {
      await this.ingestLock
    }
    let resolveLock = () => {}
    this.ingestLock = new Promise<void>((resolve) => { resolveLock = resolve })
    try {
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
          try { this.deps.questionLog?.record(withProject) }
          catch (e) { console.warn(`[ingest] questionLog.record failed for session ${withProject.id} (project ${withProject.projectId ?? '?'}):`, e) }
          let downstreamAccepted = true
          if (this.deps.onSessionParsed) {
            try {
              const downstream = await this.deps.onSessionParsed(withProject, withProject.projectId ?? '')
              downstreamAccepted = downstream?.accepted !== false
            }
            catch (e) { console.warn(`[ingest] onSessionParsed failed for session ${withProject.id} (project ${withProject.projectId ?? '?'}):`, e) }
          }
          if (downstreamAccepted) this.deps.cursors.set(source.id, position)
          else console.warn(`[ingest] downstream proposal deferred for session ${withProject.id}; cursor not advanced`)
          sessions++
        }
      }
      const { documents } = this.deps.knowledge?.reindexAll() ?? { documents: 0 }
      return { sources, sessions, documents }
    } finally {
      resolveLock()
      this.ingestLock = null
    }
  }
}
