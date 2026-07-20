import type { AgentActivity, AgentPaneIdentity, AgentQuestionSummary } from '@apc/shared'
import {
  transitionAgentActivity,
  type AgentActivityEvent,
  type AgentActivityStore,
} from '@apc/pm'

type PaneLaunch = { paneId: string; launchId: string }

export type AgentRuntimeCoordinatorEvent =
  | { type: 'start'; pane: AgentPaneIdentity; launchId: string; currentLabel?: string }
  | ({ type: 'spawn'; sessionId?: string } & PaneLaunch)
  | ({ type: 'output'; currentLabel?: string } & PaneLaunch)
  | ({ type: 'prompt'; prompt: 'permission' | 'clarification' | 'ready'; currentLabel?: string } & PaneLaunch)
  | ({ type: 'question'; question: AgentQuestionSummary; currentLabel?: string } & PaneLaunch)
  | ({ type: 'stop'; reason: 'user' | 'restart' | 'unmount' | 'quit'; exitCode?: number } & PaneLaunch)
  | ({ type: 'error'; reason: string; exitCode?: number } & PaneLaunch)
  | ({ type: 'exit'; reason: string; exitCode?: number } & PaneLaunch)
  | ({ type: 'disconnect'; reason: string; exitCode?: number } & PaneLaunch)
  | ({ type: 'silence' } & PaneLaunch)

type CoordinatorDeps = {
  now?: () => string
  emit?: (activity: AgentActivity) => void
}

/** Serializes runtime facts through the shared state machine, revision guard, persistence, and emit. */
export class AgentRuntimeCoordinator {
  private readonly now: () => string
  private readonly emit: (activity: AgentActivity) => void

  constructor(private readonly store: AgentActivityStore, deps: CoordinatorDeps = {}) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.emit = deps.emit ?? (() => {})
  }

  handle(event: AgentRuntimeCoordinatorEvent): AgentActivity | undefined {
    const paneId = event.type === 'start' ? event.pane.paneId : event.paneId
    const current = this.store.get(paneId)
    const machineEvent = this.toMachineEvent(event)
    const transition = transitionAgentActivity(current, machineEvent, { now: this.now })
    if (!transition.accepted || !transition.changed || !transition.activity) return transition.activity
    if (!this.store.put(transition.activity)) return this.store.get(paneId)
    this.emit(transition.activity)
    return transition.activity
  }

  normalizeStartup(): AgentActivity[] {
    this.store.normalizeStartup()
    return this.store.list()
  }

  private toMachineEvent(event: AgentRuntimeCoordinatorEvent): AgentActivityEvent {
    switch (event.type) {
      case 'start':
        return { type: 'start_requested', pane: event.pane, launchId: event.launchId, currentLabel: event.currentLabel }
      case 'spawn':
        return { type: 'spawn_success', launchId: event.launchId, sessionId: event.sessionId }
      case 'output':
        return { type: 'substantive_output', launchId: event.launchId, currentLabel: event.currentLabel }
      case 'prompt':
        return event.prompt === 'ready'
          ? { type: 'assistant_complete', launchId: event.launchId }
          : { type: 'awaiting_user', launchId: event.launchId, currentLabel: event.currentLabel }
      case 'question':
        return { type: 'question_submitted', launchId: event.launchId, question: event.question, currentLabel: event.currentLabel }
      case 'stop':
        return { type: 'intentional_stop', launchId: event.launchId, reason: event.reason, exitCode: event.exitCode }
      case 'error':
        return { type: 'spawn_failure', launchId: event.launchId, reason: event.reason, exitCode: event.exitCode }
      case 'exit':
        return { type: 'unexpected_exit', launchId: event.launchId, reason: event.reason, exitCode: event.exitCode }
      case 'disconnect':
        return { type: 'transport_lost', launchId: event.launchId, reason: event.reason, exitCode: event.exitCode }
      case 'silence':
        return { type: 'silence_tick', launchId: event.launchId }
    }
  }
}
