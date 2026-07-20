import { describe, expect, test } from 'vitest'
import {
  WikiProgressSummarySchema,
  WikiRunEventSchema,
  type WikiProgressSummary,
  type WikiRunEvent,
} from '@apc/shared'
import {
  appendWikiProgressEvent,
  createWikiProgressState,
  deriveWikiProgressView,
  formatWikiDuration,
  mergeWikiProgressReplay,
  wikiProgressSummary,
} from './wiki-progress-state.js'

const BASE_AT = '2026-07-20T10:00:00.000Z'

function event(seq: number, kind: WikiRunEvent['kind'], detail: Record<string, unknown> = {}): WikiRunEvent {
  return WikiRunEventSchema.parse({
    version: 1,
    seq,
    eventId: `event-${seq}`,
    runId: 'RUN-1',
    projectId: 'p1',
    at: new Date(Date.parse(BASE_AT) + seq * 1000).toISOString(),
    kind,
    ...detail,
  })
}

function snapshot(patch: Partial<WikiProgressSummary> = {}): WikiProgressSummary {
  return WikiProgressSummarySchema.parse({
    runId: 'RUN-1',
    projectId: 'p1',
    status: 'generating',
    health: 'active',
    phase: 'NODE_PROPOSALS_CREATED',
    startedAt: BASE_AT,
    lastActivityAt: BASE_AT,
    work: { total: 2, completed: 0, inProgress: 0, failed: 0, retries: 0 },
    workers: [],
    nodes: [],
    ...patch,
  })
}

describe('wiki progress replay state', () => {
  test('combines snapshot, journal, and out-of-order live events through one reducer', () => {
    const journal = [
      event(1, 'run_started'),
      event(2, 'work_planned', { total: 2 }),
      event(3, 'worker_started', { workerId: 'worker-a', folder: 'docs', attempt: 1 }),
    ]
    let state = createWikiProgressState({ snapshot: snapshot(), events: journal, active: true })
    state = appendWikiProgressEvent(state, event(5, 'node_discovered', {
      workerId: 'worker-a', proposalId: 'proposal-a', title: 'Node A', nodeType: 'ConceptNode', sourceFolder: 'docs',
    }))
    state = appendWikiProgressEvent(state, event(4, 'worker_completed', {
      workerId: 'worker-a', folder: 'docs', attempt: 1,
    }))
    state = appendWikiProgressEvent(state, event(5, 'node_discovered', {
      workerId: 'worker-a', proposalId: 'proposal-a', title: 'Node A', nodeType: 'ConceptNode', sourceFolder: 'docs',
    }))

    const summary = wikiProgressSummary(state)
    expect(state?.events.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5])
    expect(summary).toMatchObject({
      work: { total: 2, completed: 1, inProgress: 0 },
      workers: [{ workerId: 'worker-a', status: 'completed' }],
      nodes: [{ proposalId: 'proposal-a', status: 'discovered' }],
    })
  })

  test('keeps live events that arrive while a restart replay request is in flight', () => {
    let current = createWikiProgressState({ runId: 'RUN-1', active: true })
    current = appendWikiProgressEvent(current, event(3, 'engine_activity'))
    const merged = mergeWikiProgressReplay(current, {
      snapshot: snapshot(),
      events: [event(1, 'run_started'), event(2, 'engine_request_started')],
      active: true,
    })
    expect(merged.events.map((item) => item.seq)).toEqual([1, 2, 3])
    expect(wikiProgressSummary(merged)?.status).toBe('generating')
  })

  test('ignores a differently identified event below the authoritative replay sequence', () => {
    const replayed = createWikiProgressState({
      snapshot: snapshot(),
      events: [event(1, 'run_started'), event(2, 'engine_request_started'), event(3, 'engine_activity')],
      active: true,
    })
    const late = { ...event(2, 'engine_request_started'), eventId: 'late-event-2' }

    const merged = appendWikiProgressEvent(replayed, late)

    expect(merged).toBe(replayed)
    expect(merged.events.map((item) => item.seq)).toEqual([1, 2, 3])
  })

  test('derives quiet at 30s and stalled at 120s without changing generating to reconnecting', () => {
    const state = createWikiProgressState({ snapshot: snapshot(), active: true })
    const base = Date.parse(BASE_AT)
    expect(deriveWikiProgressView(state, base + 29_999)).toMatchObject({ health: 'active', warning: null, statusLabel: '생성 중' })
    expect(deriveWikiProgressView(state, base + 30_000)).toMatchObject({ health: 'quiet', warning: '응답 대기 중', statusLabel: '생성 중' })
    expect(deriveWikiProgressView(state, base + 120_000)).toMatchObject({ health: 'stalled', warning: '중단 가능성', statusLabel: '생성 중' })

    const reconnecting = createWikiProgressState({
      events: [event(1, 'run_started'), event(2, 'transport_reconnecting', { attempt: 1 })],
      active: true,
    })
    expect(deriveWikiProgressView(reconnecting, base + 2_000)?.statusLabel).toBe('재연결 중')
  })

  test('preserves server-authoritative interrupted health for a nonterminal inactive run', () => {
    const state = createWikiProgressState({
      snapshot: snapshot({ status: 'waiting', health: 'interrupted' }),
      events: [event(1, 'run_started'), event(2, 'engine_request_started')],
      active: false,
    })
    expect(deriveWikiProgressView(state, Date.parse(BASE_AT) + 5_000)).toMatchObject({
      health: 'interrupted',
      warning: '중단 가능성',
      statusLabel: '응답 대기',
    })
  })

  test('terminal elapsed time is frozen at endedAt', () => {
    const state = createWikiProgressState({
      snapshot: snapshot({
        status: 'completed',
        endedAt: '2026-07-20T10:01:05.000Z',
        lastActivityAt: '2026-07-20T10:01:05.000Z',
      }),
      active: false,
    })
    const view = deriveWikiProgressView(state, Date.parse(BASE_AT) + 3_600_000)
    expect(view?.elapsedMs).toBe(65_000)
    expect(view?.warning).toBeNull()
    expect(formatWikiDuration(view?.elapsedMs ?? 0)).toBe('1분 5초')
  })
})
