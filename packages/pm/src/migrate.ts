import type { Db } from '@apc/core'

/** Add a column if it isn't already present (idempotent upgrade for existing DBs). */
function addColumnIfMissing(db: Db, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

export function migratePm(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      title         TEXT NOT NULL,
      status        TEXT NOT NULL,
      assignee_type TEXT NOT NULL DEFAULT 'agent',
      assignee      TEXT,
      priority      TEXT NOT NULL DEFAULT 'medium',
      due_date      TEXT,
      estimate      TEXT,
      parent_task_id TEXT,
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      linked_wiki_pages   TEXT NOT NULL DEFAULT '[]',
      context_package TEXT,
      review_status TEXT NOT NULL DEFAULT 'none',
      blocked_by    TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id            TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL,
      agent         TEXT NOT NULL,
      repo_path     TEXT NOT NULL,
      branch        TEXT,
      worktree_path TEXT,
      started_at    TEXT NOT NULL,
      ended_at      TEXT,
      status        TEXT NOT NULL,
      transcript_path TEXT,
      summary_path  TEXT
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      reviewer     TEXT NOT NULL,
      status       TEXT NOT NULL,
      summary      TEXT NOT NULL,
      next_tasks   TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS next_notes (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS question_log (
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      ts         TEXT NOT NULL,
      agent      TEXT NOT NULL,
      text       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_next_notes_project ON next_notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_qlog_project_ts ON question_log(project_id, ts);
    CREATE INDEX IF NOT EXISTS idx_qlog_session ON question_log(session_id);
  `)

  // Upgrade path for DBs created before these columns existed.
  addColumnIfMissing(db, 'tasks', 'estimate', 'estimate TEXT')
  addColumnIfMissing(db, 'tasks', 'parent_task_id', 'parent_task_id TEXT')
  addColumnIfMissing(db, 'tasks', 'acceptance_criteria', "acceptance_criteria TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(db, 'tasks', 'linked_wiki_pages', "linked_wiki_pages TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(db, 'tasks', 'blocked_by', "blocked_by TEXT NOT NULL DEFAULT '[]'")
}
