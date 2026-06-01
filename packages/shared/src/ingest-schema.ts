import { z } from 'zod'
import { AgentKind } from './schema.js'

export const NormalizedToolCallSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  input: z.unknown().optional(),
  resultText: z.string().optional(),
  isError: z.boolean().optional(),
})
export type NormalizedToolCall = z.infer<typeof NormalizedToolCallSchema>

export const NormalizedTurnSchema = z.object({
  uuid: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  text: z.string().default(''),
  timestamp: z.string().optional(),
  toolCalls: z.array(NormalizedToolCallSchema).default([]),
})
export type NormalizedTurn = z.infer<typeof NormalizedTurnSchema>

export const NormalizedSessionSchema = z.object({
  id: z.string().min(1),
  agentType: AgentKind,
  projectId: z.string().optional(),
  repoPath: z.string().optional(),
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  transcriptPath: z.string().optional(),
  turns: z.array(NormalizedTurnSchema).default([]),
  filesTouched: z.array(z.string()).default([]),
})
export type NormalizedSession = z.infer<typeof NormalizedSessionSchema>

export const AgentSourceSchema = z.object({
  id: z.string().min(1),
  agentKind: AgentKind,
  kind: z.enum(['jsonl-file', 'sqlite-session']),
  locator: z.string(),            // abs file path, or "db#sessionId"
  repoPath: z.string().optional(),
  mtimeMs: z.number().optional(),
  sizeBytes: z.number().optional(),
})
export type AgentSource = z.infer<typeof AgentSourceSchema>

export const SourceCursorSchema = z.object({
  sourceId: z.string().min(1),
  position: z.string(),           // opaque JSON: {sizeBytes,mtimeMs} or {timeUpdated}
  updatedAt: z.string(),
})
export type SourceCursor = z.infer<typeof SourceCursorSchema>
