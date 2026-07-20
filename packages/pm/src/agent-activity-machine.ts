import { AgentActivitySchema, type AgentActivity, type AgentPaneIdentity, type AgentQuestionSummary } from '@apc/shared'

export type AgentActivityEvent =
  | { type: 'start_requested'; pane: AgentPaneIdentity; launchId: string; currentLabel?: string }
  | { type: 'spawn_success'; launchId: string; sessionId?: string }
  | { type: 'question_submitted'; launchId: string; question: AgentQuestionSummary; currentLabel?: string }
  | { type: 'substantive_output'; launchId: string; currentLabel?: string }
  | { type: 'awaiting_user'; launchId: string; currentLabel?: string }
  | { type: 'assistant_complete'; launchId: string }
  | { type: 'intentional_stop'; launchId: string; reason: 'user' | 'restart' | 'unmount' | 'quit'; exitCode?: number }
  | { type: 'spawn_failure'; launchId: string; reason: string; exitCode?: number }
  | { type: 'unexpected_exit'; launchId: string; reason: string; exitCode?: number }
  | { type: 'transport_lost'; launchId: string; reason: string; exitCode?: number }
  | { type: 'silence_tick'; launchId: string }

export type AgentActivityTransition = {
  accepted: boolean
  changed: boolean
  activity?: AgentActivity
}

export type AgentActivityMachineOptions = {
  now?: () => string
  quietAfterMs?: number
}

function timestampMs(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nextRevision(current: AgentActivity | undefined): number {
  return (current?.revision ?? 0) + 1
}

function changed(current: AgentActivity | undefined, next: AgentActivity): AgentActivityTransition {
  return { accepted: true, changed: true, activity: AgentActivitySchema.parse(next) }
}

/** Pure, pane-scoped state transition. A launch mismatch is ignored before it can alter current state. */
export function transitionAgentActivity(
  current: AgentActivity | undefined,
  event: AgentActivityEvent,
  options: AgentActivityMachineOptions = {},
): AgentActivityTransition {
  const now = options.now?.() ?? new Date().toISOString()
  const quietAfterMs = options.quietAfterMs ?? 30_000

  if (event.type === 'start_requested') {
    const next = AgentActivitySchema.parse({
      pane: event.pane,
      launchId: event.launchId,
      connection: 'starting',
      phase: 'idle',
      processAlive: false,
      lastActivityAt: now,
      currentLabel: event.currentLabel,
      lastQuestion: current?.lastQuestion,
      revision: nextRevision(current),
    })
    return changed(current, next)
  }

  if (!current || current.launchId !== event.launchId) {
    return { accepted: false, changed: false, activity: current }
  }

  if (event.type === 'silence_tick') {
    const lastActivity = timestampMs(current.lastActivityAt)
    const tick = timestampMs(now)
    if (lastActivity === null || tick === null || tick - lastActivity < quietAfterMs) {
      return { accepted: true, changed: false, activity: current }
    }
    const staleSince = new Date(lastActivity + quietAfterMs).toISOString()
    if (current.staleSince === staleSince) return { accepted: true, changed: false, activity: current }
    return changed(current, {
      ...current,
      staleSince,
      revision: nextRevision(current),
    })
  }

  const activeBase = {
    ...current,
    lastActivityAt: now,
    staleSince: undefined,
    exitCode: undefined,
    reason: undefined,
    revision: nextRevision(current),
  }

  switch (event.type) {
    case 'spawn_success':
      return changed(current, {
        ...activeBase,
        pane: event.sessionId ? { ...current.pane, sessionId: event.sessionId } : current.pane,
        connection: 'connected', phase: 'idle', processAlive: true,
      })
    case 'question_submitted':
      return changed(current, {
        ...activeBase,
        connection: 'connected', phase: 'working', processAlive: true,
        lastInputAt: now, lastQuestion: event.question,
        currentLabel: event.currentLabel ?? current.currentLabel,
      })
    case 'substantive_output':
      return changed(current, {
        ...activeBase,
        connection: 'connected', phase: 'working', processAlive: true,
        lastOutputAt: now, currentLabel: event.currentLabel ?? current.currentLabel,
      })
    case 'awaiting_user':
      return changed(current, {
        ...activeBase,
        connection: 'connected', phase: 'awaiting_user', processAlive: true,
        lastOutputAt: now, currentLabel: event.currentLabel ?? current.currentLabel,
      })
    case 'assistant_complete':
      return changed(current, {
        ...activeBase,
        connection: 'connected', phase: 'idle', processAlive: current.processAlive,
        lastOutputAt: now, currentLabel: undefined,
      })
    case 'intentional_stop':
      return changed(current, {
        ...activeBase,
        connection: 'connected', phase: 'idle', processAlive: false,
        exitCode: event.exitCode, reason: event.reason, currentLabel: undefined,
      })
    case 'spawn_failure':
      return changed(current, {
        ...activeBase,
        connection: 'error', phase: 'idle', processAlive: false,
        exitCode: event.exitCode, reason: event.reason, currentLabel: undefined,
      })
    case 'unexpected_exit':
    case 'transport_lost':
      return changed(current, {
        ...activeBase,
        connection: 'disconnected', phase: 'idle', processAlive: false,
        exitCode: event.exitCode, reason: event.reason, currentLabel: undefined,
      })
  }
}

/** PTYs do not survive a desktop main-process restart; preserve display history, not liveness. */
export function normalizeRestoredAgentActivity(activity: AgentActivity, reason = 'app-restart'): AgentActivity {
  if (activity.connection === 'disconnected' && !activity.processAlive) return activity
  return AgentActivitySchema.parse({
    ...activity,
    connection: 'disconnected',
    processAlive: false,
    reason,
    revision: activity.revision + 1,
  })
}
