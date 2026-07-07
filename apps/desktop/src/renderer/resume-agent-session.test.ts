import { describe, test, expect, beforeEach } from 'vitest'
import { useStore } from './store.js'

describe('resumeAgentSession', () => {
  beforeEach(() => useStore.setState({ openPanes: {}, restartNonce: {}, stoppingKeys: {} } as any))

  test('sets the pane sessionId and bumps restartNonce together', () => {
    useStore.getState().resumeAgentSession('p1:claude', 'sess-123')
    const s = useStore.getState()
    expect(s.openPanes['p1:claude']).toEqual({ agent: 'claude', sessionId: 'sess-123' })
    expect(s.restartNonce['p1:claude']).toBe(1)
  })

  test('increments an existing restartNonce rather than resetting it', () => {
    useStore.setState({ restartNonce: { 'p1:claude': 3 } } as any)
    useStore.getState().resumeAgentSession('p1:claude', 'sess-456')
    const s = useStore.getState()
    expect(s.restartNonce['p1:claude']).toBe(4)
    expect(s.openPanes['p1:claude'].sessionId).toBe('sess-456')
  })

  test('preserves the pane agent when the pane is already open, else derives it from the key', () => {
    useStore.setState({ openPanes: { 'p1:codex': { agent: 'codex', sessionId: null } } } as any)
    useStore.getState().resumeAgentSession('p1:codex', 'sess-789')
    expect(useStore.getState().openPanes['p1:codex']).toEqual({ agent: 'codex', sessionId: 'sess-789' })
  })

  test('clears a lingering stoppingKeys flag (mirrors restartAgent), same as a plain restart', () => {
    useStore.setState({ stoppingKeys: { 'p1:claude': true } } as any)
    useStore.getState().resumeAgentSession('p1:claude', 'sess-123')
    expect(useStore.getState().stoppingKeys['p1:claude']).toBeUndefined()
  })
})
