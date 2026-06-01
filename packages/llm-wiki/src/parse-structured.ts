import type { ZodType } from 'zod'

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

export function parseStructured<T>(raw: string, schema: ZodType<T>): T {
  const region = extractJsonRegion(raw)
  if (!region) throw new Error('Agent output contained no JSON object')
  let parsed: unknown
  try { parsed = JSON.parse(region) } catch (e) {
    throw new Error(`Agent JSON parse failed: ${(e as Error).message}`)
  }
  return schema.parse(parsed)
}
