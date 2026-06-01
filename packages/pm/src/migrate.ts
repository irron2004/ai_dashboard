import type { Db } from '@apc/core'

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
      context_package TEXT,
      review_status TEXT NOT NULL DEFAULT 'none'
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
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON agent_runs(task_id);
  `)
}
