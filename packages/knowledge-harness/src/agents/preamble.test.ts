import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadPreamble, DEFAULT_PREAMBLE } from './preamble.js'

// repo root = up from packages/knowledge-harness/src/agents/
const rulesPath = join(fileURLToPath(new URL('../../../../', import.meta.url)), 'harness', 'harness-rules.md')

describe('preamble', () => {
  test('loadPreamble() (no arg) returns the compiled-in default with the Immutable Sources rule', () => {
    const p = loadPreamble()
    expect(p).toBe(DEFAULT_PREAMBLE)
    expect(p).toContain('Immutable Sources')
    expect(p).toContain('raw/')
  })

  test('DEFAULT_PREAMBLE is byte-identical to harness/harness-rules.md (drift guard)', () => {
    expect(DEFAULT_PREAMBLE).toBe(readFileSync(rulesPath, 'utf8'))
  })

  test('loadPreamble(path) reads an explicit override file from disk', () => {
    expect(loadPreamble(rulesPath)).toBe(readFileSync(rulesPath, 'utf8'))
  })
})
