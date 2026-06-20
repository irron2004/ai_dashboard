import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { resolvePaperContractDir } from '../domains/paper-pack.js'
import { LlmAgent } from './llm-agent.js'

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ENTITY_TYPES = ['papers', 'modules', 'pipelines', 'pipeline_trials'] as const
const EDGE_TYPES = ['uses_module', 'pipeline_from_paper', 'alternative_to'] as const

export const PaperNodeSchema = z.object({
  type: z.enum(ENTITY_TYPES),
  slug: z.string().regex(SLUG_RE),
  fields: z.record(z.unknown()),
  body: z.string().optional(),
})
export type PaperNode = z.infer<typeof PaperNodeSchema>

/** A typed edge in the autosci edges.jsonl shape: `from`/`to` are qualified node refs `<type>:<slug>`,
 *  `type` is the edge vocabulary, and any contract attributes (e.g. `confidence`) ride inline
 *  (passthrough). The kernel-lint gate is the authority on endpoint/attribute validity. */
export const PaperEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(EDGE_TYPES),
}).passthrough()
export type PaperEdge = z.infer<typeof PaperEdgeSchema>

export const PaperExtractorOutputSchema = z.object({
  nodes: z.array(PaperNodeSchema).default([]),
  edges: z.array(PaperEdgeSchema).default([]),
})
export type PaperExtractorOutput = z.infer<typeof PaperExtractorOutputSchema>

/** Read the paper contract YAML (entities/edges/conventions) as a labeled text block for the prompt,
 *  so the model knows each entity's fields, the edge vocabulary, and the slug rule. */
export function loadPaperContractText(contractDir: string = resolvePaperContractDir()): string {
  if (!existsSync(contractDir)) {
    throw new Error(
      `paper contract not found at ${contractDir} — set APC_PAPER_CONTRACT_DIR or bundle wiki-domains/paper/runtime`,
    )
  }
  const part = (rel: string) => `### ${rel}\n${readFileSync(join(contractDir, rel), 'utf8').trim()}`
  return [
    part('schema/entities.yaml'),
    part('schema/edges.yaml'),
    part('schema/conventions.yaml'),
  ].join('\n\n')
}

const ROLE_HEAD = [
  'You are the paper-node-extractor agent. From the provided sources, extract typed wiki nodes for a',
  'research-paper knowledge graph. Emit ONLY nodes that the sources evidence — never invent papers,',
  'modules, pipelines, or trial results. Each node has: `type` (one of papers|modules|pipelines|',
  'pipeline_trials), a `slug` matching the slug rule, and `fields` = the frontmatter for that entity',
  "type per the contract below (include every required field). Put any prose description in `body`.",
  'Also emit `edges` connecting the nodes, each as { "from": "<type>:<slug>", "to": "<type>:<slug>",',
  '"type": <edge type> } with any required edge attribute inline (e.g. "confidence": "high" for',
  'pipeline_from_paper). Only use the edge types and endpoints the contract defines.',
  'Produce { "nodes": [...], "edges": [...] }. The contract (entities, edges, conventions) is authoritative:',
].join(' ')

export function makePaperNodeExtractor(preamble: string, contractDir?: string): LlmAgent<PaperExtractorOutput> {
  const role = `${ROLE_HEAD}\n\n${loadPaperContractText(contractDir)}`
  return new LlmAgent({ name: 'paper-node-extractor', role, schema: PaperExtractorOutputSchema, preamble })
}
