import { describe, expect, test } from 'vitest'
import { PaperNodeSchema, PaperExtractorOutputSchema, loadPaperContractText } from './paper-node-extractor.js'

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
