import { describe, expect, test } from 'vitest'
import { parseFeatureGates, FeatureGate } from './feature-gate.js'

const SAMPLE = `# comment
features:
  auto_classify_documents: true
  auto_write_to_real_vault: false
  enable_conversation_history_reader: true

  auto_delete: false
`

describe('feature-gate', () => {
  test('parses the flat key:bool map, ignoring comments/blank/header', () => {
    expect(parseFeatureGates(SAMPLE)).toEqual({
      auto_classify_documents: true,
      auto_write_to_real_vault: false,
      enable_conversation_history_reader: true,
      auto_delete: false,
    })
  })

  test('gate() returns the flag; unknown flags fail safe to false', () => {
    const g = new FeatureGate(parseFeatureGates(SAMPLE))
    expect(g.gate('auto_classify_documents')).toBe(true)
    expect(g.gate('auto_write_to_real_vault')).toBe(false)
    expect(g.gate('does_not_exist')).toBe(false)
  })

  test('malformed / non-boolean / typo lines fail safe (flag never accidentally enabled)', () => {
    const malformed = `features:
  auto_write_to_real_vault: maybe
  auto_delete:
  auto_deprcate: true
  auto_graph_update = true
`
    const flags = parseFeatureGates(malformed)
    const g = new FeatureGate(flags)
    // non-boolean value, empty value, and `=` syntax are not parsed at all
    expect('auto_write_to_real_vault' in flags).toBe(false)
    expect(g.gate('auto_write_to_real_vault')).toBe(false)
    expect(g.gate('auto_graph_update')).toBe(false)
    // a typo'd flag name parses, but the REAL gate it was meant to set stays false
    expect(g.gate('auto_deprecate')).toBe(false)
  })
})
