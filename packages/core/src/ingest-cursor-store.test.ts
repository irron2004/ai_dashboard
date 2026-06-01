import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from './db.js'
import { IngestCursorStore } from './ingest-cursor-store.js'

describe('IngestCursorStore', () => {
  let db: Db
  let store: IngestCursorStore
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); store = new IngestCursorStore(db)
  })

  test('get returns undefined for an unknown source', () => {
    expect(store.get('nope')).toBeUndefined()
  })

  test('set then get round-trips the position', () => {
    store.set('claude:/a.jsonl', JSON.stringify({ sizeBytes: 10, mtimeMs: 5 }))
    const c = store.get('claude:/a.jsonl')
    expect(JSON.parse(c!.position).sizeBytes).toBe(10)
  })

  test('set overwrites an existing cursor', () => {
    store.set('s', '{"sizeBytes":1}')
    store.set('s', '{"sizeBytes":2}')
    expect(JSON.parse(store.get('s')!.position).sizeBytes).toBe(2)
  })
})
