import { describe, expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FeatureGate } from './feature-gate.js'

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
