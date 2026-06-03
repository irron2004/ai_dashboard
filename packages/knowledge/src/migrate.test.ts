import { describe, expect, test } from 'vitest'
import { openDb, migrate } from '@apc/core'
import { migrateKnowledge } from './migrate.js'

describe('migrateKnowledge', () => {
  test('creates knowledge tables and FTS table', () => {
    const db = openDb(':memory:')
    migrate(db)
    migrateKnowledge(db)
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all()
      .map((row) => (row as { name: string }).name)
    expect(names).toEqual(expect.arrayContaining([
      'knowledge_collections',
      'knowledge_contexts',
      'knowledge_documents',
      'knowledge_chunks',
      'knowledge_chunk_fts',
    ]))
  })

  test('is idempotent', () => {
    const db = openDb(':memory:')
    migrate(db)
    migrateKnowledge(db)
    expect(() => migrateKnowledge(db)).not.toThrow()
  })
})
