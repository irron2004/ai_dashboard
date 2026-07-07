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
