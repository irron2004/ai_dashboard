import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval } from '@apc/knowledge'
import { KnowledgeIndexer } from './knowledge-indexer.js'

describe('KnowledgeIndexer', () => {
  let db: Db
  let registry: ProjectRegistry
  let store: KnowledgeStore
  let retrieval: KnowledgeRetrieval
  let vaultRoot: string

  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migrateKnowledge(db)
    registry = new ProjectRegistry(db)
    store = new KnowledgeStore(db)
    retrieval = new KnowledgeRetrieval(db)
    vaultRoot = mkdtempSync(join(tmpdir(), 'apc-knidx-'))
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/work/p1'], vaultPaths: [], sourcePaths: [], domain: 'project-docs' })
    const projDir = join(vaultRoot, 'projects', 'p1', 'wiki')
    mkdirSync(projDir, { recursive: true })
    writeFileSync(join(projDir, 'orchestration.md'), '# Orchestration\n\nagent orchestration and routing notes')
  })

  afterEach(() => { rmSync(vaultRoot, { recursive: true, force: true }) })

  test('indexes project vault markdown so retrieval finds it', () => {
    const count = new KnowledgeIndexer({ registry, store, vaultRoot }).reindexProject('p1')
    expect(count).toBe(1)
    const hits = retrieval.search({ projectId: 'p1', query: 'orchestration', limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].doc.relPath).toBe('wiki/orchestration.md')
  })

  test('reindex is idempotent (no duplicate docs)', () => {
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    indexer.reindexProject('p1')
    const hits = retrieval.search({ projectId: 'p1', query: 'orchestration', limit: 5 })
    expect(hits.filter((h) => h.doc.relPath === 'wiki/orchestration.md')).toHaveLength(1)
  })

  test('deleting a file then reindexing removes it from the index', () => {
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    rmSync(join(vaultRoot, 'projects', 'p1', 'wiki', 'orchestration.md'))
    const count = indexer.reindexProject('p1')
    expect(count).toBe(0)
    expect(retrieval.search({ projectId: 'p1', query: 'orchestration', limit: 5 })).toHaveLength(0)
  })

  test('reindexAll covers every registered project', () => {
    const result = new KnowledgeIndexer({ registry, store, vaultRoot }).reindexAll()
    expect(result.documents).toBe(1)
  })

  test('indexes markdown found via registered vaultPaths', () => {
    const extraDir = join(vaultRoot, 'external', 'docs')
    mkdirSync(extraDir, { recursive: true })
    writeFileSync(join(extraDir, 'guide.md'), '# Guide\n\nexternal vaultpath knowledge content')
    registry.register({ id: 'p2', name: 'P2', status: 'active', projectType: 'git', repoPaths: ['/work/p2'], vaultPaths: [extraDir], sourcePaths: [], domain: 'project-docs' })

    const count = new KnowledgeIndexer({ registry, store, vaultRoot }).reindexProject('p2')
    expect(count).toBe(1)
    const hits = retrieval.search({ projectId: 'p2', query: 'vaultpath', limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].doc.relPath).toBe('guide.md')
  })
})
