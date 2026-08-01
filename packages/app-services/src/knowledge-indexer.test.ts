import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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
    const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    indexer.reindexProject('p1')
    const after = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    const hits = retrieval.search({ projectId: 'p1', query: 'orchestration', limit: 5 })
    expect(hits.filter((h) => h.doc.relPath === 'wiki/orchestration.md')).toHaveLength(1)
    expect(after - before).toBe(0)
  })

  test('re-chunks only the changed document and leaves the unchanged FTS row intact', () => {
    const docs = join(vaultRoot, 'projects', 'p1', 'wiki')
    writeFileSync(join(docs, 'stable.md'), '# Stable\n\nstable lexical row')
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    const stableBefore = db.prepare(
      "SELECT rowid FROM knowledge_chunk_fts WHERE doc_id = 'project:p1:wiki/stable.md'",
    ).get() as { rowid: number }
    const changedBefore = db.prepare(
      "SELECT rowid FROM knowledge_chunk_fts WHERE doc_id = 'project:p1:wiki/orchestration.md'",
    ).get() as { rowid: number }

    writeFileSync(join(docs, 'orchestration.md'), '# Orchestration\n\nchanged routing token')
    indexer.reindexProject('p1')

    const stableAfter = db.prepare(
      "SELECT rowid FROM knowledge_chunk_fts WHERE doc_id = 'project:p1:wiki/stable.md'",
    ).get() as { rowid: number }
    const changedAfter = db.prepare(
      "SELECT rowid FROM knowledge_chunk_fts WHERE doc_id = 'project:p1:wiki/orchestration.md'",
    ).get() as { rowid: number }
    expect(stableAfter.rowid).toBe(stableBefore.rowid)
    expect(changedAfter.rowid).not.toBe(changedBefore.rowid)
    expect(retrieval.search({ projectId: 'p1', query: 'changed', limit: 5 })).toHaveLength(1)
  })

  test('adds one new document without replacing existing rows', () => {
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    const originalRow = db.prepare(
      "SELECT rowid FROM knowledge_chunk_fts WHERE doc_id = 'project:p1:wiki/orchestration.md'",
    ).get() as { rowid: number }
    writeFileSync(join(vaultRoot, 'projects', 'p1', 'wiki', 'added.md'), '# Added\n\nnewly indexed content')

    expect(indexer.reindexProject('p1')).toBe(2)
    const afterRow = db.prepare(
      "SELECT rowid FROM knowledge_chunk_fts WHERE doc_id = 'project:p1:wiki/orchestration.md'",
    ).get() as { rowid: number }
    expect(afterRow.rowid).toBe(originalRow.rowid)
    expect(store.listProjectDocuments('p1').map((doc) => doc.relPath)).toEqual([
      'wiki/added.md',
      'wiki/orchestration.md',
    ])
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

  test('keeps the previous snapshot when a file read fails before apply', () => {
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    const file = join(vaultRoot, 'projects', 'p1', 'wiki', 'orchestration.md')
    writeFileSync(file, '# Orchestration\n\nnew content that must not partially apply')
    const broken = new KnowledgeIndexer({
      registry,
      store,
      vaultRoot,
      readMarkdown: (candidate) => {
        if (candidate === file) throw new Error('synthetic read failure')
        return readFileSync(candidate, 'utf8')
      },
    })

    expect(() => broken.reindexProject('p1')).toThrow(/synthetic read failure/)
    expect(retrieval.search({ projectId: 'p1', query: 'agent', limit: 5 })).toHaveLength(1)
    expect(retrieval.search({ projectId: 'p1', query: 'partially', limit: 5 })).toHaveLength(0)
  })

  test('rejects duplicate relPath across roots before changing the durable index', () => {
    const rootA = join(vaultRoot, 'root-a')
    const rootB = join(vaultRoot, 'root-b')
    mkdirSync(rootA, { recursive: true })
    mkdirSync(rootB, { recursive: true })
    writeFileSync(join(rootA, 'same.md'), '# A\n\nduplicate root alpha')
    writeFileSync(join(rootB, 'same.md'), '# B\n\nduplicate root beta')
    registry.register({ id: 'p2', name: 'P2', status: 'active', projectType: 'git', repoPaths: [], vaultPaths: [rootA], sourcePaths: [], domain: 'project-docs' })
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    expect(indexer.reindexProject('p2')).toBe(1)
    registry.register({ id: 'p2', name: 'P2', status: 'active', projectType: 'git', repoPaths: [], vaultPaths: [rootA, rootB], sourcePaths: [], domain: 'project-docs' })

    expect(() => indexer.reindexProject('p2')).toThrow(/duplicate relPath.*same\.md/)
    expect(retrieval.search({ projectId: 'p2', query: 'alpha', limit: 5 })).toHaveLength(1)
    expect(retrieval.search({ projectId: 'p2', query: 'beta', limit: 5 })).toHaveLength(0)
  })

  test('does not destructively apply a scan that exceeds its configured file limit', () => {
    const docs = join(vaultRoot, 'projects', 'p1', 'wiki')
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    writeFileSync(join(docs, 'two.md'), '# Two\n\nsecond scan file')
    writeFileSync(join(docs, 'three.md'), '# Three\n\nthird scan file')

    const bounded = new KnowledgeIndexer({ registry, store, vaultRoot, scanLimit: 2 })
    expect(() => bounded.reindexProject('p1')).toThrow(/scan limit.*2/i)
    expect(store.listProjectDocuments('p1').map((doc) => doc.relPath)).toEqual(['wiki/orchestration.md'])
  })
})
