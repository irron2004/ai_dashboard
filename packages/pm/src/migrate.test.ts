import { expect, test } from 'vitest'
import { openDb, migrate } from '@apc/core'
import { migratePm } from './migrate.js'

test('migratePm creates tasks, agent_runs, reviews', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((r) => (r as { name: string }).name)
  expect(tables).toEqual(expect.arrayContaining([
    'tasks', 'agent_runs', 'reviews', 'retros', 'retro_targets', 'retro_questions',
    'review_receipts', 'gate_events',
  ]))
})

test('migratePm is idempotent', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  expect(() => migratePm(db)).not.toThrow()
})

test('tasks table has a blocked_by column (fresh + legacy upgrade)', () => {
  const fresh = openDb(':memory:'); migrate(fresh); migratePm(fresh)
  const freshCols = fresh.prepare('PRAGMA table_info(tasks)').all().map((c) => (c as { name: string }).name)
  expect(freshCols).toContain('blocked_by')

  const legacy = openDb(':memory:'); migrate(legacy)
  legacy.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL)')
  migratePm(legacy)
  const legacyCols = legacy.prepare('PRAGMA table_info(tasks)').all().map((c) => (c as { name: string }).name)
  expect(legacyCols).toContain('blocked_by')
})
