import { describe, expect, test } from 'vitest'
import { PaperNodeSchema, PaperEdgeSchema, PaperExtractorOutputSchema, loadPaperContractText } from './paper-node-extractor.js'

describe('PaperNodeSchema', () => {
  test('parses a typed node with free-form fields', () => {
    const n = PaperNodeSchema.parse({ type: 'modules', slug: 'attention-embedding', fields: { title: 'X', kind: 'encoder' } })
    expect(n.type).toBe('modules')
    expect(n.fields.kind).toBe('encoder')
  })
  test('rejects an unknown entity type', () => {
    expect(() => PaperNodeSchema.parse({ type: 'widgets', slug: 'x', fields: {} })).toThrow()
  })
  test('rejects a slug that violates the convention', () => {
    expect(() => PaperNodeSchema.parse({ type: 'papers', slug: 'Not A Slug', fields: {} })).toThrow()
  })
  test('output schema defaults nodes to []', () => {
    expect(PaperExtractorOutputSchema.parse({}).nodes).toEqual([])
  })
})

describe('PaperEdgeSchema', () => {
  test('parses an edge and keeps inline attributes (passthrough)', () => {
    const e = PaperEdgeSchema.parse({ from: 'pipelines:p', to: 'papers:x', type: 'pipeline_from_paper', confidence: 'high' })
    expect(e.type).toBe('pipeline_from_paper')
    expect((e as { confidence?: string }).confidence).toBe('high')
  })
  test('rejects an unknown edge type', () => {
    expect(() => PaperEdgeSchema.parse({ from: 'a', to: 'b', type: 'nope' })).toThrow()
  })
  test('output schema defaults edges to []', () => {
    expect(PaperExtractorOutputSchema.parse({ nodes: [] }).edges).toEqual([])
  })
})

describe('loadPaperContractText', () => {
  test('includes the entity types, edge types, and slug rule', () => {
    const text = loadPaperContractText()
    for (const t of ['papers', 'modules', 'pipelines', 'pipeline_trials']) expect(text).toContain(t)
    for (const e of ['uses_module', 'pipeline_from_paper', 'alternative_to']) expect(text).toContain(e)
    expect(text).toContain('slug_rule')
  })
  test('throws an actionable error when the contract dir is missing', () => {
    expect(() => loadPaperContractText('/definitely/not/here')).toThrow(/paper contract/i)
  })
})

import type { AgentRunner, RunInput, RunResult } from '@apc/llm-wiki'
import { makePaperNodeExtractor } from './paper-node-extractor.js'

describe('makePaperNodeExtractor', () => {
  const fakeRunner = (output: string): AgentRunner & { last?: RunInput } => {
    const r: AgentRunner & { last?: RunInput } = {
      run: async (input: RunInput): Promise<RunResult> => { r.last = input; return { ok: true, output, raw: output } },
    }
    return r
  }

  test('embeds the paper contract vocabulary in the prompt', async () => {
    const runner = fakeRunner('{"nodes":[]}')
    const agent = makePaperNodeExtractor('PREAMBLE')
    await agent.run({ runner, engine: 'claude', input: { sources: [] } })
    const prompt = runner.last!.prompt
    expect(prompt).toContain('paper-node-extractor')
    expect(prompt).toContain('modules')          // entity type from the contract
    expect(prompt).toContain('uses_module')      // edge type from the contract
  })

  test('parses the model output into typed nodes', async () => {
    const out = JSON.stringify({ nodes: [
      { type: 'papers', slug: 'attnembed-2402-05370', fields: { title: 'Attn', slug: 'attnembed-2402-05370', year: 2024 } },
    ] })
    const agent = makePaperNodeExtractor('PREAMBLE')
    const result = await agent.run({ runner: fakeRunner(out), engine: 'claude', input: { sources: [] } })
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('papers')
    expect(result.nodes[0].slug).toBe('attnembed-2402-05370')
    expect(result.nodes[0].fields.year).toBe(2024)
  })

  test('parses typed edges from the model output', async () => {
    const out = JSON.stringify({ nodes: [], edges: [
      { from: 'pipelines:attnembed-forecasting', to: 'modules:attention-embedding', type: 'uses_module' },
      { from: 'pipelines:attnembed-forecasting', to: 'papers:attnembed-2402-05370', type: 'pipeline_from_paper', confidence: 'high' },
    ] })
    const agent = makePaperNodeExtractor('PREAMBLE')
    const result = await agent.run({ runner: fakeRunner(out), engine: 'claude', input: { sources: [] } })
    expect(result.edges).toHaveLength(2)
    expect(result.edges[0].type).toBe('uses_module')
    expect((result.edges[1] as { confidence?: string }).confidence).toBe('high')
  })
})
