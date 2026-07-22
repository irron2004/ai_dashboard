import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDb, migrate } from '@apc/core'
import { AgentActivityStore, migratePm } from '@apc/pm'
import type { AgentPaneIdentity } from '@apc/shared'
import { AgentRuntimeCoordinator } from './agent-runtime-coordinator.js'

const pane: AgentPaneIdentity = {
  paneId: 'pane-1', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1', agent: 'codex',
}

describe('AgentRuntimeCoordinator', () => {
  let store: AgentActivityStore
  let emit: ReturnType<typeof vi.fn>
  let clock: string
  let coordinator: AgentRuntimeCoordinator

  beforeEach(() => {
    const db = openDb(':memory:')
    migrate(db)
    migratePm(db)
    store = new AgentActivityStore(db, () => clock)
    emit = vi.fn()
    clock = '2026-07-20T10:00:00Z'
    coordinator = new AgentRuntimeCoordinator(store, { now: () => clock, emit })
  })

  test('persists and emits start, spawn, output, explicit prompt, ready, and stop transitions', () => {
    coordinator.handle({ type: 'start', pane, launchId: 'L1' })
    clock = '2026-07-20T10:00:01Z'
    coordinator.handle({ type: 'spawn', paneId: pane.paneId, launchId: 'L1', sessionId: 'S1' })
    clock = '2026-07-20T10:00:02Z'
    coordinator.handle({ type: 'output', paneId: pane.paneId, launchId: 'L1', currentLabel: '테스트 실행' })
    clock = '2026-07-20T10:00:03Z'
    coordinator.handle({ type: 'prompt', paneId: pane.paneId, launchId: 'L1', prompt: 'permission', currentLabel: '권한 확인' })
    expect(store.get(pane.paneId)).toMatchObject({ phase: 'awaiting_user', currentLabel: '권한 확인' })
    clock = '2026-07-20T10:00:04Z'
    coordinator.handle({ type: 'prompt', paneId: pane.paneId, launchId: 'L1', prompt: 'ready' })
    clock = '2026-07-20T10:00:05Z'
    coordinator.handle({ type: 'stop', paneId: pane.paneId, launchId: 'L1', reason: 'user', exitCode: 0 })

    expect(store.get(pane.paneId)).toMatchObject({
      connection: 'connected', phase: 'idle', processAlive: false, reason: 'user', exitCode: 0, revision: 6,
    })
    expect(emit).toHaveBeenCalledTimes(6)
  })

  test('records only a sanitized question summary and ignores an old launch event', () => {
    coordinator.handle({ type: 'start', pane, launchId: 'L1' })
    coordinator.handle({ type: 'start', pane, launchId: 'L2' })
    const before = store.get(pane.paneId)!
    const late = coordinator.handle({ type: 'exit', paneId: pane.paneId, launchId: 'L1', reason: 'late', exitCode: 1 })
    expect(late).toEqual(before)

    coordinator.handle({
      type: 'question', paneId: pane.paneId, launchId: 'L2',
      question: { displayText: '[민감한 질문]', askedAt: clock, privacy: 'masked', source: 'pty' },
    })
    expect(store.get(pane.paneId)?.lastQuestion).toEqual({
      displayText: '[민감한 질문]', askedAt: clock, privacy: 'masked', source: 'pty',
    })
    expect(emit).toHaveBeenCalledTimes(3)
  })

  test('separates local errors, unexpected exits, and transport disconnects', () => {
    coordinator.handle({ type: 'start', pane, launchId: 'L1' })
    coordinator.handle({ type: 'error', paneId: pane.paneId, launchId: 'L1', reason: 'ENOENT' })
    expect(store.get(pane.paneId)?.connection).toBe('error')

    coordinator.handle({ type: 'start', pane, launchId: 'L2' })
    coordinator.handle({ type: 'exit', paneId: pane.paneId, launchId: 'L2', reason: 'signal', exitCode: 137 })
    expect(store.get(pane.paneId)).toMatchObject({ connection: 'disconnected', reason: 'signal' })

    coordinator.handle({ type: 'start', pane, launchId: 'L3' })
    coordinator.handle({ type: 'disconnect', paneId: pane.paneId, launchId: 'L3', reason: 'ssh-closed' })
    expect(store.get(pane.paneId)).toMatchObject({ connection: 'disconnected', reason: 'ssh-closed' })
  })
})
