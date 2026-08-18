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

type CountedWorkerStatus = 'completed' | 'inProgress' | 'failed' | null

function countedWorkerStatus(status: WikiWorkerSummary['status']): CountedWorkerStatus {
  if (status === 'completed') return 'completed'
  if (status === 'running' || status === 'retrying') return 'inProgress'
  if (status === 'failed') return 'failed'
  return null
}

/** Incremental durable-event reducer. add() is O(1) average; summary materialization is O(workers + nodes). */
export class WikiProgressAccumulator {
  private readonly eventIds = new Set<string>()
  private readonly workers = new Map<string, MutableWorker>()
  private readonly nodes = new Map<string, MutableNode>()
  private runId: string | undefined
  private projectId: string | undefined
  private status: WikiProgressSummary['status'] = 'generating'
  private phase: string | undefined
  private startedAt: string | undefined
  private lastActivityAt: string | undefined
  private endedAt: string | undefined
  private total = 0
  private retries = 0
  private completed = 0
  private inProgress = 0
  private failed = 0
  private count = 0
  private maxSeq = 0

  get eventCount(): number { return this.count }
  get maximumSeq(): number { return this.maxSeq }

  add(event: WikiRunEvent): boolean {
    if (this.eventIds.has(event.eventId)) return false
    if (this.runId && (event.runId !== this.runId || event.projectId !== this.projectId)) {
      throw new Error('Wiki progress events from different runs cannot be reduced together')
    }
    if (!this.runId) {
      this.runId = event.runId
      this.projectId = event.projectId
      this.startedAt = event.at
    }
    this.eventIds.add(event.eventId)
    this.count += 1
    this.maxSeq = Math.max(this.maxSeq, event.seq)
    this.lastActivityAt = event.at

    switch (event.kind) {
      case 'run_started':
        this.startedAt = event.at
        this.setNonterminalStatus('generating')
        break
      case 'run_completed':
        this.status = 'completed'
        this.endedAt = event.at
        break
      case 'run_failed':
        this.status = 'failed'
        this.endedAt = event.at
        break
      case 'phase_started':
      case 'phase_completed':
        this.phase = event.phase
        this.setNonterminalStatus('generating')
        break
      case 'phase_failed':
        this.phase = event.phase
        this.status = 'failed'
        break
      case 'phase_paused':
        this.phase = event.phase
        this.setNonterminalStatus('waiting')
        break
      case 'work_planned':
        this.total = event.total
        this.setNonterminalStatus('generating')
        break
      case 'worker_started':
      case 'worker_completed':
      case 'worker_failed':
      case 'worker_retrying': {
        const current = this.workers.get(event.workerId)
        const workerStatus: WikiWorkerSummary['status'] = event.kind === 'worker_started'
          ? 'running'
          : event.kind === 'worker_completed'
            ? 'completed'
            : event.kind === 'worker_failed'
            ? 'failed'
              : 'retrying'
        if (event.kind === 'worker_retrying') this.retries += 1
        this.adjustWorkerCount(current?.status, -1)
        this.workers.set(event.workerId, {
          workerId: event.workerId,
          folder: event.folder ?? current?.folder,
          attempt: event.attempt,
          status: workerStatus,
          lastActivityAt: event.at,
          message: event.message,
        })
        this.adjustWorkerCount(workerStatus, 1)
        this.setNonterminalStatus('generating')
        break
      }
      case 'node_discovered':
      case 'node_accepted':
      case 'node_dropped': {
        const key = nodeKey(event.workerId, event.proposalId)
        const current = this.nodes.get(key)
        const finalDiscovery = event.kind === 'node_discovered'
          && current != null
          && current.status !== 'discovered'
        if (finalDiscovery) {
          this.setNonterminalStatus('generating')
          break
        }
        const requestedStatus: WikiNodeProgress['status'] = event.kind === 'node_discovered'
          ? 'discovered'
          : event.kind === 'node_accepted'
            ? 'accepted'
            : 'dropped'
        this.nodes.set(key, {
          workerId: event.workerId,
          proposalId: event.proposalId,
          title: event.title,
          nodeType: event.nodeType,
          sourceFolder: event.sourceFolder ?? current?.sourceFolder,
          status: requestedStatus,
          discoveredAt: current?.discoveredAt ?? event.at,
          updatedAt: event.at,
        })
        this.setNonterminalStatus('generating')
        break
      }
      case 'engine_request_started':
        this.setNonterminalStatus('waiting')
        break
      case 'engine_activity':
      case 'engine_request_finished':
        this.setNonterminalStatus('generating')
        break
      case 'transport_reconnecting':
        this.setNonterminalStatus('reconnecting')
        break
    }
    return true
  }

  summary(): WikiProgressSummary | undefined {
    if (!this.runId || !this.projectId || !this.startedAt || !this.lastActivityAt) return undefined
    return WikiProgressSummarySchema.parse({
      runId: this.runId,
      projectId: this.projectId,
      status: this.status,
      health: 'active',
      phase: this.phase,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      endedAt: this.endedAt,
      work: {
        total: this.total,
        completed: this.completed,
        inProgress: this.inProgress,
        failed: this.failed,
        retries: this.retries,
      },
      workers: [...this.workers.values()],
      nodes: [...this.nodes.values()],
    })
  }

  private setNonterminalStatus(next: WikiProgressSummary['status']): void {
    if (!isTerminal(this.status)) this.status = next
  }

  private adjustWorkerCount(status: WikiWorkerSummary['status'] | undefined, delta: 1 | -1): void {
    const counted = status ? countedWorkerStatus(status) : null
    if (counted === 'completed') this.completed += delta
    else if (counted === 'inProgress') this.inProgress += delta
    else if (counted === 'failed') this.failed += delta
  }
}

/** Reduces the durable event envelope only; wall-clock quiet/stalled health is a renderer concern. */
export function reduceWikiProgress(events: readonly WikiRunEvent[]): WikiProgressSummary | undefined {
  if (events.length === 0) return undefined
  const accumulator = new WikiProgressAccumulator()
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) accumulator.add(event)
  return accumulator.summary()
}
