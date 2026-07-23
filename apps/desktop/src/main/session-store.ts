// apps/desktop/src/main/session-store.ts
type DB = {
  exec(sql: string): unknown
  prepare(sql: string): {
    run(...a: unknown[]): { changes?: number | bigint }
    get(...a: unknown[]): any
    all(...a: unknown[]): any[]
  }
}

export type WorkspacePaneRecord = {
  paneId: string
  projectId: string
  worktreePath: string
  slotId: string
  agent: string
  lastSessionId: string | null
  wasOpen: boolean
}

export type PaneInput = {
  projectId: string
  agent: string
  lastSessionId?: string | null
  wasOpen: boolean
  paneId?: string
  worktreePath?: string
  slotId?: string
}

type SessionStoreDeps = {
  primaryWorktreeForProject?: (projectId: string) => string | undefined
  now?: () => string
}

export class SessionStore {
  private readonly primaryWorktreeForProject: NonNullable<SessionStoreDeps['primaryWorktreeForProject']>
  private readonly now: NonNullable<SessionStoreDeps['now']>

  constructor(private readonly db: DB, deps: SessionStoreDeps = {}) {
    this.primaryWorktreeForProject = deps.primaryWorktreeForProject ?? (() => undefined)
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_pane (
        project_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        last_session_id TEXT,
        last_active TEXT,
        was_open INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, agent)
      );
      CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS workspace_pane_v2 (
        pane_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        last_session_id TEXT,
        last_active TEXT,
        was_open INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_pane_v2_project
        ON workspace_pane_v2(project_id, was_open);
    `)

    // One-way compatibility migration. The legacy key cannot represent worktree/slot, so map it
    // to the project's primary worktree and the first slot. Existing v2 rows always win.
    const legacyRows = this.db.prepare(
      `SELECT project_id as projectId, agent, last_session_id as lastSessionId,
              last_active as lastActive, was_open as wasOpen
       FROM workspace_pane`,
    ).all()
    for (const row of legacyRows) {
      const projectId = String(row.projectId)
      const agent = String(row.agent)
      const worktreePath = this.primaryWorktreeForProject(projectId) ?? ''
      const slotId = `${agent}-1`
      this.db.prepare(
        `INSERT OR IGNORE INTO workspace_pane_v2
         (pane_id, project_id, worktree_path, slot_id, agent, last_session_id, last_active, was_open)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `legacy:${projectId}:${agent}:1`, projectId, worktreePath, slotId, agent,
        row.lastSessionId ?? null, row.lastActive ?? null, Number(row.wasOpen) === 1 ? 1 : 0,
      )
    }
  }

  upsertPane(p: PaneInput): void {
    const now = this.now()
    this.db.prepare(`
      INSERT INTO workspace_pane (project_id, agent, last_session_id, last_active, was_open)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, agent) DO UPDATE SET
        last_session_id = COALESCE(excluded.last_session_id, workspace_pane.last_session_id),
        last_active = excluded.last_active,
        was_open = excluded.was_open
    `).run(p.projectId, p.agent, p.lastSessionId ?? null, now, p.wasOpen ? 1 : 0)

    const worktreePath = p.worktreePath ?? this.primaryWorktreeForProject(p.projectId) ?? ''
    const slotId = p.slotId ?? `${p.agent}-1`
    const paneId = p.paneId ?? `legacy:${p.projectId}:${p.agent}:1`
    this.db.prepare(`
      INSERT INTO workspace_pane_v2
        (pane_id, project_id, worktree_path, slot_id, agent, last_session_id, last_active, was_open)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pane_id) DO UPDATE SET
        project_id = excluded.project_id,
        worktree_path = excluded.worktree_path,
        slot_id = excluded.slot_id,
        agent = excluded.agent,
        last_session_id = COALESCE(excluded.last_session_id, workspace_pane_v2.last_session_id),
        last_active = excluded.last_active,
        was_open = excluded.was_open
    `).run(
      paneId, p.projectId, worktreePath, slotId, p.agent,
      p.lastSessionId ?? null, now, p.wasOpen ? 1 : 0,
    )
  }

  listOpenPanes(): Array<{ projectId: string; agent: string; lastSessionId: string | null }> {
    const rows = this.db.prepare(
      `SELECT project_id as projectId, agent, last_session_id as lastSessionId
       FROM workspace_pane WHERE was_open = 1 ORDER BY project_id, agent`,
    ).all()
    // node:sqlite는 null-prototype 행을 주므로 plain object로 정규화(toEqual 안정성)
    return rows.map((r: any) => ({ projectId: r.projectId, agent: r.agent, lastSessionId: r.lastSessionId ?? null }))
  }

  listOpenPaneRecords(): WorkspacePaneRecord[] {
    const rows = this.db.prepare(
      `SELECT pane_id as paneId, project_id as projectId, worktree_path as worktreePath,
              slot_id as slotId, agent, last_session_id as lastSessionId, was_open as wasOpen
       FROM workspace_pane_v2 WHERE was_open = 1 ORDER BY project_id, worktree_path, slot_id`,
    ).all()
    return rows.map((row) => ({
      paneId: String(row.paneId),
      projectId: String(row.projectId),
      worktreePath: String(row.worktreePath),
      slotId: String(row.slotId),
      agent: String(row.agent),
      lastSessionId: row.lastSessionId == null ? null : String(row.lastSessionId),
      wasOpen: Number(row.wasOpen) === 1,
    }))
  }

  getPane(paneId: string): WorkspacePaneRecord | undefined {
    const row = this.db.prepare(
      `SELECT pane_id as paneId, project_id as projectId, worktree_path as worktreePath,
              slot_id as slotId, agent, last_session_id as lastSessionId, was_open as wasOpen
       FROM workspace_pane_v2 WHERE pane_id = ?`,
    ).get(paneId)
    return row ? {
      paneId: String(row.paneId),
      projectId: String(row.projectId),
      worktreePath: String(row.worktreePath),
      slotId: String(row.slotId),
      agent: String(row.agent),
      lastSessionId: row.lastSessionId == null ? null : String(row.lastSessionId),
      wasOpen: Number(row.wasOpen) === 1,
    } : undefined
  }

  setState(key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value)
  }

  getState(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key)
    return row ? (row.value as string) : null
  }

  deleteProject(projectId: string): void {
    this.db.prepare('DELETE FROM workspace_pane WHERE project_id = ?').run(projectId)
    this.db.prepare('DELETE FROM workspace_pane_v2 WHERE project_id = ?').run(projectId)
    if (this.getState('selected_project_id') === projectId) {
      this.db.prepare('DELETE FROM app_state WHERE key = ?').run('selected_project_id')
    }
  }

  /** Retain open panes, but remove deleted-project rows and long-closed restore history. */
  pruneInactive(inactiveBefore: string, validProjectIds: readonly string[]): number {
    const placeholders = validProjectIds.map(() => '?').join(', ')
    let deleted = 0
    for (const table of ['workspace_pane', 'workspace_pane_v2']) {
      const orphaned = validProjectIds.length === 0
        ? this.db.prepare(`DELETE FROM ${table}`).run()
        : this.db.prepare(`DELETE FROM ${table} WHERE project_id NOT IN (${placeholders})`).run(...validProjectIds)
      deleted += Number(orphaned.changes ?? 0)
      const expired = this.db.prepare(
        `DELETE FROM ${table}
         WHERE was_open = 0 AND (last_active IS NULL OR last_active < ?)`,
      ).run(inactiveBefore)
      deleted += Number(expired.changes ?? 0)
    }
    return deleted
  }

  closeAllPanes(): void {
    this.db.exec(`
      UPDATE workspace_pane SET was_open = 0;
      UPDATE workspace_pane_v2 SET was_open = 0;
    `)
  }
}
