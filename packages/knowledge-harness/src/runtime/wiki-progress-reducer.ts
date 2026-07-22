import {
  WikiProgressSummarySchema,
  type WikiNodeProgress,
  type WikiProgressSummary,
  type WikiRunEvent,
  type WikiWorkerSummary,
} from '@apc/shared'

type MutableWorker = WikiWorkerSummary
type MutableNode = WikiNodeProgress

function nodeKey(workerId: string, proposalId: string): string {
  return `${workerId}\u0000${proposalId}`
}

function isTerminal(status: WikiProgressSummary['status']): boolean {
  return status === 'completed' || status === 'failed'
}

/** Reduces the durable event envelope only; wall-clock quiet/stalled health is a renderer concern. */
export function reduceWikiProgress(events: readonly WikiRunEvent[]): WikiProgressSummary | undefined {
  if (events.length === 0) return undefined
  const eventIds = new Set<string>()
  const ordered = [...events]
    .sort((left, right) => left.seq - right.seq)
    .filter((event) => {
      if (eventIds.has(event.eventId)) return false
      eventIds.add(event.eventId)
      return true
    })
  const first = ordered[0]
  const workers = new Map<string, MutableWorker>()
  const nodes = new Map<string, MutableNode>()
  let status: WikiProgressSummary['status'] = 'generating'
  let phase: string | undefined
  let startedAt = first.at
  let lastActivityAt = first.at
  let endedAt: string | undefined
  let total = 0
  let retries = 0

  const setNonterminalStatus = (next: WikiProgressSummary['status']) => {
    if (!isTerminal(status)) status = next
  }

  for (const event of ordered) {
    if (event.runId !== first.runId || event.projectId !== first.projectId) {
      throw new Error('Wiki progress events from different runs cannot be reduced together')
    }
    lastActivityAt = event.at

    switch (event.kind) {
      case 'run_started':
        startedAt = event.at
        setNonterminalStatus('generating')
        break
      case 'run_completed':
        status = 'completed'
        endedAt = event.at
        break
      case 'run_failed':
        status = 'failed'
        endedAt = event.at
        break
      case 'phase_started':
      case 'phase_completed':
        phase = event.phase
        setNonterminalStatus('generating')
        break
      case 'phase_failed':
        phase = event.phase
        status = 'failed'
        break
      case 'phase_paused':
        phase = event.phase
        setNonterminalStatus('waiting')
        break
      case 'work_planned':
        total = event.total
        setNonterminalStatus('generating')
        break
      case 'worker_started':
      case 'worker_completed':
      case 'worker_failed':
      case 'worker_retrying': {
        const current = workers.get(event.workerId)
        const workerStatus: WikiWorkerSummary['status'] = event.kind === 'worker_started'
          ? 'running'
          : event.kind === 'worker_completed'
            ? 'completed'
            : event.kind === 'worker_failed'
              ? 'failed'
              : 'retrying'
        if (event.kind === 'worker_retrying') retries += 1
        workers.set(event.workerId, {
          workerId: event.workerId,
          folder: event.folder ?? current?.folder,
          attempt: event.attempt,
          status: workerStatus,
          lastActivityAt: event.at,
          message: event.message,
        })
        setNonterminalStatus('generating')
        break
      }
      case 'node_discovered':
      case 'node_accepted':
      case 'node_dropped': {
        const key = nodeKey(event.workerId, event.proposalId)
        const current = nodes.get(key)
        const finalDiscovery = event.kind === 'node_discovered'
          && current != null
          && current.status !== 'discovered'
        if (finalDiscovery) {
          setNonterminalStatus('generating')
          break
        }
        const requestedStatus: WikiNodeProgress['status'] = event.kind === 'node_discovered'
          ? 'discovered'
          : event.kind === 'node_accepted'
            ? 'accepted'
            : 'dropped'
        nodes.set(key, {
          workerId: event.workerId,
          proposalId: event.proposalId,
          title: event.title,
          nodeType: event.nodeType,
          sourceFolder: event.sourceFolder ?? current?.sourceFolder,
          status: requestedStatus,
          discoveredAt: current?.discoveredAt ?? event.at,
          updatedAt: event.at,
        })
        setNonterminalStatus('generating')
        break
      }
      case 'engine_request_started':
        setNonterminalStatus('waiting')
        break
      case 'engine_activity':
      case 'engine_request_finished':
        setNonterminalStatus('generating')
        break
      case 'transport_reconnecting':
        setNonterminalStatus('reconnecting')
        break
    }
  }

  const workerList = [...workers.values()]
  const summary = {
    runId: first.runId,
    projectId: first.projectId,
    status,
    health: 'active' as const,
    phase,
    startedAt,
    lastActivityAt,
    endedAt,
    work: {
      total,
      completed: workerList.filter((worker) => worker.status === 'completed').length,
      inProgress: workerList.filter((worker) => worker.status === 'running' || worker.status === 'retrying').length,
      failed: workerList.filter((worker) => worker.status === 'failed').length,
      retries,
    },
    workers: workerList,
    nodes: [...nodes.values()],
  }
  return WikiProgressSummarySchema.parse(summary)
}
