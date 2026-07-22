import { describe, expect, test } from 'vitest'
import { WikiProgressSummarySchema, WikiRunEventSchema } from './wiki-run-event.js'

const eventBase = {
  version: 1 as const,
  seq: 1,
  eventId: 'event-1',
  runId: 'run-1',
  projectId: 'project-1',
  at: '2026-07-20T10:00:00Z',
}

describe('WikiRunEventSchema', () => {
  test('parses worker and node lifecycle events', () => {
    const worker = WikiRunEventSchema.parse({
      ...eventBase, kind: 'worker_started', workerId: 'worker-1', folder: 'docs', attempt: 1,
    })
    expect(worker.kind).toBe('worker_started')

    const node = WikiRunEventSchema.parse({
      ...eventBase, seq: 2, eventId: 'event-2', kind: 'node_discovered',
      workerId: 'worker-1', proposalId: 'proposal-1', title: 'Architecture', nodeType: 'design',
    })
    expect(node.kind).toBe('node_discovered')
  })

  test('requires a positive sequence and real retry attempt', () => {
    expect(() => WikiRunEventSchema.parse({ ...eventBase, seq: 0, kind: 'run_started' })).toThrow()
    expect(() => WikiRunEventSchema.parse({
      ...eventBase, kind: 'transport_reconnecting', attempt: 0,
    })).toThrow()
  })
})

describe('WikiProgressSummarySchema', () => {
  test('keeps work totals separate from discovered nodes', () => {
    const summary = WikiProgressSummarySchema.parse({
      runId: 'run-1', projectId: 'project-1', status: 'generating', health: 'active',
      startedAt: eventBase.at, lastActivityAt: eventBase.at,
      work: { total: 2, completed: 1, inProgress: 1, failed: 0, retries: 0 },
      workers: [],
      nodes: [{
        workerId: 'worker-1', proposalId: 'proposal-1', title: 'Architecture', nodeType: 'design',
        status: 'discovered', discoveredAt: eventBase.at, updatedAt: eventBase.at,
      }],
    })
    expect(summary.work.total).toBe(2)
    expect(summary.nodes).toHaveLength(1)
  })
})

