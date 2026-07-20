import type { WikiProgressSummary, WikiRunEvent } from '@apc/shared'
// Import the browser-safe reducer module directly. The package barrel also exports Node-only runners/fs
// services, which must not enter the renderer bundle merely to replay a plain event array.
import { reduceWikiProgress } from '../../../../packages/knowledge-harness/src/runtime/wiki-progress-reducer.js'

export const WIKI_PROGRESS_QUIET_MS = 30_000
export const WIKI_PROGRESS_STALLED_MS = 120_000

export type WikiProgressState = {
  runId: string
  snapshot: WikiProgressSummary | null
  /** Highest journal sequence included in the last authoritative replay response. */
  snapshotSeq: number
  events: WikiRunEvent[]
  active: boolean
}

export type WikiProgressView = {
  summary: WikiProgressSummary
  statusLabel: '생성 중' | '응답 대기' | '재연결 중' | '완료' | '실패'
  health: WikiProgressSummary['health']
  elapsedMs: number
  lastActivityAgoMs: number
  warning: '응답 대기 중' | '중단 가능성' | null
}

function orderedUnique(events: readonly WikiRunEvent[]): WikiRunEvent[] {
  const byId = new Map<string, WikiRunEvent>()
  for (const event of events) {
    const previous = byId.get(event.eventId)
    if (!previous || event.seq > previous.seq) byId.set(event.eventId, event)
  }
  const bySequence = new Map<number, WikiRunEvent>()
  for (const event of byId.values()) bySequence.set(event.seq, event)
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq)
}

/** Snapshot is a fallback; journal and live events always flow through the shared harness reducer. */
export function createWikiProgressState(input: {
  snapshot?: WikiProgressSummary | null
  events?: readonly WikiRunEvent[]
  active?: boolean
  runId?: string
}): WikiProgressState | null {
  const events = orderedUnique(input.events ?? [])
  const runId = input.runId ?? input.snapshot?.runId ?? events[0]?.runId
  if (!runId) return null
  return {
    runId,
    snapshot: input.snapshot ?? null,
    snapshotSeq: events.reduce((maximum, event) => Math.max(maximum, event.seq), 0),
    events: events.filter((event) => event.runId === runId),
    active: input.active ?? false,
  }
}

/** Replays a server response while preserving live events that arrived after the request began. */
export function mergeWikiProgressReplay(
  current: WikiProgressState | null,
  input: { snapshot: WikiProgressSummary; events: readonly WikiRunEvent[]; active: boolean },
): WikiProgressState {
  const sameRunLive = current?.runId === input.snapshot.runId ? current.events : []
  return {
    runId: input.snapshot.runId,
    snapshot: input.snapshot,
    snapshotSeq: input.events.reduce(
      (maximum, event) => Math.max(maximum, event.seq),
      current?.runId === input.snapshot.runId ? current.snapshotSeq : 0,
    ),
    events: orderedUnique([...input.events, ...sameRunLive])
      .filter((event) => event.runId === input.snapshot.runId),
    active: input.active || (current?.runId === input.snapshot.runId && current.active),
  }
}

export function appendWikiProgressEvent(
  current: WikiProgressState | null,
  event: WikiRunEvent,
): WikiProgressState {
  if (!current || current.runId !== event.runId) {
    return { runId: event.runId, snapshot: null, snapshotSeq: 0, events: [event], active: true }
  }
  if (event.seq <= current.snapshotSeq) return current
  return {
    ...current,
    active: true,
    events: orderedUnique([...current.events, event]),
  }
}

export function wikiProgressSummary(state: WikiProgressState | null): WikiProgressSummary | null {
  if (!state) return null
  const reduced = reduceWikiProgress(state.events) ?? state.snapshot
  if (!reduced) return null
  const terminal = reduced.status === 'completed' || reduced.status === 'failed'
  if (!state.active && !terminal && state.snapshot?.health === 'interrupted') {
    return { ...reduced, health: 'interrupted' }
  }
  return reduced
}

const STATUS_LABEL: Record<WikiProgressSummary['status'], WikiProgressView['statusLabel']> = {
  generating: '생성 중',
  waiting: '응답 대기',
  reconnecting: '재연결 중',
  completed: '완료',
  failed: '실패',
}

/** Adds clock-derived health without inventing a pipeline phase or reconnect event. */
export function deriveWikiProgressView(
  state: WikiProgressState | null,
  nowMs: number,
): WikiProgressView | null {
  const summary = wikiProgressSummary(state)
  if (!summary) return null
  const startedAt = Date.parse(summary.startedAt)
  const lastActivityAt = Date.parse(summary.lastActivityAt)
  const terminal = summary.status === 'completed' || summary.status === 'failed'
  const endAt = terminal && summary.endedAt ? Date.parse(summary.endedAt) : nowMs
  const elapsedMs = Math.max(0, endAt - startedAt)
  const lastActivityAgoMs = Math.max(0, nowMs - lastActivityAt)

  let health: WikiProgressSummary['health'] = terminal ? 'active' : summary.health
  if (!terminal && health !== 'interrupted') {
    if (lastActivityAgoMs >= WIKI_PROGRESS_STALLED_MS) health = 'stalled'
    else if (lastActivityAgoMs >= WIKI_PROGRESS_QUIET_MS) health = 'quiet'
    else health = 'active'
  }
  const warning = health === 'quiet'
    ? '응답 대기 중'
    : health === 'stalled' || health === 'interrupted'
      ? '중단 가능성'
      : null

  return {
    summary: { ...summary, health },
    statusLabel: STATUS_LABEL[summary.status],
    health,
    elapsedMs,
    lastActivityAgoMs,
    warning,
  }
}

export function formatWikiDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}분 ${rest}초` : `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours}시간 ${restMinutes}분` : `${hours}시간`
}
