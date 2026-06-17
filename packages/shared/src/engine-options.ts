export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Per-run engine tuning, set per harness in the UI and mapped to each CLI's flags by buildEngineArgs
 * (@apc/llm-wiki). Every field is optional: an unset field adds NO flag, so the engine keeps its own
 * default. Fields that don't apply to an engine are ignored for it (e.g. claude has no reasoning-effort
 * flag). Pure type — lives in @apc/shared so the renderer + IPC contract can reference it without
 * pulling in the node-only runner code.
 */
export type EngineOptions = {
  /** Model id, e.g. 'claude-opus-4-8' (claude) or 'gpt-5.5' (codex). */
  model?: string
  /** Reasoning effort — codex/opencode concept; claude exposes no CLI flag for it (ignored there). */
  reasoningEffort?: ReasoningEffort
  /** codex sandbox mode. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** codex approval policy (headless `exec` typically uses 'never'). */
  approval?: 'untrusted' | 'on-failure' | 'on-request' | 'never'
  /** claude permission mode. */
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  /** Raw extra CLI args appended verbatim — escape hatch for flags not modeled above. */
  extraArgs?: string[]
}
