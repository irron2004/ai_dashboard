import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { resolvePaperContractDir } from '../domains/paper-pack.js'

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ENTITY_TYPES = ['papers', 'modules', 'pipelines', 'pipeline_trials'] as const

export const PaperNodeSchema = z.object({
  type: z.enum(ENTITY_TYPES),
  slug: z.string().regex(SLUG_RE),
  fields: z.record(z.unknown()),
  body: z.string().optional(),
})
export type PaperNode = z.infer<typeof PaperNodeSchema>

export const PaperExtractorOutputSchema = z.object({
  nodes: z.array(PaperNodeSchema).default([]),
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
