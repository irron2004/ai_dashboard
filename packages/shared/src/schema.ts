import { z } from 'zod'

export const AgentKind = z.enum(['claude', 'codex', 'opencode'])
export type AgentKind = z.infer<typeof AgentKind>

export const ProjectType = z.enum(['git', 'obsidian', 'hybrid'])
export const ProjectStatus = z.enum(['active', 'maintenance', 'paused', 'archived'])

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: ProjectStatus,
  goal: z.string().optional(),
  currentFocus: z.string().optional(),
  startDate: z.string().optional(),
  targetDate: z.string().optional(),
  projectType: ProjectType,
  repoPaths: z.array(z.string()).default([]),
  vaultPaths: z.array(z.string()).default([]),
  sourcePaths: z.array(z.string()).default([]),
})
export type Project = z.infer<typeof ProjectSchema>

export const TaskStatus = z.enum(['todo', 'in_progress', 'review', 'done', 'rejected'])
export const ReviewStatus = z.enum(['none', 'pending', 'approved', 'needs_changes', 'rejected'])

export const TaskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  status: TaskStatus,
  assigneeType: z.enum(['agent', 'human']).default('agent'),
  assignee: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().optional(),
  contextPackage: z.string().optional(),
  reviewStatus: ReviewStatus.default('none'),
})
export type Task = z.infer<typeof TaskSchema>

export const AgentRunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agent: AgentKind,
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
