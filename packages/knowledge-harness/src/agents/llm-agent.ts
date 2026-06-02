import type { ZodType } from 'zod'
import type { AgentType } from '@apc/shared'
import { type AgentRunner, unwrapAgentJson, parseStructured } from '@apc/llm-wiki'

export type LlmAgentConfig<O> = { name: string; role: string; schema: ZodType<O>; preamble: string }
export type LlmRunArgs = { runner: AgentRunner; engine: AgentType; input: unknown; timeoutMs?: number }

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
    const res = await args.runner.run({ agent: args.engine, prompt: this.buildPrompt(args.input), timeoutMs: args.timeoutMs ?? 180000 })
    if (!res.ok) throw new Error(`${this.cfg.name} failed: agent runner returned not-ok`)
    return parseStructured(unwrapAgentJson(res.output, args.engine), this.cfg.schema)
  }
}
