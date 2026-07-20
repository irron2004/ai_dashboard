import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

/** SQLite has no portable `ADD COLUMN IF NOT EXISTS`; probe before upgrading legacy DBs. */
function addColumnIfMissing(db: Db, table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      status       TEXT NOT NULL,
      goal         TEXT,
      current_focus TEXT,
      goal_source  TEXT,
      goal_confirmed_at TEXT,
      current_focus_source TEXT,
      current_focus_confirmed_at TEXT,
      start_date   TEXT,
      target_date  TEXT,
      project_type TEXT NOT NULL,
      repo_paths   TEXT NOT NULL DEFAULT '[]',
      vault_paths  TEXT NOT NULL DEFAULT '[]',
      source_paths TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS project_source_map (
      agent_kind TEXT NOT NULL,
      native_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      PRIMARY KEY (agent_kind, native_key),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ingest_cursors (
      source_id  TEXT PRIMARY KEY,
      cursor     TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  addColumnIfMissing(db, 'projects', 'domain', "domain TEXT NOT NULL DEFAULT 'project-docs'")
  addColumnIfMissing(db, 'projects', 'goal_source', 'goal_source TEXT')
  addColumnIfMissing(db, 'projects', 'goal_confirmed_at', 'goal_confirmed_at TEXT')
  addColumnIfMissing(db, 'projects', 'current_focus_source', 'current_focus_source TEXT')
  addColumnIfMissing(db, 'projects', 'current_focus_confirmed_at', 'current_focus_confirmed_at TEXT')

  // Values that existed before provenance support were user-managed registry data. Backfill once.
  const migratedAt = new Date().toISOString()
  db.prepare(
    `UPDATE projects SET goal_source = 'user', goal_confirmed_at = COALESCE(goal_confirmed_at, ?)
     WHERE goal IS NOT NULL AND TRIM(goal) <> '' AND goal_source IS NULL`,
  ).run(migratedAt)
  db.prepare(
    `UPDATE projects SET current_focus_source = 'user', current_focus_confirmed_at = COALESCE(current_focus_confirmed_at, ?)
     WHERE current_focus IS NOT NULL AND TRIM(current_focus) <> '' AND current_focus_source IS NULL`,
  ).run(migratedAt)
}
