import { expect, test } from 'vitest'
import { openDb, migrate } from './db.js'

test('migrate creates the core tables', () => {
  const db = openDb(':memory:')
  migrate(db)
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name)
  expect(tables).toContain('projects')
  expect(tables).toContain('project_source_map')
  expect(tables).toContain('ingest_cursors')
  db.close()
})

test('migrate is idempotent', () => {
  const db = openDb(':memory:')
  migrate(db)
  expect(() => migrate(db)).not.toThrow()
  db.close()
})
