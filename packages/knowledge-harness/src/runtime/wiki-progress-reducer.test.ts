import { describe, expect, test } from 'vitest'
import { WikiRunEventSchema, type WikiRunEvent } from '@apc/shared'
import { reduceWikiProgress, WikiProgressAccumulator } from './wiki-progress-reducer.js'

function event(seq: number, kind: string, payload: Record<string, unknown> = {}): WikiRunEvent {
  return WikiRunEventSchema.parse({
    version: 1,
    seq,
    eventId: `event-${seq}`,
    runId: 'RUN-1',
    projectId: 'p1',
    at: `2026-07-20T10:00:${String(seq).padStart(2, '0')}Z`,
    kind,
    ...payload,
  })
}

describe('reduceWikiProgress', () => {
  test('sorts by seq and reduces worker, retry, terminal, and phase facts', () => {
    const events = [
      event(1, 'run_started'),
      event(2, 'phase_started', { phase: 'NODE_PROPOSALS' }),
      event(3, 'work_planned', { total: 3 }),
      event(4, 'worker_started', { workerId: 'w1', folder: 'src', attempt: 1 }),
      event(5, 'worker_retrying', { workerId: 'w1', folder: 'src', attempt: 2, message: 'retry' }),
      event(6, 'worker_started', { workerId: 'w1', folder: 'src', attempt: 2 }),
      event(7, 'worker_completed', { workerId: 'w1', folder: 'src', attempt: 2 }),
      event(8, 'worker_started', { workerId: 'w2', folder: 'docs', attempt: 1 }),
      event(9, 'worker_failed', { workerId: 'w2', folder: 'docs', attempt: 1, message: 'failed' }),
      event(10, 'run_completed'),
    ].reverse()

    const summary = reduceWikiProgress(events)
    expect(summary).toMatchObject({
      runId: 'RUN-1', projectId: 'p1', status: 'completed', health: 'active',
      phase: 'NODE_PROPOSALS', startedAt: '2026-07-20T10:00:01Z',
      lastActivityAt: '2026-07-20T10:00:10Z', endedAt: '2026-07-20T10:00:10Z',
      work: { total: 3, completed: 1, inProgress: 0, failed: 1, retries: 1 },
    })
    expect(summary?.workers).toEqual([
      expect.objectContaining({ workerId: 'w1', status: 'completed', attempt: 2 }),
      expect.objectContaining({ workerId: 'w2', status: 'failed', attempt: 1, message: 'failed' }),
    ])
  })

  test('derives waiting, reconnecting, failure, and terminal success only from explicit facts', () => {
    const base = [event(1, 'run_started')]
    expect(reduceWikiProgress([...base, event(2, 'engine_request_started')])?.status).toBe('waiting')
    expect(reduceWikiProgress([...base, event(2, 'transport_reconnecting', { attempt: 1 })])?.status).toBe('reconnecting')
    expect(reduceWikiProgress([...base, event(2, 'phase_failed', { phase: 'SOURCES_EXTRACTED' })])?.status).toBe('failed')
    expect(reduceWikiProgress([...base, event(2, 'run_completed')])?.status).toBe('completed')
  })

  test('reconciles pre-dedupe discoveries to accepted and dropped final nodes without regression', () => {
    const summary = reduceWikiProgress([
      event(1, 'run_started'),
      event(2, 'node_discovered', {
        workerId: 'w1', proposalId: 'p1', title: 'Alpha', nodeType: 'concept', sourceFolder: 'src',
      }),
      event(3, 'node_accepted', {
        workerId: 'w1', proposalId: 'p1', title: 'Alpha final', nodeType: 'concept', sourceFolder: 'src',
      }),
      event(4, 'node_discovered', {
        workerId: 'w1', proposalId: 'p1', title: 'late duplicate', nodeType: 'concept', sourceFolder: 'src',
      }),
      event(5, 'node_discovered', {
        workerId: 'w2', proposalId: 'p2', title: 'Beta', nodeType: 'document', sourceFolder: 'docs',
      }),
      event(6, 'node_dropped', {
        workerId: 'w2', proposalId: 'p2', title: 'Beta', nodeType: 'document', sourceFolder: 'docs',
      }),
    ])

    expect(summary?.nodes).toEqual([
      expect.objectContaining({
        workerId: 'w1', proposalId: 'p1', title: 'Alpha final', status: 'accepted',
        discoveredAt: '2026-07-20T10:00:02Z', updatedAt: '2026-07-20T10:00:03Z',
      }),
      expect.objectContaining({ workerId: 'w2', proposalId: 'p2', status: 'dropped', discoveredAt: '2026-07-20T10:00:05Z' }),
    ])
  })

  test('returns empty for no events and rejects mixed run identities', () => {
    expect(reduceWikiProgress([])).toBeUndefined()
    const other = WikiRunEventSchema.parse({
      ...event(2, 'run_completed'), runId: 'RUN-2', eventId: 'other',
    })
    expect(() => reduceWikiProgress([event(1, 'run_started'), other])).toThrow('different runs')
  })

  test('deduplicates the same durable eventId when snapshot, journal, and live tails overlap', () => {
    const retry = event(3, 'worker_retrying', { workerId: 'w1', folder: 'src', attempt: 2 })
    const summary = reduceWikiProgress([
      event(1, 'run_started'),
      event(2, 'worker_started', { workerId: 'w1', folder: 'src', attempt: 1 }),
      retry,
      retry,
    ])
    expect(summary?.work.retries).toBe(1)
  })

  test('incremental accumulation matches a full replay after every worker transition', () => {
    const events = [
      event(1, 'run_started'),
      event(2, 'work_planned', { total: 2 }),
      event(3, 'worker_started', { workerId: 'w1', folder: 'src', attempt: 1 }),
      event(4, 'worker_retrying', { workerId: 'w1', folder: 'src', attempt: 2 }),
      event(5, 'worker_completed', { workerId: 'w1', folder: 'src', attempt: 2 }),
      event(6, 'worker_started', { workerId: 'w2', folder: 'docs', attempt: 1 }),
      event(7, 'worker_failed', { workerId: 'w2', folder: 'docs', attempt: 1 }),
    ]
    const accumulator = new WikiProgressAccumulator()
    events.forEach((item, index) => {
      accumulator.add(item)
      expect(accumulator.summary()).toEqual(reduceWikiProgress(events.slice(0, index + 1)))
    })
    expect(accumulator.eventCount).toBe(events.length)
    expect(accumulator.maximumSeq).toBe(7)
  })
})
