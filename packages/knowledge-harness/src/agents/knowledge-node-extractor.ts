import { z } from 'zod'
import { KhNodeProposalSchema } from '@apc/shared'
import { LlmAgent } from './llm-agent.js'

export const KnowledgeNodeExtractorOutputSchema = z.object({
  proposals: z.array(KhNodeProposalSchema).default([]),
})
export type KnowledgeNodeExtractorOutput = z.infer<typeof KnowledgeNodeExtractorOutputSchema>

const ROLE = [
  'You are the KnowledgeNodeExtractor agent. From the conversation/document reports, extract',
  'NodeProposals (ConceptNode | DecisionNode | ExperimentNode).',
  'EVERY claim MUST reference at least one evidence entry, and every evidence entry MUST carry a',
  'source_path and source_id. NEVER invent evidence. If a claim is an inference, set inference=true',
  'and fill inference_note. Produce { "proposals": [...] }.',
].join(' ')

export function makeKnowledgeNodeExtractor(preamble: string) {
  return new LlmAgent({ name: 'knowledge-node-extractor', role: ROLE, schema: KnowledgeNodeExtractorOutputSchema, preamble })
}
