import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { KNOWN_FEATURE_GATES, HONORED_GATES } from '@apc/shared'
import { FeatureGate, DEFAULT_GATES_YAML, parseFeatureGates } from './feature-gate.js'
import { PIPELINE } from './run-state-machine.js'

// repo root = up from packages/knowledge-harness/src/runtime/
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

// #33: these assert the SHIPPED policy VALUES in feature-gates.yml — what the harness ships, not proof that
// every flag is enforced by code. Only the HONORED flags drive the pipeline; the STRUCTURAL safety checks
// are always-on regardless of flag; the rest are forward-declared/inert. See the desktop GATE_WIRING
// classification (harness-utils) and the feature-gates.yml header for which is which.
describe('shipped feature-gates.yml (MVP policy)', () => {
  const g = FeatureGate.fromFile(gatesPath)

  test('automation that creates proposals/staging is ON', () => {
    for (const k of ['auto_classify_documents', 'auto_create_node_proposals', 'auto_create_write_plan',
      'auto_write_to_staging', 'enable_conversation_history_reader', 'use_staging_vault']) {
      expect(g.gate(k)).toBe(true)
    }
  })

  test('dangerous automation is OFF', () => {
    for (const k of ['auto_write_to_real_vault', 'auto_shared_promotion', 'auto_deprecate',
      'auto_delete', 'auto_graph_update', 'auto_update_current', 'auto_update_adr']) {
      expect(g.gate(k)).toBe(false)
    }
  })

  test('safety/review gates are ON', () => {
    for (const k of ['enable_policy_guard', 'enable_secret_scan', 'enable_evidence_required',
      'enable_human_review_for_shared', 'enable_human_review_for_canonical', 'require_git_diff_before_merge']) {
      expect(g.gate(k)).toBe(true)
    }
  })
})

// Drift guards (#15/#16/#18): the gate UNIVERSE (KNOWN_FEATURE_GATES) and the HONORED set live in
// @apc/shared as the single source of truth. These tie that source to the shipped YAML, the compiled-in
// YAML, and the run-state-machine PIPELINE so none can diverge silently — add/rename/remove a gate in
// one place and exactly one of these fails, pointing at the place that fell out of sync.
describe('feature-gate single source of truth (drift guards)', () => {
  const sorted = (xs: Iterable<string>) => [...xs].sort()

  test('KNOWN_FEATURE_GATES matches the shipped feature-gates.yml key set (#15)', () => {
    const shipped = Object.keys(parseFeatureGates(readFileSync(gatesPath, 'utf8')))
    expect(sorted(shipped)).toEqual(sorted(KNOWN_FEATURE_GATES))
  })

  test('KNOWN_FEATURE_GATES matches the compiled-in DEFAULT_GATES_YAML key set (#16)', () => {
    const embedded = Object.keys(parseFeatureGates(DEFAULT_GATES_YAML))
    expect(sorted(embedded)).toEqual(sorted(KNOWN_FEATURE_GATES))
  })

  test('HONORED_GATES are exactly the gates the PIPELINE consults (#18)', () => {
    const piped = PIPELINE.flatMap(s => (s.gate ? [s.gate] : []))
    expect(sorted(piped)).toEqual(sorted(HONORED_GATES))
  })

  test('every HONORED gate is a member of the KNOWN gate universe', () => {
    for (const g of HONORED_GATES) expect(KNOWN_FEATURE_GATES).toContain(g)
  })

  test('every HONORED gate ships ON in feature-gates.yml (honored gates drive the pipeline)', () => {
    const shipped = FeatureGate.fromFile(gatesPath)
    for (const k of HONORED_GATES) expect(shipped.gate(k)).toBe(true)
  })
})
