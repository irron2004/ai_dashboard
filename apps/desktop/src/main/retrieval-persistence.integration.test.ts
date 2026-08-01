import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IngestCursorStore, migrate, openDb } from '@apc/core'
import type { NormalizedSession } from '@apc/shared'
import { buildContainer, type Container } from './container.js'

function session(projectId: string): NormalizedSession {
  return {
    id: 'persistent-session',
    agentType: 'claude',
    projectId,
    repoPath: '/synthetic/repo',
    sourceMeta: {
      provider: 'claude',
      sourceKind: 'jsonl-file',
      rawLocator: '/synthetic/persistent-session.jsonl',
      sessionHeader: {},
    },
    turns: [{
      uuid: 'persistent-turn',
      role: 'user',
      text: 'restartpersistent evidence token',
      timestamp: '2026-08-02T00:00:00Z',
      toolCalls: [],
    }],
    filesTouched: [],
  }
}

describe('desktop retrieval persistence', () => {
  let root = ''
  const containers: Container[] = []

  afterEach(() => {
    for (const container of containers.splice(0)) {
      try { container.db.close() } catch { /* already closed at a restart boundary */ }
    }
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  test('session evidence remains searchable after the app database is reopened', async () => {
    root = mkdtempSync(join(tmpdir(), 'apc-retrieval-persistence-'))
    const dbFile = join(root, 'apc.db')
    const vaultRoot = join(root, 'vault')
    mkdirSync(vaultRoot, { recursive: true })

    const first = buildContainer({ dbFile, vaultRoot, ingestAdapters: [] })
    containers.push(first)
    first.registry.register({
      id: 'p1',
      name: 'Persistent search',
      status: 'active',
      projectType: 'git',
      domain: 'project-docs',
      repoPaths: ['/synthetic/repo'],
      vaultPaths: [],
      sourcePaths: [],
    })
    first.searchIndex.indexSession(session('p1'))
    expect(await first.searchEvidence({ query: 'restartpersistent', projectId: 'p1' }))
      .toMatchObject({ ok: true, response: { evidence: [{ sourceKind: 'session', projectId: 'p1' }] } })
    first.db.close()

    const restarted = buildContainer({ dbFile, vaultRoot, ingestAdapters: [] })
    containers.push(restarted)
    expect(await restarted.searchEvidence({ query: 'restartpersistent', projectId: 'p1' }))
      .toMatchObject({
        ok: true,
        response: {
          evidence: [{
            sourceKind: 'session',
            projectId: 'p1',
            uri: 'apc://session/persistent-session#turn-0',
          }],
        },
      })
  })

  test('the persistent-index migration invalidates only agent cursors and only once', () => {
    root = mkdtempSync(join(tmpdir(), 'apc-retrieval-cursor-migration-'))
    const dbFile = join(root, 'apc.db')
    const vaultRoot = join(root, 'vault')
    mkdirSync(vaultRoot, { recursive: true })

    const legacy = openDb(dbFile)
    migrate(legacy)
    const legacyCursors = new IngestCursorStore(legacy)
    legacyCursors.set('claude:/synthetic/session.jsonl', '{"sizeBytes":1}')
    legacyCursors.set('custom:durable-source', 'keep-me')
    legacy.close()

    const migrated = buildContainer({ dbFile, vaultRoot, ingestAdapters: [] })
    containers.push(migrated)
    expect(migrated.cursors.get('claude:/synthetic/session.jsonl')).toBeUndefined()
    expect(migrated.cursors.get('custom:durable-source')?.position).toBe('keep-me')
    migrated.cursors.set('claude:/synthetic/after-migration.jsonl', '{"sizeBytes":2}')
    migrated.db.close()

    const restarted = buildContainer({ dbFile, vaultRoot, ingestAdapters: [] })
    containers.push(restarted)
    expect(restarted.cursors.get('claude:/synthetic/after-migration.jsonl')?.position)
      .toBe('{"sizeBytes":2}')
  })
})
