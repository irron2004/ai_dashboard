import type { ZodType, ZodTypeDef, ZodTypeAny } from 'zod'
import type { AgentType } from '@apc/shared'
import { type AgentRunner, unwrapAgentJson, parseStructured } from '@apc/llm-wiki'
import { zodToJsonSchema } from './zod-to-json-schema.js'

// Leave the Zod Input param unconstrained: with `.default()` fields a schema's input type differs
// from its output type, so `ZodType<O>` (which ties Input===Output===O) would mis-infer O as the
// input. `ZodType<O, ZodTypeDef, unknown>` binds O cleanly to the OUTPUT (post-parse) type.
export type LlmAgentConfig<O> = { name: string; role: string; schema: ZodType<O, ZodTypeDef, unknown>; preamble: string }
export type LlmRunArgs = { runner: AgentRunner; engine: AgentType; input: unknown; timeoutMs?: number; cwd?: string; label?: string }

/**
 * Pull the engine's own error message out of its stdout when a run fails. The CLIs report real
 * failures (usage/session limits, auth, API errors) IN their output, not on stderr — e.g. claude
 * `--output-format json` emits `{ is_error, api_error_status, result }`. Surfacing `result` means an
 * operator sees "You've hit your session limit" instead of unrelated shell noise. Returns null if the
 * output isn't a recognizable error envelope.
 */
export function extractCliError(output: string | undefined): string | null {
  if (!output) return null
  const start = output.indexOf('{')
  if (start < 0) return null
  try {
    const j = JSON.parse(output.slice(start).trim()) as { is_error?: unknown; api_error_status?: unknown; result?: unknown }
    if ((j.is_error === true || typeof j.api_error_status === 'number') && typeof j.result === 'string' && j.result.trim()) {
      return typeof j.api_error_status === 'number' ? `${j.result} (HTTP ${j.api_error_status})` : j.result
    }
  } catch { /* not a JSON error envelope */ }
  return null
}

/** Base for the LLM agents: preamble + role + input JSON → runner → unwrap → parseStructured. */
export class LlmAgent<O> {
  constructor(private readonly cfg: LlmAgentConfig<O>) {}
  get name(): string { return this.cfg.name }

  buildPrompt(input: unknown): string {
    return [
      this.cfg.preamble,
      `## Role: ${this.cfg.name}`,
      this.cfg.role,
      '## Input',
      '```json',
      JSON.stringify(input, null, 2),
      '```',
      '## Output',
      // The model previously invented field names (e.g. `projectId` for the required `project_id`)
      // because the schema was never shown. Embed it so the keys are unambiguous.
      'Respond with ONLY a single JSON object that conforms to this JSON Schema. Use these EXACT field',
      'names (note: snake_case) and include every field listed under "required". No prose, no markdown fences.',
      '```json',
      JSON.stringify(zodToJsonSchema(this.cfg.schema as unknown as ZodTypeAny), null, 2),
      '```',
    ].join('\n\n')
  }

  async run(args: LlmRunArgs): Promise<O> {
    const res = await args.runner.run({ agent: args.engine, prompt: this.buildPrompt(args.input), timeoutMs: args.timeoutMs ?? 180000, cwd: args.cwd, label: args.label })
    if (!res.ok) {
      // Prefer the engine's own error message (claude/codex emit it in stdout JSON) so a real failure
      // like a 429 session limit surfaces instead of benign shell noise. Fall back to stderr, then raw.
      // 에러가 출력의 앞/뒤 어디에 있을지 엔진마다 다르므로 양단(head+tail)을 함께 노출한다.
      const src = extractCliError(res.output) || (res.stderr?.trim() ? res.stderr : res.raw) || 'agent runner returned not-ok'
      const detail = src.length > 800 ? `${src.slice(0, 400)} … ${src.slice(-400)}` : src
      const exit = res.exitCode === undefined ? '' : `, exit ${res.exitCode ?? 'none (timeout/killed)'}`
      const logs = res.logDir ? `\n→ full logs: ${res.logDir}` : ''
      throw new Error(`${this.cfg.name} failed (${args.engine}${exit}): ${detail}${logs}`)
    }
    // parseStructured's generic ties input===output; our schema's input is `unknown`, so cast to the
    // output-typed view. Sound: parseStructured validates against the schema at runtime.
    return parseStructured(unwrapAgentJson(res.output, args.engine), this.cfg.schema as ZodType<O>)
  }
}
