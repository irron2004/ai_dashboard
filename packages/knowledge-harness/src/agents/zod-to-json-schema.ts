import type { ZodTypeAny } from 'zod'

type JsonSchema = Record<string, unknown>

/**
 * Minimal, dependency-free Zod→JSON-Schema serializer for embedding a schema in an LLM prompt.
 *
 * Why this exists: the agent prompts asked the model to "return JSON matching the required schema"
 * but never SHOWED the schema, so the model invented field names (e.g. `projectId` instead of the
 * required `project_id`) and Zod validation rejected the output. Embedding the schema (with the
 * exact field names + which are required) makes the model conform.
 *
 * Covers the Zod constructs the knowledge-harness agent schemas use: object/string/number/boolean/
 * array/enum/literal/record/union + optional/default/nullable/effects wrappers. Anything unrecognised
 * degrades to `{}` (allow-anything) rather than throwing — a best-effort prompt aid must never break a run.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  // _def is Zod's internal shape; stable across the 3.x line we pin.
  const def = (schema as { _def?: Record<string, unknown> })._def
  if (!def) return {}
  switch (def.typeName as string) {
    case 'ZodObject': {
      const rawShape = def.shape
      const shape = (typeof rawShape === 'function' ? rawShape() : rawShape) as Record<string, ZodTypeAny>
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(child)
        if (!isOptionalField(child)) required.push(key)
      }
      const out: JsonSchema = { type: 'object', properties }
      if (required.length) out.required = required
      return out
    }
    case 'ZodString': return { type: 'string' }
    case 'ZodNumber': return { type: 'number' }
    case 'ZodBoolean': return { type: 'boolean' }
    case 'ZodArray': return { type: 'array', items: zodToJsonSchema(def.type as ZodTypeAny) }
    case 'ZodEnum': return { type: 'string', enum: [...(def.values as string[])] }
    case 'ZodLiteral': return { const: def.value }
    case 'ZodRecord': return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType as ZodTypeAny) }
    case 'ZodUnion': return { anyOf: (def.options as ZodTypeAny[]).map(zodToJsonSchema) }
    case 'ZodNullable':
    case 'ZodOptional':
      return zodToJsonSchema(def.innerType as ZodTypeAny)
    case 'ZodDefault': {
      const inner = zodToJsonSchema(def.innerType as ZodTypeAny)
      try { return { ...inner, default: (def.defaultValue as () => unknown)() } } catch { return inner }
    }
    case 'ZodEffects': return zodToJsonSchema(def.schema as ZodTypeAny)
    default: return {}
  }
}

/** A field is optional in the output if it is wrapped in `.optional()` or carries a `.default()`. */
function isOptionalField(schema: ZodTypeAny): boolean {
  const t = (schema as { _def?: { typeName?: string } })._def?.typeName
  return t === 'ZodOptional' || t === 'ZodDefault'
}
