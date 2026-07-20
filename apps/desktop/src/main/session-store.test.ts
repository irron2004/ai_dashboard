// apps/desktop/src/main/session-store.test.ts
// NOTE: better-sqlite3는 Electron ABI 전용이라 vitest에서 로드 불가 → node 22 내장 node:sqlite 사용.
import { describe, test, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SessionStore } from './session-store.js'

let store: SessionStore
beforeEach(() => {
  store = new SessionStore(new DatabaseSync(':memory:'))
  store.ensureSchema()
})

describe('SessionStore', () => {
  test('upsert + listOpenPanes returns only open panes', () => {
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'sid', wasOpen: true })
    store.upsertPane({ projectId: 'p1', agent: 'codex', lastSessionId: null, wasOpen: false })
    const open = store.listOpenPanes()
    expect(open).toEqual([{ projectId: 'p1', agent: 'claude', lastSessionId: 'sid' }])
  })

  test('upsert replaces same (project,agent)', () => {
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'a', wasOpen: true })
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'b', wasOpen: true })
    expect(store.listOpenPanes()).toEqual([{ projectId: 'p1', agent: 'claude', lastSessionId: 'b' }])
  })

  test('app_state round-trips', () => {
    expect(store.getState('selected_project_id')).toBeNull()
    store.setState('selected_project_id', 'p1')
    expect(store.getState('selected_project_id')).toBe('p1')
  })

  test('closeAllPanes clears was_open', () => {
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'a', wasOpen: true })
    store.closeAllPanes()
    expect(store.listOpenPanes()).toEqual([])
  })

  test('last_session_id preserved through close+reopen when omitted', () => {
    // Initial open with a session id
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'a', wasOpen: true })
    // paneClosed: no lastSessionId provided — must NOT wipe 'a'
    store.upsertPane({ projectId: 'p1', agent: 'claude', wasOpen: false })
    // Reopen: no lastSessionId provided — must still preserve 'a'
    store.upsertPane({ projectId: 'p1', agent: 'claude', wasOpen: true })
    expect(store.listOpenPanes()).toEqual([{ projectId: 'p1', agent: 'claude', lastSessionId: 'a' }])
  })

  test('v2 keeps duplicate agent panes isolated by worktree and slot', () => {
    store.upsertPane({
      paneId: 'pane-main', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1',
      agent: 'codex', lastSessionId: 'main-session', wasOpen: true,
    })
    store.upsertPane({
      paneId: 'pane-feature', projectId: 'p1', worktreePath: '/repo-feature', slotId: 'codex-1',
      agent: 'codex', lastSessionId: 'feature-session', wasOpen: true,
    })

    expect(store.listOpenPaneRecords()).toEqual([
      {
        paneId: 'pane-main', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1',
        agent: 'codex', lastSessionId: 'main-session', wasOpen: true,
      },
      {
        paneId: 'pane-feature', projectId: 'p1', worktreePath: '/repo-feature', slotId: 'codex-1',
        agent: 'codex', lastSessionId: 'feature-session', wasOpen: true,
      },
    ])
  })

  test('ensureSchema migrates legacy rows into the primary worktree first slot once', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE workspace_pane (
        project_id TEXT NOT NULL, agent TEXT NOT NULL, last_session_id TEXT,
        last_active TEXT, was_open INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, agent)
      );
      INSERT INTO workspace_pane VALUES ('p1', 'claude', 'legacy-session', '2026-07-20T00:00:00Z', 1);
    `)
    const migrated = new SessionStore(db, { primaryWorktreeForProject: () => '/repo' })
    migrated.ensureSchema()
    migrated.ensureSchema()

    expect(migrated.listOpenPaneRecords()).toEqual([{
      paneId: 'legacy:p1:claude:1', projectId: 'p1', worktreePath: '/repo', slotId: 'claude-1',
      agent: 'claude', lastSessionId: 'legacy-session', wasOpen: true,
    }])
  })
})
