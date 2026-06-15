import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateKnowledge } from './migrate.js'
import { ProcessedSourceStore } from './processed-source-store.js'

describe('ProcessedSourceStore', () => {
  let db: Db
  let store: ProcessedSourceStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migrateKnowledge(db); store = new ProcessedSourceStore(db) })

  test('unrecorded source is not processed', () => {
    expect(store.isProcessed('p1', 'raw/a.md', 'h1')).toBe(false)
  })

  test('markProcessed records sources, isProcessed matches on id + hash', () => {
    store.markProcessed('p1', 'RUN-1', [{ sourceId: 'raw/a.md', sourceHash: 'h1' }, { sourceId: 'raw/b.md', sourceHash: 'h2' }], '2026-06-15T00:00:00Z')
    expect(store.isProcessed('p1', 'raw/a.md', 'h1')).toBe(true)
    expect(store.isProcessed('p1', 'raw/b.md', 'h2')).toBe(true)
    // changed content (different hash) → NOT processed, so it will be re-processed
    expect(store.isProcessed('p1', 'raw/a.md', 'h1-changed')).toBe(false)
    // other project is isolated
    expect(store.isProcessed('p2', 'raw/a.md', 'h1')).toBe(false)
  })

  test('re-marking the same source upserts its hash (latest content wins)', () => {
    store.markProcessed('p1', 'RUN-1', [{ sourceId: 'raw/a.md', sourceHash: 'h1' }], '2026-06-15T00:00:00Z')
    store.markProcessed('p1', 'RUN-2', [{ sourceId: 'raw/a.md', sourceHash: 'h2' }], '2026-06-15T01:00:00Z')
    expect(store.isProcessed('p1', 'raw/a.md', 'h1')).toBe(false)
    expect(store.isProcessed('p1', 'raw/a.md', 'h2')).toBe(true)
    const all = store.listProcessed('p1')
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ sourceId: 'raw/a.md', sourceHash: 'h2', runId: 'RUN-2' })
  })

  test('markProcessed on an empty list is a no-op', () => {
    store.markProcessed('p1', 'RUN-1', [], '2026-06-15T00:00:00Z')
    expect(store.listProcessed('p1')).toEqual([])
  })

  test('clearProject forgets a project but leaves others', () => {
    store.markProcessed('p1', 'RUN-1', [{ sourceId: 'raw/a.md', sourceHash: 'h1' }], 't')
    store.markProcessed('p2', 'RUN-1', [{ sourceId: 'raw/a.md', sourceHash: 'h1' }], 't')
    store.clearProject('p1')
    expect(store.isProcessed('p1', 'raw/a.md', 'h1')).toBe(false)
    expect(store.isProcessed('p2', 'raw/a.md', 'h1')).toBe(true)
  })
})
