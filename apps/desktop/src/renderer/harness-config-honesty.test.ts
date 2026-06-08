import { describe, expect, test } from 'vitest'
import {
  HARNESS_FEATURE_GATES, GATE_WIRING, GATE_WIRING_LABEL, SHIPPED_GATE_VALUES,
  createDefaultHarnessConfig,
} from './harness-utils.js'

// Step 4 (C1/C2): the config UI must reflect the shipped policy honestly. These guard the metadata the
// honest read-only panel renders from.
describe('harness config honesty metadata', () => {
  test('every feature gate has a wiring class and a shipped value', () => {
    for (const gate of HARNESS_FEATURE_GATES) {
      expect(GATE_WIRING[gate.key], `wiring for ${gate.key}`).toBeDefined()
      expect(typeof SHIPPED_GATE_VALUES[gate.key], `shipped value for ${gate.key}`).toBe('boolean')
      expect(GATE_WIRING_LABEL[GATE_WIRING[gate.key]]).toBeTruthy()
    }
  })

  test('SHIPPED_GATE_VALUES matches the default config (single source of shipped policy)', () => {
    expect(SHIPPED_GATE_VALUES).toEqual(createDefaultHarnessConfig().featureGates)
  })

  test('the always-on safety gates are classified structural (never "toggleable")', () => {
    for (const k of ['enable_policy_guard', 'enable_secret_scan', 'enable_evidence_required',
      'use_staging_vault', 'enable_human_review_for_canonical'] as const) {
      expect(GATE_WIRING[k]).toBe('structural')
      expect(SHIPPED_GATE_VALUES[k]).toBe(true)
    }
  })

  test('dangerous auto-apply flags are forward-declared and ship OFF', () => {
    for (const k of ['auto_write_to_real_vault', 'auto_delete', 'auto_shared_promotion'] as const) {
      expect(GATE_WIRING[k]).toBe('forward-declared')
      expect(SHIPPED_GATE_VALUES[k]).toBe(false)
    }
  })
})
