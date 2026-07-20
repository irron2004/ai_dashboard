import { z } from 'zod'

const EventBaseSchema = z.object({
  version: z.literal(1),
  seq: z.number().int().positive(),
  eventId: z.string().min(1),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  at: z.string().min(1),
})

const RunEventSchema = z.object({
  kind: z.enum(['run_started', 'run_completed', 'run_failed']),
  message: z.string().optional(),
})

const PhaseEventSchema = z.object({
  kind: z.enum(['phase_started', 'phase_completed', 'phase_failed', 'phase_paused']),
  phase: z.string().min(1),
  message: z.string().optional(),
})

const WorkPlannedEventSchema = z.object({
  kind: z.literal('work_planned'),
  total: z.number().int().nonnegative(),
})

const WorkerEventSchema = z.object({
  kind: z.enum(['worker_started', 'worker_completed', 'worker_failed', 'worker_retrying']),
  workerId: z.string().min(1),
  folder: z.string().optional(),
  attempt: z.number().int().positive(),
  message: z.string().optional(),
})

const NodeEventSchema = z.object({
  kind: z.enum(['node_discovered', 'node_accepted', 'node_dropped']),
  workerId: z.string().min(1),
  proposalId: z.string().min(1),
  title: z.string().min(1),
  nodeType: z.string().min(1),
  sourceFolder: z.string().optional(),
})

const EngineEventSchema = z.object({
  kind: z.enum(['engine_request_started', 'engine_activity', 'engine_request_finished']),
  workerId: z.string().min(1).optional(),
})

const ReconnectingEventSchema = z.object({
  kind: z.literal('transport_reconnecting'),
  workerId: z.string().min(1).optional(),
  attempt: z.number().int().positive(),
  message: z.string().optional(),
})

const WikiRunEventPayloadSchema = z.discriminatedUnion('kind', [
  RunEventSchema,
  PhaseEventSchema,
  WorkPlannedEventSchema,
  WorkerEventSchema,
  NodeEventSchema,
  EngineEventSchema,
  ReconnectingEventSchema,
])

export const WikiRunEventSchema = EventBaseSchema.and(WikiRunEventPayloadSchema)
export type WikiRunEvent = z.infer<typeof WikiRunEventSchema>

export const WikiWorkerSummarySchema = z.object({
  workerId: z.string().min(1),
  folder: z.string().optional(),
  attempt: z.number().int().positive(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'retrying']),
  lastActivityAt: z.string().min(1),
  message: z.string().optional(),
}).strict()
export type WikiWorkerSummary = z.infer<typeof WikiWorkerSummarySchema>

export const WikiNodeProgressSchema = z.object({
  workerId: z.string().min(1),
  proposalId: z.string().min(1),
  title: z.string().min(1),
  nodeType: z.string().min(1),
  sourceFolder: z.string().optional(),
  status: z.enum(['discovered', 'accepted', 'dropped']),
  discoveredAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()
export type WikiNodeProgress = z.infer<typeof WikiNodeProgressSchema>

export const WikiProgressSummarySchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  status: z.enum(['generating', 'waiting', 'reconnecting', 'completed', 'failed']),
  health: z.enum(['active', 'quiet', 'stalled', 'interrupted']),
  phase: z.string().min(1).optional(),
  startedAt: z.string().min(1),
  lastActivityAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  work: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
  }).strict(),
  workers: z.array(WikiWorkerSummarySchema),
  nodes: z.array(WikiNodeProgressSchema),
}).strict()
export type WikiProgressSummary = z.infer<typeof WikiProgressSummarySchema>

