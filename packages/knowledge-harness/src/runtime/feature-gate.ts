import { readFileSync } from 'node:fs'

/** Parse the flat `key: true|false` feature-gates file (a YAML subset — no nesting beyond the `features:` header). */
export function parseFeatureGates(text: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line === 'features:') continue
    const m = line.match(/^([A-Za-z0-9_]+):\s*(true|false)\s*$/)
    if (m) out[m[1]] = m[2] === 'true'
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
