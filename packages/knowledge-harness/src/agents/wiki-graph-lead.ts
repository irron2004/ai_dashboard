import { z } from 'zod'
import {
  KhGraphUpdatePlanSchema, KhSharedPromotionPlanSchema, KhStaleDocReportSchema, KhWritePlanSchema,
} from '@apc/shared'
import { LlmAgent } from './llm-agent.js'

export const WikiGraphLeadOutputSchema = z.object({
  graph_update_plan: KhGraphUpdatePlanSchema,
  shared_promotion_plan: KhSharedPromotionPlanSchema,
  stale_doc_report: KhStaleDocReportSchema,
  write_plan: KhWritePlanSchema,
})
export type WikiGraphLeadOutput = z.infer<typeof WikiGraphLeadOutputSchema>

const ROLE = [
  'You are the WikiGraphLead agent. Merge the NodeProposals into the existing graph.',
  'Dedupe against existing nodes; never create duplicates. The proposals are produced PER FOLDER by',
  'independent workers (the input `provenance` maps each proposal to its folder, and `folders` lists',
  'them) — those workers could not see each other, so it is YOUR job to create edges/links ACROSS',
  'folders wherever nodes relate (e.g. a concept in one folder that references a shared protocol or',
  'dataset defined in another). Produce a graph_update_plan,',
  'a shared_promotion_plan (shared requires >=2 evidence AND human review), a stale_doc_report,',
  'and a WritePlan. The WritePlan MUST target vault-staging only, MUST set mode=proposal_only for any',
  'op touching canonical docs (current.md/PRD.md/ADR-*), and MUST NOT contain delete operations.',
].join(' ')

export function makeWikiGraphLead(preamble: string) {
  return new LlmAgent({ name: 'wiki-graph-lead', role: ROLE, schema: WikiGraphLeadOutputSchema, preamble })
}
