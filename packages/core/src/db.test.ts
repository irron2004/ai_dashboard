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

test('migrate upgrades legacy project context as user-confirmed data', () => {
  const db = openDb(':memory:')
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
      goal TEXT, current_focus TEXT, start_date TEXT, target_date TEXT,
      project_type TEXT NOT NULL, repo_paths TEXT NOT NULL DEFAULT '[]',
      vault_paths TEXT NOT NULL DEFAULT '[]', source_paths TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO projects
      (id, name, status, goal, current_focus, project_type)
    VALUES ('legacy', 'Legacy', 'active', 'Ship it', 'Tests', 'git');
  `)

  migrate(db)
  const row = db.prepare(
    `SELECT goal_source, goal_confirmed_at, current_focus_source, current_focus_confirmed_at
     FROM projects WHERE id = 'legacy'`,
  ).get() as Record<string, string | null>
  expect(row.goal_source).toBe('user')
  expect(row.goal_confirmed_at).toBeTruthy()
  expect(row.current_focus_source).toBe('user')
  expect(row.current_focus_confirmed_at).toBeTruthy()

  const firstConfirmation = row.goal_confirmed_at
  migrate(db)
  const rerun = db.prepare("SELECT goal_confirmed_at FROM projects WHERE id = 'legacy'").get() as { goal_confirmed_at: string }
  expect(rerun.goal_confirmed_at).toBe(firstConfirmation)
  db.close()
})
