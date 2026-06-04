/**
 * Feature-gate single source of truth.
 *
 * `KNOWN_FEATURE_GATES` is the canonical UNIVERSE of gate keys the harness recognizes. Everything that
 * declares a gate map — the shipped `harness/feature-gates.yml`, the compiled-in `DEFAULT_GATES_YAML`,
 * the desktop GATE_WIRING / SHIPPED_GATE_VALUES tables, and the run-state-machine PIPELINE — must agree
 * with this list. Drift guards in `feature-gate.config.test.ts` assert that agreement at test time, and
 * deriving `HarnessFeatureGateKey` / `PipelineStep.gate` from these types enforces it at compile time.
 *
 * `HONORED_GATES` is the subset the MVP runtime actually CONSULTS: each one gates a step in the pipeline
 * (see run-state-machine `PIPELINE`). The rest of the universe is either structurally enforced regardless
 * of flag (always-on safety) or forward-declared/inert — see the `harness/feature-gates.yml` header and
 * the desktop GATE_WIRING classification.
 */

/** Every feature-gate key the harness recognizes (the canonical universe). Order mirrors feature-gates.yml. */
export const KNOWN_FEATURE_GATES = [
  'auto_classify_documents',
  'auto_create_node_proposals',
  'auto_create_write_plan',
  'auto_write_to_staging',
  'auto_write_to_real_vault',
  'auto_shared_promotion',
  'auto_deprecate',
  'auto_delete',
  'auto_graph_update',
  'auto_update_current',
  'auto_update_adr',
  'enable_conversation_history_reader',
  'enable_claude_history_reader',
  'enable_codex_history_reader',
  'enable_opencode_history_reader',
  'enable_policy_guard',
  'enable_secret_scan',
  'enable_evidence_required',
  'enable_human_review_for_shared',
  'enable_human_review_for_canonical',
  'use_staging_vault',
  'require_git_diff_before_merge',
] as const

export type FeatureGateKey = typeof KNOWN_FEATURE_GATES[number]

/** The gates the MVP runtime actually consults — each one gates a run-state-machine PIPELINE step. */
export const HONORED_GATES = [
  'enable_conversation_history_reader',
  'auto_classify_documents',
  'auto_create_node_proposals',
  'auto_create_write_plan',
  'auto_write_to_staging',
] as const satisfies readonly FeatureGateKey[]

export type HonoredGate = typeof HONORED_GATES[number]
