import { describe, expect, test } from 'vitest'
import { AgentActivitySchema, deriveAgentActivityStatus } from './agent-activity.js'

const base = {
  pane: {
    paneId: 'p1:main:codex-1', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1', agent: 'codex' as const,
  },
  launchId: 'launch-1',
  connection: 'connected' as const,
  phase: 'idle' as const,
  processAlive: true,
  lastActivityAt: '2026-07-20T10:00:00Z',
  revision: 1,
}

describe('AgentActivitySchema', () => {
  test('parses pane-scoped sanitized activity', () => {
    const activity = AgentActivitySchema.parse({
      ...base,
      lastQuestion: {
        displayText: '테스트를 실행해줘', askedAt: '2026-07-20T10:00:00Z',
        privacy: 'visible', source: 'pty',
      },
    })
    expect(activity.pane.slotId).toBe('codex-1')
    expect(activity.lastQuestion?.displayText).toBe('테스트를 실행해줘')
  })

  test('rejects missing pane identity and negative revisions', () => {
    expect(() => AgentActivitySchema.parse({ ...base, pane: { ...base.pane, worktreePath: undefined } })).toThrow()
    expect(() => AgentActivitySchema.parse({ ...base, revision: -1 })).toThrow()
  })
})

describe('deriveAgentActivityStatus', () => {
  test('uses connection failures before work phase', () => {
    expect(deriveAgentActivityStatus({ connection: 'error', phase: 'working' })).toBe('error')
    expect(deriveAgentActivityStatus({ connection: 'disconnected', phase: 'awaiting_user' })).toBe('disconnected')
  })

  test('distinguishes working, waiting, and idle', () => {
    expect(deriveAgentActivityStatus({ connection: 'connected', phase: 'working' })).toBe('working')
    expect(deriveAgentActivityStatus({ connection: 'connected', phase: 'awaiting_user' })).toBe('awaiting_user')
    expect(deriveAgentActivityStatus({ connection: 'starting', phase: 'idle' })).toBe('idle')
  })
})

