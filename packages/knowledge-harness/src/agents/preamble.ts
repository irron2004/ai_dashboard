import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// repo root = up from packages/knowledge-harness/src/agents/
const RULES_PATH = join(fileURLToPath(new URL('../../../../', import.meta.url)), 'harness', 'harness-rules.md')
let cached: string | undefined

/** The harness-rules.md preamble injected into every LLM agent prompt. */
export function loadPreamble(path: string = RULES_PATH): string {
  if (path === RULES_PATH && cached !== undefined) return cached
  const text = readFileSync(path, 'utf8')
  if (path === RULES_PATH) cached = text
  return text
}
