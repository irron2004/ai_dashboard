import { beforeEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, ProjectRegistry, IngestCursorStore, type Db } from '@apc/core'
import { SearchIndex } from '@apc/search'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'
import { IngestService } from './ingest-service.js'

class FakeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'claude' as const
  calls = 0
  constructor(private readonly session: NormalizedSession) {}
  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    this.calls++
    if (cursorFor('claude:s1')) return []          // already ingested → nothing new
    return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/s1.jsonl', repoPath: this.session.repoPath }]
  }
  async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
    return { session: this.session, position: JSON.stringify({ sizeBytes: 1, mtimeMs: 1 }) }
  }
}

describe('IngestService', () => {
  let db: Db; let registry: ProjectRegistry; let cursors: IngestCursorStore; let index: SearchIndex
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db)
    registry = new ProjectRegistry(db); cursors = new IngestCursorStore(db); index = new SearchIndex(new DatabaseSync(':memory:'))
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
  })

  test('ingests new sources: resolves projectId, indexes turns, saves cursor', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc',
      turns: [{ role: 'user', text: 'design the ingest service', toolCalls: [] }], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    const result = await svc.ingestAll([new FakeAdapter(session)])
    expect(result).toEqual({ sources: 1, sessions: 1 })
    expect(index.search('ingest service', { projectId: 'p1' })).toHaveLength(1)  // indexed under resolved project
    expect(cursors.get('claude:s1')).toBeDefined()                               // cursor saved
  })

  test('a second run finds nothing new (cursor honored)', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', turns: [], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    const adapter = new FakeAdapter(session)
    await svc.ingestAll([adapter])
    const second = await svc.ingestAll([adapter])
    expect(second.sources).toBe(0)
  })
})
