import { z } from 'zod'
import { AgentKind } from './schema.js'

export const AgentConnection = z.enum(['starting', 'connected', 'disconnected', 'error'])
export type AgentConnection = z.infer<typeof AgentConnection>

export const AgentPhase = z.enum(['idle', 'working', 'awaiting_user'])
export type AgentPhase = z.infer<typeof AgentPhase>

export const AgentPaneIdentitySchema = z.object({
  paneId: z.string().min(1),
  projectId: z.string().min(1),
  worktreePath: z.string().min(1),
  slotId: z.string().min(1),
  agent: AgentKind,
  sessionId: z.string().min(1).optional(),
}).strict()
export type AgentPaneIdentity = z.infer<typeof AgentPaneIdentitySchema>

export const AgentQuestionPrivacy = z.enum(['visible', 'masked', 'hidden'])
export type AgentQuestionPrivacy = z.infer<typeof AgentQuestionPrivacy>

export const AgentQuestionSource = z.enum(['pty', 'transcript'])
export type AgentQuestionSource = z.infer<typeof AgentQuestionSource>

export const AgentQuestionSummarySchema = z.object({
  displayText: z.string().min(1),
  askedAt: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  exchangeId: z.string().min(1).optional(),
  privacy: AgentQuestionPrivacy,
  source: AgentQuestionSource,
}).strict()
export type AgentQuestionSummary = z.infer<typeof AgentQuestionSummarySchema>

export const AgentActivitySchema = z.object({
  pane: AgentPaneIdentitySchema,
  launchId: z.string().min(1),
  connection: AgentConnection,
  phase: AgentPhase,
  processAlive: z.boolean(),
  lastActivityAt: z.string().min(1),
  lastInputAt: z.string().min(1).optional(),
  lastOutputAt: z.string().min(1).optional(),
  staleSince: z.string().min(1).optional(),
  currentLabel: z.string().min(1).optional(),
  lastQuestion: AgentQuestionSummarySchema.optional(),
  exitCode: z.number().int().optional(),
  reason: z.string().min(1).optional(),
  revision: z.number().int().nonnegative(),
}).strict()
export type AgentActivity = z.infer<typeof AgentActivitySchema>

export const AgentActivityStatus = z.enum(['working', 'awaiting_user', 'idle', 'error', 'disconnected'])
export type AgentActivityStatus = z.infer<typeof AgentActivityStatus>

/**
 * Human-facing status. Connection failures outrank the work phase, while processAlive remains a
 * separate fact for the UI to show alongside this value.
 */
export function deriveAgentActivityStatus(
  activity: Pick<AgentActivity, 'connection' | 'phase'>,
): AgentActivityStatus {
  if (activity.connection === 'error') return 'error'
  if (activity.connection === 'disconnected') return 'disconnected'
  if (activity.phase === 'awaiting_user') return 'awaiting_user'
  if (activity.phase === 'working') return 'working'
  return 'idle'
}

