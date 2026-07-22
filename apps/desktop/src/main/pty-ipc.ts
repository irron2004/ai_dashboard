import { z } from 'zod'
import { AgentKind, AgentPaneIdentitySchema } from '@apc/shared'
import type { StartPtyReq, PtyInputReq, PtyKillReq, PtyResizeReq } from '../shared/ipc-contract.js'
import { validatePtyInput, validatePtyResize } from './pty-manager.js'

const ID_MAX_CHARS = 2_048
const PATH_MAX_CHARS = 8_192
const COMMAND_MAX_CHARS = 256
const ARG_MAX_CHARS = 8_192
const ARGS_MAX_ITEMS = 128
const QUESTION_MAX_CHARS = 4_096
const QUESTION_MAX_ITEMS = 8

type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

const boundedId = z.string().min(1).max(ID_MAX_CHARS)
const paneIdentity = AgentPaneIdentitySchema.superRefine((pane, context) => {
  const tooLong = (path: string, maximum: number) => context.addIssue({
    code: z.ZodIssueCode.custom, message: `must contain at most ${maximum} characters`, path: [path],
  })
  if (pane.paneId.length > ID_MAX_CHARS) tooLong('paneId', ID_MAX_CHARS)
  if (pane.projectId.length > ID_MAX_CHARS) tooLong('projectId', ID_MAX_CHARS)
  if (pane.worktreePath.length > PATH_MAX_CHARS) tooLong('worktreePath', PATH_MAX_CHARS)
  if (pane.slotId.length > ID_MAX_CHARS) tooLong('slotId', ID_MAX_CHARS)
  if (pane.sessionId && pane.sessionId.length > PATH_MAX_CHARS) tooLong('sessionId', PATH_MAX_CHARS)
})

const startBase = z.object({
  id: boundedId,
  command: z.string().max(COMMAND_MAX_CHARS),
  args: z.array(z.string().max(ARG_MAX_CHARS)).max(ARGS_MAX_ITEMS),
  cwd: z.string().min(1).max(PATH_MAX_CHARS),
  resume: z.boolean().optional(),
  agent: AgentKind.optional(),
  sessionId: z.string().min(1).max(PATH_MAX_CHARS).optional(),
})

const scopedStart = startBase.extend({
  pane: paneIdentity,
  launchId: boundedId,
}).strict().superRefine((req, context) => {
  if (req.id !== req.pane.paneId) context.addIssue({ code: 'custom', message: 'pane-id-mismatch', path: ['id'] })
  if (req.cwd !== req.pane.worktreePath) context.addIssue({ code: 'custom', message: 'worktree-mismatch', path: ['cwd'] })
  if (req.command !== req.pane.agent) context.addIssue({ code: 'custom', message: 'command-mismatch', path: ['command'] })
  if (req.agent !== undefined && req.agent !== req.pane.agent) context.addIssue({ code: 'custom', message: 'agent-mismatch', path: ['agent'] })
  if (req.sessionId && req.pane.sessionId && req.sessionId !== req.pane.sessionId) {
    context.addIssue({ code: 'custom', message: 'session-mismatch', path: ['sessionId'] })
  }
})

const legacyStart = startBase.extend({
  pane: z.undefined().optional(),
  launchId: z.undefined().optional(),
}).strict()

const startSchema = z.union([scopedStart, legacyStart])
const inputSchema = z.object({
  id: boundedId,
  data: z.string(),
  launchId: boundedId.optional(),
  questionCandidates: z.array(z.string().min(1).max(QUESTION_MAX_CHARS)).max(QUESTION_MAX_ITEMS).optional(),
}).strict()
const killSchema = z.object({
  id: boundedId,
  launchId: boundedId.optional(),
  reason: z.enum(['user', 'restart', 'unmount', 'quit']).optional(),
}).strict()
const resizeSchema = z.object({
  id: boundedId,
  cols: z.number().int(),
  rows: z.number().int(),
  launchId: boundedId.optional(),
}).strict()

export function parsePtyStart(payload: unknown): ParseResult<StartPtyReq> {
  const result = startSchema.safeParse(payload)
  return result.success
    ? { ok: true, value: result.data as StartPtyReq }
    : { ok: false, reason: 'invalid-start' }
}

export function parsePtyInput(payload: unknown): ParseResult<PtyInputReq> {
  const result = inputSchema.safeParse(payload)
  if (!result.success) return { ok: false, reason: 'invalid-input' }
  const guarded = validatePtyInput(result.data.data)
  return guarded.ok ? { ok: true, value: result.data } : guarded
}

export function parsePtyKill(payload: unknown): ParseResult<PtyKillReq> {
  const result = killSchema.safeParse(payload)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, reason: 'invalid-kill' }
}

export function parsePtyResize(payload: unknown): ParseResult<PtyResizeReq> {
  const result = resizeSchema.safeParse(payload)
  if (!result.success) return { ok: false, reason: 'invalid-resize' }
  const guarded = validatePtyResize(result.data.cols, result.data.rows)
  return guarded.ok ? { ok: true, value: result.data } : guarded
}

export async function authorizePtyStart(
  req: StartPtyReq,
  resolveWorktree: (projectId: string, worktreePath: string) => Promise<
    { ok: true; repoPath: string } | { ok: false; reason: string }
  >,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!req.pane) return { ok: true }
  const resolved = await resolveWorktree(req.pane.projectId, req.pane.worktreePath)
  return resolved.ok && resolved.repoPath === req.cwd
    ? { ok: true }
    : { ok: false, reason: 'unregistered-worktree' }
}
