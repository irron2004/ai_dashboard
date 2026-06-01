import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      status       TEXT NOT NULL,
      goal         TEXT,
      current_focus TEXT,
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
}
