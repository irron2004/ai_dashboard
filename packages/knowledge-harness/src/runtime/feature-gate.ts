import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// repo root = up from packages/knowledge-harness/src/runtime/
export const DEFAULT_GATES_PATH = join(fileURLToPath(new URL('../../../../', import.meta.url)), 'harness', 'feature-gates.yml')

/**
 * Parse the feature-gates file. This is NOT a general YAML parser — it understands exactly one
 * shape: a `features:` header followed by flat `  <name>: true|false` lines (comments with `#`
 * and blank lines allowed). Anything else (nesting, lists, non-boolean values, typo'd syntax)
 * is deliberately ignored rather than throwing: an unrecognized line simply leaves its flag
 * undefined, and `FeatureGate.gate()` treats undefined as `false`. The result is fail-safe by
 * construction — a malformed or misspelled line can only ever fail to ENABLE automation, never
 * silently enable it. Editing the file requires no rebuild (it is read at runtime).
 */
export function parseFeatureGates(text: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line === 'features:') continue
    const m = line.match(/^([A-Za-z0-9_]+):\s*(true|false)\s*$/)
    if (m) out[m[1]] = m[2] === 'true'
    // else: not a recognized `key: true|false` line — ignored (stays undefined → gate() = false).
  }
  return out
}

export class FeatureGate {
  constructor(private readonly flags: Record<string, boolean>) {}

  static fromFile(path: string): FeatureGate {
    return new FeatureGate(parseFeatureGates(readFileSync(path, 'utf8')))
  }

  /** Unknown flags default to false (fail safe — never auto-enable something undeclared). */
  gate(name: string): boolean {
    return this.flags[name] === true
  }
}
