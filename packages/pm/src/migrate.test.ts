import { expect, test } from 'vitest'
import { openDb, migrate } from '@apc/core'
import { migratePm } from './migrate.js'

test('migratePm creates tasks, agent_runs, reviews', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((r) => (r as { name: string }).name)
  expect(tables).toEqual(expect.arrayContaining([
    'tasks', 'agent_runs', 'reviews', 'retros', 'retro_targets', 'retro_questions',
    'review_receipts', 'gate_events', 'agent_activity',
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

test('migratePm adds task provenance and backfills known automatic producers', () => {
  const db = openDb(':memory:'); migrate(db)
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL
    );
    INSERT INTO tasks VALUES ('req:p1:s1', 'p1', 'request', 'done');
    INSERT INTO tasks VALUES ('todo:p1:s1:fix', 'p1', 'fix', 'todo');
    INSERT INTO tasks VALUES ('auto-review-1', 'p1', 'follow-up', 'todo');
    INSERT INTO tasks VALUES ('manual-1', 'p1', 'manual', 'todo');
  `)

  migratePm(db)
  const rows = db.prepare(
    'SELECT id, source, created_at, updated_at FROM tasks ORDER BY id',
  ).all() as Array<{ id: string; source: string; created_at: string; updated_at: string }>
  expect(rows.find((row) => row.id === 'req:p1:s1')?.source).toBe('conversation')
  expect(rows.find((row) => row.id === 'todo:p1:s1:fix')?.source).toBe('conversation')
  expect(rows.find((row) => row.id === 'auto-review-1')?.source).toBe('review')
  expect(rows.find((row) => row.id === 'manual-1')?.source).toBe('manual')
  expect(rows.every((row) => Boolean(row.created_at) && Boolean(row.updated_at))).toBe(true)

  const firstCreatedAt = rows[0]?.created_at
  migratePm(db)
  const rerun = db.prepare('SELECT created_at FROM tasks WHERE id = ?').get(rows[0]?.id) as { created_at: string }
  expect(rerun.created_at).toBe(firstCreatedAt)
})

test('migratePm upgrades NextNote lifecycle columns without losing legacy rows', () => {
  const db = openDb(':memory:'); migrate(db)
  db.exec(`
    CREATE TABLE next_notes (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, text TEXT NOT NULL,
      created_at TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO next_notes VALUES ('n1', 'p1', 'remember', '2026-07-19T10:00:00Z', 1);
  `)

  migratePm(db)
  const row = db.prepare(
    'SELECT text, created_at, updated_at, done, pinned, archived_at, converted_task_id FROM next_notes WHERE id = ?',
  ).get('n1') as Record<string, string | number | null>
  expect(row).toMatchObject({
    text: 'remember',
    created_at: '2026-07-19T10:00:00Z',
    updated_at: '2026-07-19T10:00:00Z',
    done: 1,
    pinned: 0,
    archived_at: null,
    converted_task_id: null,
  })
})

test('agent_activity stores only sanitized question fields', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  const columns = db.prepare('PRAGMA table_info(agent_activity)').all()
    .map((column) => (column as { name: string }).name)
  expect(columns).toEqual(expect.arrayContaining([
    'pane_id', 'project_id', 'worktree_path', 'slot_id', 'connection', 'phase',
    'process_alive', 'last_question_display', 'last_question_privacy', 'revision',
  ]))
  expect(columns).not.toEqual(expect.arrayContaining(['raw_question', 'last_question_raw']))
})
