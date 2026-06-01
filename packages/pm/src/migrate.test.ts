import { expect, test } from 'vitest'
import { openDb, migrate } from '@apc/core'
import { migratePm } from './migrate.js'

test('migratePm creates tasks, agent_runs, reviews', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((r: { name: string }) => r.name)
  expect(tables).toEqual(expect.arrayContaining(['tasks', 'agent_runs', 'reviews']))
})

test('migratePm is idempotent', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  expect(() => migratePm(db)).not.toThrow()
})
