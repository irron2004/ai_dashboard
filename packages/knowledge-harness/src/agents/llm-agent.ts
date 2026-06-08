import type { ZodType, ZodTypeDef } from 'zod'
import type { AgentType } from '@apc/shared'
import { type AgentRunner, unwrapAgentJson, parseStructured } from '@apc/llm-wiki'

// Leave the Zod Input param unconstrained: with `.default()` fields a schema's input type differs
// from its output type, so `ZodType<O>` (which ties Input===Output===O) would mis-infer O as the
// input. `ZodType<O, ZodTypeDef, unknown>` binds O cleanly to the OUTPUT (post-parse) type.
export type LlmAgentConfig<O> = { name: string; role: string; schema: ZodType<O, ZodTypeDef, unknown>; preamble: string }
export type LlmRunArgs = { runner: AgentRunner; engine: AgentType; input: unknown; timeoutMs?: number; cwd?: string }

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
      'Respond with ONLY a single JSON object matching the required schema. No prose.',
    ].join('\n\n')
  }

  async run(args: LlmRunArgs): Promise<O> {
    const res = await args.runner.run({ agent: args.engine, prompt: this.buildPrompt(args.input), timeoutMs: args.timeoutMs ?? 180000, cwd: args.cwd })
    if (!res.ok) {
      // Engine CLIs print a startup banner first and the actual error LAST, so surface the TAIL
      // (not the head) — otherwise the message is just the banner and the real failure is cut off.
      const raw = res.raw || 'agent runner returned not-ok'
      const detail = raw.length > 800 ? `…${raw.slice(-800)}` : raw
      throw new Error(`${this.cfg.name} failed (${args.engine}): ${detail}`)
    }
    // parseStructured's generic ties input===output; our schema's input is `unknown`, so cast to the
    // output-typed view. Sound: parseStructured validates against the schema at runtime.
    return parseStructured(unwrapAgentJson(res.output, args.engine), this.cfg.schema as ZodType<O>)
  }
}
