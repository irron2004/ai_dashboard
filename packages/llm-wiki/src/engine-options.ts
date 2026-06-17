import type { AgentType, EngineOptions } from '@apc/shared'

export type { EngineOptions } from '@apc/shared'

/**
 * Translate EngineOptions into the CLI flags to append to an engine's base command, per engine. Only
 * emits flags for fields that apply to that engine; unknown fields fall through to extraArgs.
 *
 * NOTE: the codex flag names (`--model`, `-c model_reasoning_effort=…`, `--sandbox`,
 * `--ask-for-approval`) and claude's (`--model`, `--permission-mode`) reflect those CLIs' documented
 * options; verify against the installed CLI version, and use `extraArgs` for anything bespoke.
 */
export function buildEngineArgs(engine: AgentType, opts?: EngineOptions): string[] {
  if (!opts) return []
  const args: string[] = []
  if (engine === 'claude') {
    if (opts.model) args.push('--model', opts.model)
    if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode)
  } else if (engine === 'codex') {
    if (opts.model) args.push('--model', opts.model)
    // codex sets reasoning effort via a TOML config override; the value is a quoted string.
    if (opts.reasoningEffort) args.push('-c', `model_reasoning_effort="${opts.reasoningEffort}"`)
    if (opts.sandbox) args.push('--sandbox', opts.sandbox)
    if (opts.approval) args.push('--ask-for-approval', opts.approval)
  } else if (engine === 'opencode') {
    if (opts.model) args.push('--model', opts.model)
  }
  if (opts.extraArgs?.length) args.push(...opts.extraArgs)
  return args
}

/** Single-quote an arg for safe embedding in a remote `bash -lic '...'` command string. */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** The engine args as a shell-quoted suffix string (for the ssh command path). '' when no options. */
export function engineArgsShell(engine: AgentType, opts?: EngineOptions): string {
  const args = buildEngineArgs(engine, opts)
  return args.length ? ' ' + args.map(shq).join(' ') : ''
}
