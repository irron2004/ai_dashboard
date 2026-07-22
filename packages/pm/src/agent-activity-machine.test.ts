import { describe, expect, test } from 'vitest'
import type { AgentActivity, AgentPaneIdentity, AgentQuestionSummary } from '@apc/shared'
import { normalizeRestoredAgentActivity, transitionAgentActivity } from './agent-activity-machine.js'

const pane: AgentPaneIdentity = {
  paneId: 'pane-1', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1', agent: 'codex',
}
const question: AgentQuestionSummary = {
  displayText: '테스트를 실행해줘', askedAt: '2026-07-20T10:00:02Z', privacy: 'visible', source: 'pty',
}

function at(value: string) {
  return { now: () => value }
}

describe('transitionAgentActivity', () => {
  test('follows start, spawn, work, await, complete, and intentional stop facts', () => {
    let activity = transitionAgentActivity(undefined, {
      type: 'start_requested', pane, launchId: 'L1', currentLabel: '터미널 시작',
    }, at('2026-07-20T10:00:00Z')).activity!
    expect(activity).toMatchObject({ connection: 'starting', phase: 'idle', processAlive: false, revision: 1 })

    activity = transitionAgentActivity(activity, { type: 'spawn_success', launchId: 'L1', sessionId: 'S1' }, at('2026-07-20T10:00:01Z')).activity!
    expect(activity).toMatchObject({ connection: 'connected', phase: 'idle', processAlive: true, pane: { sessionId: 'S1' } })

    activity = transitionAgentActivity(activity, { type: 'question_submitted', launchId: 'L1', question }, at('2026-07-20T10:00:02Z')).activity!
    expect(activity).toMatchObject({ phase: 'working', lastInputAt: '2026-07-20T10:00:02Z', lastQuestion: question })

    activity = transitionAgentActivity(activity, { type: 'substantive_output', launchId: 'L1', currentLabel: '테스트 실행' }, at('2026-07-20T10:00:03Z')).activity!
    expect(activity).toMatchObject({ phase: 'working', lastOutputAt: '2026-07-20T10:00:03Z', currentLabel: '테스트 실행' })

    activity = transitionAgentActivity(activity, { type: 'awaiting_user', launchId: 'L1', currentLabel: '권한 확인' }, at('2026-07-20T10:00:04Z')).activity!
    expect(activity).toMatchObject({ phase: 'awaiting_user', processAlive: true })

    activity = transitionAgentActivity(activity, { type: 'assistant_complete', launchId: 'L1' }, at('2026-07-20T10:00:05Z')).activity!
    expect(activity).toMatchObject({ connection: 'connected', phase: 'idle', processAlive: true })

    activity = transitionAgentActivity(activity, { type: 'intentional_stop', launchId: 'L1', reason: 'user', exitCode: 0 }, at('2026-07-20T10:00:06Z')).activity!
    expect(activity).toMatchObject({ connection: 'connected', phase: 'idle', processAlive: false, reason: 'user', exitCode: 0 })
  })

  test('distinguishes a spawn error from unexpected exit and transport loss', () => {
    const starting = transitionAgentActivity(undefined, { type: 'start_requested', pane, launchId: 'L1' }, at('2026-07-20T10:00:00Z')).activity!
    const failed = transitionAgentActivity(starting, { type: 'spawn_failure', launchId: 'L1', reason: 'ENOENT' }, at('2026-07-20T10:00:01Z')).activity!
    expect(failed).toMatchObject({ connection: 'error', processAlive: false, reason: 'ENOENT' })

    const restarted = transitionAgentActivity(failed, { type: 'start_requested', pane, launchId: 'L2' }, at('2026-07-20T10:01:00Z')).activity!
    const exited = transitionAgentActivity(restarted, { type: 'unexpected_exit', launchId: 'L2', reason: 'signal', exitCode: 137 }, at('2026-07-20T10:01:01Z')).activity!
    expect(exited).toMatchObject({ connection: 'disconnected', phase: 'idle', processAlive: false, exitCode: 137 })

    const again = transitionAgentActivity(exited, { type: 'start_requested', pane, launchId: 'L3' }, at('2026-07-20T10:02:00Z')).activity!
    const lost = transitionAgentActivity(again, { type: 'transport_lost', launchId: 'L3', reason: 'ssh-closed' }, at('2026-07-20T10:02:01Z')).activity!
    expect(lost).toMatchObject({ connection: 'disconnected', reason: 'ssh-closed' })
  })

  test('silence changes only staleSince and never invents awaiting_user', () => {
    const working = transitionAgentActivity(undefined, { type: 'start_requested', pane, launchId: 'L1' }, at('2026-07-20T10:00:00Z')).activity!
    const output = transitionAgentActivity(working, { type: 'substantive_output', launchId: 'L1' }, at('2026-07-20T10:00:01Z')).activity!
    const quiet = transitionAgentActivity(output, { type: 'silence_tick', launchId: 'L1' }, at('2026-07-20T10:00:29Z'))
    expect(quiet).toMatchObject({ accepted: true, changed: false })

    const stale = transitionAgentActivity(output, { type: 'silence_tick', launchId: 'L1' }, at('2026-07-20T10:00:32Z')).activity!
    expect(stale).toMatchObject({ phase: 'working', staleSince: '2026-07-20T10:00:31.000Z' })
    const veryStale = transitionAgentActivity(stale, { type: 'silence_tick', launchId: 'L1' }, at('2026-07-20T10:02:30Z'))
    expect(veryStale.changed).toBe(false)
    expect(veryStale.activity?.phase).toBe('working')

    const resumed = transitionAgentActivity(stale, { type: 'substantive_output', launchId: 'L1' }, at('2026-07-20T10:02:31Z')).activity!
    expect(resumed.staleSince).toBeUndefined()
  })

  test('rejects late events from an old launch', () => {
    const first = transitionAgentActivity(undefined, { type: 'start_requested', pane, launchId: 'L1' }, at('2026-07-20T10:00:00Z')).activity!
    const current = transitionAgentActivity(first, { type: 'start_requested', pane, launchId: 'L2' }, at('2026-07-20T10:00:01Z')).activity!
    const late = transitionAgentActivity(current, { type: 'unexpected_exit', launchId: 'L1', reason: 'late-exit' }, at('2026-07-20T10:00:02Z'))
    expect(late).toEqual({ accepted: false, changed: false, activity: current })
  })
})

test('restart normalization preserves phase, question, and activity time while clearing liveness', () => {
  const activity: AgentActivity = {
    pane, launchId: 'L1', connection: 'connected', phase: 'awaiting_user', processAlive: true,
    lastActivityAt: '2026-07-20T10:00:00Z', lastQuestion: question, revision: 8,
  }
  expect(normalizeRestoredAgentActivity(activity)).toEqual({
    ...activity, connection: 'disconnected', processAlive: false, reason: 'app-restart', revision: 9,
  })
})
