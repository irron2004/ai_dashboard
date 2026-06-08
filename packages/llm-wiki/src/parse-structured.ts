import type { ZodType } from 'zod'
import type { AgentType } from '@apc/shared'

/**
 * `claude -p --output-format json` wraps the model's answer in an envelope
 * (`{ type:'result', result:'<text>', ... }`) — the wiki JSON we want lives
 * INSIDE the `result` string. codex/opencode emit the model text directly.
 * Unwrap claude so downstream JSON extraction sees the model's actual output
 * and not the envelope (whose keys never match WikiGenerationSchema).
 */
export function unwrapAgentJson(raw: string, agent: AgentType): string {
  if (agent !== 'claude') return raw
  try {
    const env = JSON.parse(raw.trim()) as { result?: unknown }
    if (env && typeof env === 'object' && typeof env.result === 'string') return env.result
  } catch {
    // Not a JSON envelope (older/plain output) — fall through and parse as-is.
  }
  return raw
}

/** Find the first balanced {...} region in text (handles strings/escapes). */
function extractJsonRegion(text: string): string | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const haystack = fence ? fence[1] : text
  const start = haystack.indexOf('{')
  if (start === -1) return undefined
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < haystack.length; i++) {
    const ch = haystack[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return haystack.slice(start, i + 1) }
  }
  return undefined
}

// Generic over the schema (not its output): `ZodType<T>` infers T from the *input* position, so a schema
// with `.default()`s returns those fields as optional — breaking an output-typed caller (e.g. wiki-engine).
// `S['_output']` is exactly what `schema.parse()` produces (defaults applied, fields required).
export function parseStructured<S extends ZodType>(raw: string, schema: S): S['_output'] {
  const region = extractJsonRegion(raw)
  if (!region) throw new Error('Agent output contained no JSON object')
  let parsed: unknown
  try { parsed = JSON.parse(region) } catch (e) {
    throw new Error(`Agent JSON parse failed: ${(e as Error).message}`)
  }
  return schema.parse(parsed)
}
