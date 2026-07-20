import { z } from 'zod'

export const AgentKind = z.enum(['claude', 'codex', 'opencode'])
export type AgentKind = z.infer<typeof AgentKind>
/** Alias for AgentKind — used in llm-wiki and other packages. */
export type AgentType = AgentKind

export const ProjectType = z.enum(['git', 'obsidian', 'hybrid'])
export const ProjectStatus = z.enum(['active', 'maintenance', 'paused', 'archived'])
export const ProjectDomain = z.enum(['project-docs', 'paper'])

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: ProjectStatus,
  goal: z.string().optional(),
  currentFocus: z.string().optional(),
  startDate: z.string().optional(),
  targetDate: z.string().optional(),
  projectType: ProjectType,
  domain: ProjectDomain.default('project-docs'),
  repoPaths: z.array(z.string()).default([]),
  vaultPaths: z.array(z.string()).default([]),
  sourcePaths: z.array(z.string()).default([]),
})
export type Project = z.infer<typeof ProjectSchema>

export const TaskStatus = z.enum(['todo', 'in_progress', 'review', 'done', 'rejected'])
export const ReviewStatus = z.enum(['none', 'pending', 'approved', 'needs_changes', 'rejected'])
// Value + type merge: consumers import `type TaskStatus` / `type ReviewStatus` to type columns/params.
export type TaskStatus = z.infer<typeof TaskStatus>
export type ReviewStatus = z.infer<typeof ReviewStatus>

export const TaskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  status: TaskStatus,
  assigneeType: z.enum(['agent', 'human']).default('agent'),
  assignee: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().optional(),
  estimate: z.string().optional(),
  parentTaskId: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).default([]),
  linkedWikiPages: z.array(z.string()).default([]),
  blockedBy: z.array(z.string()).default([]),
  contextPackage: z.string().optional(),
  reviewStatus: ReviewStatus.default('none'),
})
export type Task = z.infer<typeof TaskSchema>

export const NextNoteSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string(),
  done: z.boolean().default(false),
})
export type NextNote = z.infer<typeof NextNoteSchema>

export const QuestionLogEntrySchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  ts: z.string(),
  agent: AgentKind,
  text: z.string(),
})
export type QuestionLogEntry = z.infer<typeof QuestionLogEntrySchema>

// The actor that performed a run: a single CLI engine (AgentKind) OR 'harness', the multi-agent dev
// orchestrator the console drives via the harness CLI contract (S3). Kept separate from AgentKind so
// engine-selection code (panes, ssh ENGINE_CMD, resume, terminals) stays restricted to real CLI engines.
export const RunAgent = z.enum(['claude', 'codex', 'opencode', 'harness'])
export type RunAgent = z.infer<typeof RunAgent>

export const AgentRunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agent: RunAgent,
  repoPath: z.string(),
  branch: z.string().optional(),
  worktreePath: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  transcriptPath: z.string().optional(),
  summaryPath: z.string().optional(),
})
export type AgentRun = z.infer<typeof AgentRunSchema>

export const ReviewSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agentRunId: z.string().min(1),
  reviewer: z.string().min(1),
  status: z.enum(['approved', 'needs_changes', 'rejected']),
  summary: z.string(),
  nextTasks: z.array(z.string()).default([]),
})
export type Review = z.infer<typeof ReviewSchema>

// Learning Gate: a server-prepared target owns the reviewed Git snapshot. The renderer never
// supplies the SHA that authorizes a receipt.
export const RetroSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.string().min(1),
  completedAt: z.string().optional(),
})
export type Retro = z.infer<typeof RetroSchema>

export const RetroTargetSchema = z.object({
  id: z.string().min(1),
  retroId: z.string().min(1),
  projectId: z.string().min(1),
  repoPath: z.string().min(1),
  branch: z.string().optional(),
  preparedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  preparedAt: z.string().min(1),
  verificationEvidence: z.string().min(1).optional(),
  riskNotes: z.string().min(1).optional(),
  receiptId: z.string().min(1).optional(),
})
export type RetroTarget = z.infer<typeof RetroTargetSchema>

export const RetroQuestionKind = z.enum(['template', 'dynamic', 'followup', 'closing'])
export const RetroQuestionSchema = z.object({
  id: z.string().min(1),
  retroId: z.string().min(1),
  targetId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  kind: RetroQuestionKind,
  critical: z.boolean().default(false),
  text: z.string().min(1),
  answer: z.string().min(1).optional(),
  skipped: z.boolean().default(false),
  answeredAt: z.string().optional(),
})
export type RetroQuestion = z.infer<typeof RetroQuestionSchema>

export const ReviewReceiptSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repoPath: z.string().min(1),
  branch: z.string().optional(),
  reviewedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  diffHash: z.string().optional(),
  retroId: z.string().min(1),
  targetId: z.string().min(1),
  answeredQuestionIds: z.array(z.string().min(1)).min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  answerSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: z.string().min(1),
})
export type ReviewReceipt = z.infer<typeof ReviewReceiptSchema>

export const GateEventSchema = z.object({
  id: z.string().min(1),
  repoPath: z.string().min(1),
  kind: z.enum(['skip']),
  reason: z.string().min(1),
  ts: z.string().min(1),
})
export type GateEvent = z.infer<typeof GateEventSchema>
