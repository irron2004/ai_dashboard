// apps/desktop/src/main/session-store.ts
type DB = {
  exec(sql: string): unknown
  prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): any; all(...a: unknown[]): any[] }
}

export class SessionStore {
  constructor(private readonly db: DB) {}

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
    `)
  }

  upsertPane(p: { projectId: string; agent: string; lastSessionId?: string | null; wasOpen: boolean }): void {
    this.db.prepare(`
      INSERT INTO workspace_pane (project_id, agent, last_session_id, last_active, was_open)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, agent) DO UPDATE SET
        last_session_id = COALESCE(excluded.last_session_id, workspace_pane.last_session_id),
        last_active = excluded.last_active,
        was_open = excluded.was_open
    `).run(p.projectId, p.agent, p.lastSessionId ?? null, new Date().toISOString(), p.wasOpen ? 1 : 0)
  }

  listOpenPanes(): Array<{ projectId: string; agent: string; lastSessionId: string | null }> {
    const rows = this.db.prepare(
      `SELECT project_id as projectId, agent, last_session_id as lastSessionId
       FROM workspace_pane WHERE was_open = 1 ORDER BY project_id, agent`,
    ).all()
    // node:sqlite는 null-prototype 행을 주므로 plain object로 정규화(toEqual 안정성)
    return rows.map((r: any) => ({ projectId: r.projectId, agent: r.agent, lastSessionId: r.lastSessionId ?? null }))
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

  closeAllPanes(): void {
    this.db.exec(`UPDATE workspace_pane SET was_open = 0`)
  }
}
