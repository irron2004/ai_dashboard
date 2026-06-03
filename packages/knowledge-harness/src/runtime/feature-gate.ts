import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// repo root = up from packages/knowledge-harness/src/runtime/.
// NOTE: dev/tooling only — resolves the editable source file. NOT on the boot path: a bundled app would
// resolve this `../../../../` walk to the wrong dir (see DEFAULT_GATES_YAML below). Boot uses fromYaml().
export const DEFAULT_GATES_PATH = join(fileURLToPath(new URL('../../../../', import.meta.url)), 'harness', 'feature-gates.yml')

/**
 * Compiled-in copy of `harness/feature-gates.yml`. The harness boots from THIS constant, never from a
 * filesystem read — so a bundled Electron app (where `import.meta.url` path-walking lands in the wrong
 * directory) can never fail to start over a missing config file. The on-disk `harness/feature-gates.yml`
 * remains the canonical, human-editable source and an *optional* runtime override (FeatureGate.fromFile);
 * a drift test asserts this constant stays byte-identical to it.
 */
export const DEFAULT_GATES_YAML = `# Feature gates. NOTE on what the MVP runtime actually consults:
#  HONORED (drive the pipeline via run-state-machine PIPELINE step.gate):
#    enable_conversation_history_reader, auto_classify_documents, auto_create_node_proposals,
#    auto_create_write_plan, auto_write_to_staging.
#  STRUCTURALLY ENFORCED regardless of flag (always-on safety, fail-safe by design — NOT toggleable
#  in the MVP): PolicyGuard/SecretScanner/evidence-required run unconditionally; writers only touch
#  the staging vault; canonical docs are always routed to .proposal.md; promotion is human-triggered
#  and refuses secret-flagged content. The remaining flags below are FORWARD-DECLARED for P1 wiring
#  (per-flag toggling of those checks, real-vault auto-apply, shared promotion, deletes) and are
#  intentionally inert today — flipping them does NOT currently change behavior.
features:
  auto_classify_documents: true
  auto_create_node_proposals: true
  auto_create_write_plan: true
  auto_write_to_staging: true
  auto_write_to_real_vault: false
  auto_shared_promotion: false
  auto_deprecate: false
  auto_delete: false
  auto_graph_update: false
  auto_update_current: false
  auto_update_adr: false
  enable_conversation_history_reader: true
  enable_claude_history_reader: false
  enable_codex_history_reader: false
  enable_opencode_history_reader: false
  enable_policy_guard: true
  enable_secret_scan: true
  enable_evidence_required: true
  enable_human_review_for_shared: true
  enable_human_review_for_canonical: true
  use_staging_vault: true
  require_git_diff_before_merge: true
`

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

  /** Parse gates from YAML text. Use with DEFAULT_GATES_YAML for the fs-free boot path. */
  static fromYaml(text: string): FeatureGate {
    return new FeatureGate(parseFeatureGates(text))
  }

  /** The compiled-in default gates (no filesystem read — safe in a bundled app). */
  static default(): FeatureGate {
    return FeatureGate.fromYaml(DEFAULT_GATES_YAML)
  }

  /** Unknown flags default to false (fail safe — never auto-enable something undeclared). */
  gate(name: string): boolean {
    return this.flags[name] === true
  }
}
