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
  'them) — those workers could not see each other, so it is YOUR job to connect the graph.',
  'CONNECT THE NODES: graph_update_plan.edge_ops MUST contain a relationship for every meaningful link',
  'between nodes — this is what makes the result a graph rather than a list of isolated nodes. Each edge is',
  '{ from_node_id, to_node_id, type, note }, where type is one of relates_to | depends_on | supersedes |',
  'part_of | contradicts | derived_from | evidence_for. Prefer edges ACROSS folders (e.g. a concept in one',
  'folder that depends_on a shared protocol/dataset defined in another). from_node_id/to_node_id MUST be',
  'node_ids you create in node_ops or that already exist — never invent ids. Aim for a connected graph:',
  'most nodes should have at least one edge; avoid leaving nodes orphaned.',
  'In the WritePlan, ALSO weave Obsidian [[node-id]] wikilinks into each node body that point to the',
  'related nodes you linked with edge_ops, so the published markdown graph mirrors the edges.',
  'Produce a graph_update_plan, a shared_promotion_plan (shared requires >=2 evidence AND human review),',
  'a stale_doc_report, and a WritePlan. The WritePlan MUST target vault-staging only, MUST set',
  'mode=proposal_only for any op touching canonical docs (current.md/PRD.md/ADR-*), and MUST NOT contain',
  'delete operations.',
].join(' ')

export function makeWikiGraphLead(preamble: string) {
  return new LlmAgent({ name: 'wiki-graph-lead', role: ROLE, schema: WikiGraphLeadOutputSchema, preamble })
}
