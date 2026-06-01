import { z } from 'zod'

export const Permission = z.enum(['allow', 'ask', 'deny'])
export type Permission = z.infer<typeof Permission>

export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(['claude', 'codex', 'opencode']),
  name: z.string().min(1),
  scope: z.enum(['global', 'project', 'local', 'managed']),
  mode: z.enum(['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom']).default('custom'),
  description: z.string().optional(),
  model: z.string().optional(),
  prompt: z.object({ inline: z.string().optional(), filePath: z.string().optional() }).optional(),
  permissions: z.object({
    read: Permission.optional(), edit: Permission.optional(), bash: Permission.optional(),
    web: Permission.optional(), task: Permission.optional(),
  }).optional(),
  tools: z.array(z.string()).optional(),
  maxSteps: z.number().optional(),
  temperature: z.number().optional(),
  rawConfigPath: z.string().min(1),
  rawFormat: z.enum(['json', 'markdown', 'toml', 'unknown']),
})
export type AgentProfile = z.infer<typeof AgentProfileSchema>
