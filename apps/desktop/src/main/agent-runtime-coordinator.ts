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
  outputCoalesceMs?: number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}

/** Serializes runtime facts through the shared state machine, revision guard, persistence, and emit. */
export class AgentRuntimeCoordinator {
  private readonly now: () => string
  private readonly emit: (activity: AgentActivity) => void
  private readonly outputCoalesceMs: number
  private readonly schedule: NonNullable<CoordinatorDeps['schedule']>
  private readonly cancel: NonNullable<CoordinatorDeps['cancel']>
  private readonly currentByPane = new Map<string, AgentActivity>()
  private readonly pendingOutput = new Map<string, { activity: AgentActivity; handle: unknown }>()

  constructor(private readonly store: AgentActivityStore, deps: CoordinatorDeps = {}) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.emit = deps.emit ?? (() => {})
    this.outputCoalesceMs = Math.max(0, deps.outputCoalesceMs ?? 500)
    this.schedule = deps.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.cancel = deps.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  handle(event: AgentRuntimeCoordinatorEvent): AgentActivity | undefined {
    const paneId = event.type === 'start' ? event.pane.paneId : event.paneId
    const current = this.current(paneId)
    const machineEvent = this.toMachineEvent(event)
    const transition = transitionAgentActivity(current, machineEvent, { now: this.now })
    if (!transition.accepted || !transition.changed || !transition.activity) return transition.activity
    this.currentByPane.set(paneId, transition.activity)

    if (event.type === 'output') {
      this.queueOutput(transition.activity)
      return transition.activity
    }

    // An immediate transition contains all fields from any pending output and has a newer revision,
    // so persisting only the immediate state avoids a redundant write without losing information.
    this.cancelPendingOutput(paneId)
    return this.persist(transition.activity)
  }

  normalizeStartup(): AgentActivity[] {
    this.flush()
    this.currentByPane.clear()
    this.store.normalizeStartup()
    const activities = this.store.list()
    for (const activity of activities) this.currentByPane.set(activity.pane.paneId, activity)
    return activities
  }

  get(paneId: string): AgentActivity | undefined {
    return this.current(paneId)
  }

  list(projectId?: string): AgentActivity[] {
    return [...this.currentByPane.values()]
      .filter((activity) => !projectId || activity.pane.projectId === projectId)
      .sort((left, right) => (
        right.lastActivityAt.localeCompare(left.lastActivityAt)
        || left.pane.paneId.localeCompare(right.pane.paneId)
      ))
  }

  listLive(): AgentActivity[] {
    return [...this.currentByPane.values()].filter((activity) => activity.processAlive)
  }

  deleteProject(projectId: string): number {
    for (const [paneId, activity] of this.currentByPane) {
      if (activity.pane.projectId !== projectId) continue
      this.cancelPendingOutput(paneId)
      this.currentByPane.delete(paneId)
    }
    return this.store.deleteProject(projectId)
  }

  pruneInactive(inactiveBefore: string, validProjectIds: readonly string[]): number {
    this.flush()
    const deleted = this.store.pruneInactive(inactiveBefore, validProjectIds)
    this.currentByPane.clear()
    for (const activity of this.store.list()) this.currentByPane.set(activity.pane.paneId, activity)
    return deleted
  }

  /** Persist the latest coalesced output state synchronously, including during app shutdown. */
  flush(paneId?: string): void {
    if (paneId) {
      this.flushPendingOutput(paneId)
      return
    }
    for (const pendingPaneId of [...this.pendingOutput.keys()]) {
      this.flushPendingOutput(pendingPaneId)
    }
  }

  private current(paneId: string): AgentActivity | undefined {
    if (this.currentByPane.has(paneId)) return this.currentByPane.get(paneId)
    const stored = this.store.get(paneId)
    if (stored) this.currentByPane.set(paneId, stored)
    return stored
  }

  private queueOutput(activity: AgentActivity): void {
    const paneId = activity.pane.paneId
    if (this.outputCoalesceMs === 0) {
      this.persist(activity)
      return
    }
    const pending = this.pendingOutput.get(paneId)
    if (pending) {
      pending.activity = activity
      return
    }
    const handle = this.schedule(() => this.flushPendingOutput(paneId), this.outputCoalesceMs)
    this.pendingOutput.set(paneId, { activity, handle })
  }

  private cancelPendingOutput(paneId: string): void {
    const pending = this.pendingOutput.get(paneId)
    if (!pending) return
    this.pendingOutput.delete(paneId)
    this.cancel(pending.handle)
  }

  private flushPendingOutput(paneId: string): void {
    const pending = this.pendingOutput.get(paneId)
    if (!pending) return
    this.pendingOutput.delete(paneId)
    this.cancel(pending.handle)
    this.persist(pending.activity)
  }

  private persist(activity: AgentActivity): AgentActivity | undefined {
    if (this.store.put(activity)) {
      this.emit(activity)
      return activity
    }
    const stored = this.store.get(activity.pane.paneId)
    if (stored) this.currentByPane.set(activity.pane.paneId, stored)
    return stored
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
