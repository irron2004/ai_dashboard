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
})
