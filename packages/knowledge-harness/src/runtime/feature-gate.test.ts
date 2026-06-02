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
})
