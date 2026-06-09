import { beforeEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, ProjectRegistry, IngestCursorStore, type Db } from '@apc/core'
import { SearchIndex } from '@apc/search'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'
import { IngestService } from './ingest-service.js'

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

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

class BlockingAdapter implements AgentIngestAdapter {
  readonly agentKind = 'claude' as const
  calls = 0
  parseStarted = deferred<void>()
  releaseParse = deferred<void>()
  constructor(private readonly session: NormalizedSession) {}
  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    this.calls++
    if (cursorFor('claude:s1')) return []
    return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/s1.jsonl', repoPath: this.session.repoPath }]
  }
  async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
    this.parseStarted.resolve()
    await this.releaseParse.promise
    return { session: this.session, position: JSON.stringify({ sizeBytes: 1, mtimeMs: 1 }) }
  }
}

class ThrowingAdapter implements AgentIngestAdapter {
  readonly agentKind = 'claude' as const
  async discoverSources(): Promise<AgentSource[]> {
    return [{ id: 'claude:bad', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/bad.jsonl' }]
  }
  async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
    throw new Error('parse failed')
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
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
      turns: [{ role: 'user', text: 'design the ingest service', toolCalls: [] }], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    const result = await svc.ingestAll([new FakeAdapter(session)])
    expect(result).toEqual({ sources: 1, sessions: 1, documents: 0 })
    expect(index.search('ingest service', { projectId: 'p1' })).toHaveLength(1)  // indexed under resolved project
    expect(cursors.get('claude:s1')).toBeDefined()                               // cursor saved
  })

  test('a second run finds nothing new (cursor honored)', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, turns: [], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    const adapter = new FakeAdapter(session)
    await svc.ingestAll([adapter])
    const second = await svc.ingestAll([adapter])
    expect(second.sources).toBe(0)
  })

  test('concurrent ingestAll calls are serialized by the service lock', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, turns: [], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    const adapter = new BlockingAdapter(session)
    const first = svc.ingestAll([adapter])
    await adapter.parseStarted.promise
    const second = svc.ingestAll([adapter])
    await Promise.resolve()
    expect(adapter.calls).toBe(1)
    adapter.releaseParse.resolve()
    await expect(first).resolves.toEqual({ sources: 1, sessions: 1, documents: 0 })
    await expect(second).resolves.toEqual({ sources: 0, sessions: 0, documents: 0 })
    expect(adapter.calls).toBe(2)
  })

  test('lock is released after adapter parse failure', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, turns: [], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    await expect(svc.ingestAll([new ThrowingAdapter()])).rejects.toThrow(/parse failed/)
    await expect(svc.ingestAll([new FakeAdapter(session)])).resolves.toEqual({ sources: 1, sessions: 1, documents: 0 })
  })

  test('runs knowledge reindex after sessions and returns document count', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
      turns: [{ role: 'user', text: 'design the ingest service', toolCalls: [] }], filesTouched: [] }
    let reindexCalls = 0
    const knowledge = { reindexAll: () => { reindexCalls++; return { documents: 3 } } }
    const svc = new IngestService({ registry, cursors, index, knowledge })
    const result = await svc.ingestAll([new FakeAdapter(session)])
    expect(reindexCalls).toBe(1)
    expect(result).toEqual({ sources: 1, sessions: 1, documents: 3 })
  })

  test('lock is released after knowledge reindexAll failure', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
      turns: [{ role: 'user', text: 'design the ingest service', toolCalls: [] }], filesTouched: [] }
    const throwingKnowledge = { reindexAll: (): { documents: number } => { throw new Error('vault unreadable') } }
    const svc = new IngestService({ registry, cursors, index, knowledge: throwingKnowledge })
    await expect(svc.ingestAll([new FakeAdapter(session)])).rejects.toThrow(/vault unreadable/)
    // lock must have been released by the finally block — a second ingest (no knowledge) succeeds
    const okSvc = new IngestService({ registry, cursors, index })
    await expect(okSvc.ingestAll([new FakeAdapter(session)])).resolves.toMatchObject({ sources: 0 })
  })
})
