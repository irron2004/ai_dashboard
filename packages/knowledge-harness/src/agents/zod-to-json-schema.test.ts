import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  KhProjectDiscoveryReportSchema, KhConversationHistoryReportSchema, KhDocumentIntentReportSchema,
} from '@apc/shared'
import { zodToJsonSchema } from './zod-to-json-schema.js'

describe('zodToJsonSchema', () => {
  test('marks no-default fields as required and omits defaulted ones', () => {
    // KhProjectDiscoveryReportSchema: project_id + generated_by are required (no default);
    // summary/repos/canonical_docs/topics all have defaults → optional.
    const js = zodToJsonSchema(KhProjectDiscoveryReportSchema) as { type: string; required: string[]; properties: Record<string, { type: string }> }
    expect(js.type).toBe('object')
    expect(js.required).toContain('project_id')
    expect(js.required).toContain('generated_by')
    expect(js.required).not.toContain('summary')
    expect(js.required).not.toContain('repos')
    expect(js.properties.project_id.type).toBe('string')
    expect(js.properties.generated_by.type).toBe('string')
  })

  test('serializes nested arrays of objects', () => {
    const js = zodToJsonSchema(KhProjectDiscoveryReportSchema) as { properties: Record<string, { type: string; items?: { type: string; properties?: Record<string, { type: string }> } }> }
    expect(js.properties.repos.type).toBe('array')
    expect(js.properties.repos.items?.type).toBe('object')
    expect(js.properties.repos.items?.properties?.path.type).toBe('string')
  })

  test('handles enums, numbers, booleans, optionals', () => {
    const s = z.object({
      kind: z.enum(['a', 'b']),
      count: z.number(),
      flag: z.boolean(),
      note: z.string().optional(),
      tag: z.string().default('x'),
    })
    const js = zodToJsonSchema(s) as { required: string[]; properties: Record<string, { type?: string; enum?: string[]; default?: unknown }> }
    expect(js.properties.kind.enum).toEqual(['a', 'b'])
    expect(js.properties.count.type).toBe('number')
    expect(js.properties.flag.type).toBe('boolean')
    expect(js.properties.tag.default).toBe('x')
    expect(js.required).toEqual(['kind', 'count', 'flag']) // note (optional) + tag (default) excluded
  })

  test('does not throw on the other agent report schemas', () => {
    for (const schema of [KhConversationHistoryReportSchema, KhDocumentIntentReportSchema]) {
      expect(() => zodToJsonSchema(schema)).not.toThrow()
      expect((zodToJsonSchema(schema) as { type: string }).type).toBe('object')
    }
  })

  test('unknown/unsupported types degrade to {} instead of throwing', () => {
    expect(zodToJsonSchema(z.unknown())).toEqual({})
    expect(zodToJsonSchema(z.any())).toEqual({})
  })
})
