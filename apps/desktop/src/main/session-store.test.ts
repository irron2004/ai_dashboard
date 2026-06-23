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
})
