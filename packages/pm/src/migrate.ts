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
      blocked_by    TEXT NOT NULL DEFAULT '[]',
      source        TEXT NOT NULL DEFAULT 'manual',
      source_ref    TEXT,
      created_at    TEXT,
      updated_at    TEXT,
      user_edited_at TEXT,
      deleted_at    TEXT
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
      done       INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      converted_task_id TEXT
    );
    CREATE TABLE IF NOT EXISTS question_log (
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      ts         TEXT NOT NULL,
      agent      TEXT NOT NULL,
      text       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retros (
      id           TEXT PRIMARY KEY,
      date         TEXT NOT NULL UNIQUE,
      started_at   TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS retro_targets (
      id                    TEXT PRIMARY KEY,
      retro_id              TEXT NOT NULL,
      project_id            TEXT NOT NULL,
      repo_path             TEXT NOT NULL,
      branch                TEXT,
      prepared_head_sha     TEXT NOT NULL,
      prepared_at           TEXT NOT NULL,
      verification_evidence TEXT,
      risk_notes            TEXT,
      receipt_id            TEXT,
      UNIQUE(retro_id, project_id, repo_path)
    );
    CREATE TABLE IF NOT EXISTS retro_questions (
      id          TEXT PRIMARY KEY,
      retro_id    TEXT NOT NULL,
      target_id   TEXT,
      project_id  TEXT,
      kind        TEXT NOT NULL,
      critical    INTEGER NOT NULL DEFAULT 0,
      text        TEXT NOT NULL,
      answer      TEXT,
      skipped     INTEGER NOT NULL DEFAULT 0,
      answered_at TEXT,
      seq         INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS review_receipts (
      id                    TEXT PRIMARY KEY,
      project_id            TEXT NOT NULL,
      repo_path             TEXT NOT NULL,
      branch                TEXT,
      reviewed_head_sha     TEXT NOT NULL,
      diff_hash             TEXT,
      retro_id              TEXT NOT NULL,
      target_id             TEXT NOT NULL,
      answered_question_ids TEXT NOT NULL,
      evidence_refs         TEXT NOT NULL,
      answer_snapshot_hash  TEXT NOT NULL,
      issued_at             TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gate_events (
      id        TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      kind      TEXT NOT NULL,
      reason    TEXT NOT NULL,
      ts        TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_activity (
      pane_id                    TEXT PRIMARY KEY,
      project_id                 TEXT NOT NULL,
      worktree_path              TEXT NOT NULL,
      slot_id                    TEXT NOT NULL,
      agent                      TEXT NOT NULL,
      session_id                 TEXT,
      launch_id                  TEXT NOT NULL,
      connection                 TEXT NOT NULL,
      phase                      TEXT NOT NULL,
      process_alive              INTEGER NOT NULL DEFAULT 0,
      last_activity_at           TEXT NOT NULL,
      last_input_at              TEXT,
      last_output_at             TEXT,
      stale_since                TEXT,
      current_label              TEXT,
      last_question_display      TEXT,
      last_question_asked_at     TEXT,
      last_question_session_id   TEXT,
      last_question_exchange_id  TEXT,
      last_question_privacy      TEXT,
      last_question_source       TEXT,
      exit_code                  INTEGER,
      reason                     TEXT,
      revision                   INTEGER NOT NULL DEFAULT 0,
      updated_at                 TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_next_notes_project ON next_notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_qlog_project_ts ON question_log(project_id, ts);
    CREATE INDEX IF NOT EXISTS idx_qlog_session ON question_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_retro_targets_retro ON retro_targets(retro_id);
    CREATE INDEX IF NOT EXISTS idx_retro_questions_retro ON retro_questions(retro_id, target_id, seq);
    CREATE INDEX IF NOT EXISTS idx_receipts_repo ON review_receipts(repo_path, issued_at);
    DROP INDEX IF EXISTS idx_receipts_target;
    CREATE INDEX IF NOT EXISTS idx_receipts_target_issued ON review_receipts(target_id, issued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_receipts_retro ON review_receipts(retro_id);
    CREATE INDEX IF NOT EXISTS idx_gate_events_ts ON gate_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_activity_project ON agent_activity(project_id, updated_at DESC);
  `)

  // Upgrade path for DBs created before these columns existed.
  addColumnIfMissing(db, 'tasks', 'estimate', 'estimate TEXT')
  addColumnIfMissing(db, 'tasks', 'parent_task_id', 'parent_task_id TEXT')
  addColumnIfMissing(db, 'tasks', 'acceptance_criteria', "acceptance_criteria TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(db, 'tasks', 'linked_wiki_pages', "linked_wiki_pages TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(db, 'tasks', 'blocked_by', "blocked_by TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(db, 'tasks', 'source', "source TEXT NOT NULL DEFAULT 'manual'")
  addColumnIfMissing(db, 'tasks', 'source_ref', 'source_ref TEXT')
  addColumnIfMissing(db, 'tasks', 'created_at', 'created_at TEXT')
  addColumnIfMissing(db, 'tasks', 'updated_at', 'updated_at TEXT')
  addColumnIfMissing(db, 'tasks', 'user_edited_at', 'user_edited_at TEXT')
  addColumnIfMissing(db, 'tasks', 'deleted_at', 'deleted_at TEXT')

  addColumnIfMissing(db, 'next_notes', 'updated_at', 'updated_at TEXT')
  addColumnIfMissing(db, 'next_notes', 'pinned', 'pinned INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'next_notes', 'archived_at', 'archived_at TEXT')
  addColumnIfMissing(db, 'next_notes', 'converted_task_id', 'converted_task_id TEXT')

  const migratedAt = new Date().toISOString()
  db.prepare(
    `UPDATE tasks SET source = 'conversation'
     WHERE id LIKE 'req:%' OR id LIKE 'todo:%'`,
  ).run()
  db.prepare(
    `UPDATE tasks SET source = 'review'
     WHERE id LIKE 'auto-%' AND source = 'manual'`,
  ).run()
  db.prepare(
    `UPDATE tasks SET created_at = ?
     WHERE created_at IS NULL OR created_at = ''`,
  ).run(migratedAt)
  db.prepare(
    `UPDATE tasks SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at, ?)
     WHERE updated_at IS NULL OR updated_at = ''`,
  ).run(migratedAt)
  db.prepare(
    `UPDATE next_notes SET updated_at = created_at
     WHERE updated_at IS NULL OR updated_at = ''`,
  ).run()
}
