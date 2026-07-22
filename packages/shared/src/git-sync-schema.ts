import { z } from 'zod'

export const GitFileChangeStatus = z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'untracked', 'conflict'])
export type GitFileChangeStatus = z.infer<typeof GitFileChangeStatus>

export const GitFileChangeSchema = z.object({
  path: z.string().min(1),
  status: GitFileChangeStatus,
  staged: z.boolean(),
  unstaged: z.boolean(),
  conflict: z.boolean().default(false),
  warning: z.string().optional(),
})
export type GitFileChange = z.infer<typeof GitFileChangeSchema>

export const GitSyncStatusSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  repoPath: z.string().optional(),
  root: z.string().optional(),
  branch: z.string().optional(),
  detached: z.boolean().default(false),
  upstream: z.string().optional(),
  ahead: z.number().int().nonnegative().default(0),
  behind: z.number().int().nonnegative().default(0),
  hasChanges: z.boolean().default(false),
  files: z.array(GitFileChangeSchema).default([]),
  warnings: z.array(z.string()).default([]),
})
export type GitSyncStatus = z.infer<typeof GitSyncStatusSchema>

export const GitSyncResultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  output: z.string().optional(),
  status: GitSyncStatusSchema.optional(),
  committedSha: z.string().optional(),
})
export type GitSyncResult = z.infer<typeof GitSyncResultSchema>
