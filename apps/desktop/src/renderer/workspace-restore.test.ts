import { describe, test, expect, beforeEach } from 'vitest'
import { useStore } from './store.js'

describe('hydrateWorkspace', () => {
  beforeEach(() => useStore.setState({ openPanes: {}, selectedProjectId: null } as any))
  test('opens saved panes with sessionId and restores selected project', () => {
    useStore.getState().hydrateWorkspace({
      panes: [{ projectId: 'p1', agent: 'claude', lastSessionId: 'sid' }],
      selectedProjectId: 'p1',
    })
    const s = useStore.getState()
    expect(s.openPanes['p1:claude']).toEqual({ agent: 'claude', sessionId: 'sid' })
    expect(s.selectedProjectId).toBe('p1')
  })

  test('uses an exact persisted pane id when worktree and slot identity are available', () => {
    useStore.getState().hydrateWorkspace({
      panes: [{
        projectId: 'p1', agent: 'codex', paneId: 'p1:main:codex-2',
        worktreePath: '/repo', slotId: 'codex-2', lastSessionId: 'session-2',
      }],
      selectedProjectId: 'p1',
    })

    expect(useStore.getState().openPanes).toEqual({
      'p1:main:codex-2': { agent: 'codex', sessionId: 'session-2' },
    })
  })
})
