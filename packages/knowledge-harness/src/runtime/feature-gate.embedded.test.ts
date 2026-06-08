import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FeatureGate, DEFAULT_GATES_YAML } from './feature-gate.js'

// repo root = up from packages/knowledge-harness/src/runtime/
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

describe('embedded feature gates (fs-free boot path)', () => {
  test('DEFAULT_GATES_YAML is byte-identical to harness/feature-gates.yml (drift guard)', () => {
    // If this fails, the on-disk canonical file changed but the compiled-in copy did not (or vice versa).
    expect(DEFAULT_GATES_YAML).toBe(readFileSync(gatesPath, 'utf8'))
  })

  test('FeatureGate.default() resolves HONORED gates ON without touching the filesystem', () => {
    const g = FeatureGate.default()
    for (const k of ['auto_classify_documents', 'auto_create_node_proposals', 'auto_create_write_plan',
      'auto_write_to_staging', 'enable_conversation_history_reader', 'use_staging_vault',
      'enable_policy_guard', 'enable_secret_scan', 'enable_evidence_required']) {
      expect(g.gate(k)).toBe(true)
    }
  })

  test('FeatureGate.default() keeps dangerous automation OFF', () => {
    const g = FeatureGate.default()
    for (const k of ['auto_write_to_real_vault', 'auto_shared_promotion', 'auto_delete',
      'auto_graph_update', 'auto_update_current']) {
      expect(g.gate(k)).toBe(false)
    }
  })

  test('fromYaml(default) equals fromFile(shipped) — embedded and canonical agree', () => {
    const fromYaml = FeatureGate.fromYaml(DEFAULT_GATES_YAML)
    const fromFile = FeatureGate.fromFile(gatesPath)
    for (const k of ['auto_write_to_staging', 'auto_delete', 'enable_secret_scan']) {
      expect(fromYaml.gate(k)).toBe(fromFile.gate(k))
    }
  })
})
