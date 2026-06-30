import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./api.js', () => ({ api: { killPty: vi.fn() } }))
import { api } from './api.js'
import { useStore } from './store.js'

describe('agent run controls (store)', () => {
  beforeEach(() => {
    useStore.setState({ restartNonce: {}, agentStatus: {}, stoppingKeys: {} })
    vi.clearAllMocks()
  })

  it('restartAgent increments the per-key nonce', () => {
    useStore.getState().restartAgent('p1:claude')
    expect(useStore.getState().restartNonce['p1:claude']).toBe(1)
    useStore.getState().restartAgent('p1:claude')
    expect(useStore.getState().restartNonce['p1:claude']).toBe(2)
  })

  it('stopAgent kills the pty by session key and sets status idle', () => {
    useStore.setState({ agentStatus: { 'p1:claude': 'running' } })
    useStore.getState().stopAgent('p1:claude')
    expect(api.killPty).toHaveBeenCalledWith({ id: 'p1:claude' })
    expect(useStore.getState().agentStatus['p1:claude']).toBe('idle')
  })

  it('after stopAgent, a later done status is coerced to idle (manual stop)', () => {
    useStore.setState({ agentStatus: { 'p1:claude': 'running' } })
    useStore.getState().stopAgent('p1:claude')
    expect(useStore.getState().agentStatus['p1:claude']).toBe('idle')
    // AgentTerminal's onPtyExit lands later:
    useStore.getState().setAgentStatus('p1:claude', 'done')
    expect(useStore.getState().agentStatus['p1:claude']).toBe('idle')
  })

  it('a natural done (no prior stop) stays done', () => {
    useStore.getState().setAgentStatus('p1:claude', 'done')
    expect(useStore.getState().agentStatus['p1:claude']).toBe('done')
  })

  it('restartAgent clears stop-intent so a later done is not coerced', () => {
    useStore.getState().stopAgent('p1:claude')
    useStore.getState().restartAgent('p1:claude')
    useStore.getState().setAgentStatus('p1:claude', 'done')
    expect(useStore.getState().agentStatus['p1:claude']).toBe('done')
  })
})
