import { z } from 'zod'

export const NextTaskCandidateSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().default(''),
})
export type NextTaskCandidate = z.infer<typeof NextTaskCandidateSchema>

/** The JSON we ask the agent CLI to emit. */
export const WikiGenerationSchema = z.object({
  workSummary: z.string().min(1),
  filesTouched: z.array(z.string()).default([]),
  openProblems: z.array(z.string()).default([]),
  nextTasks: z.array(NextTaskCandidateSchema).default([]),
  currentProposalMarkdown: z.string().default(''),
})
export type WikiGeneration = z.infer<typeof WikiGenerationSchema>

export const CurrentProposalSchema = z.object({
  projectId: z.string().min(1),
  proposedMarkdown: z.string(),
  basedOnSessionIds: z.array(z.string()).default([]),
})
export type CurrentProposal = z.infer<typeof CurrentProposalSchema>
