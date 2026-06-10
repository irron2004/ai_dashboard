import type { ZodType, ZodTypeDef } from 'zod'
import type { AgentType } from '@apc/shared'
import { type AgentRunner, unwrapAgentJson, parseStructured } from '@apc/llm-wiki'

// Leave the Zod Input param unconstrained: with `.default()` fields a schema's input type differs
// from its output type, so `ZodType<O>` (which ties Input===Output===O) would mis-infer O as the
// input. `ZodType<O, ZodTypeDef, unknown>` binds O cleanly to the OUTPUT (post-parse) type.
export type LlmAgentConfig<O> = { name: string; role: string; schema: ZodType<O, ZodTypeDef, unknown>; preamble: string }
export type LlmRunArgs = { runner: AgentRunner; engine: AgentType; input: unknown; timeoutMs?: number; cwd?: string; label?: string }

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
    const res = await args.runner.run({ agent: args.engine, prompt: this.buildPrompt(args.input), timeoutMs: args.timeoutMs ?? 180000, cwd: args.cwd, label: args.label })
    if (!res.ok) {
      // stderr가 있으면 그것이 진짜 에러일 확률이 높다 (codex는 stdout에 파일 열거를 쏟는다).
      // 에러가 출력의 앞/뒤 어디에 있을지 엔진마다 다르므로 양단(head+tail)을 함께 노출한다.
      const src = (res.stderr?.trim() ? res.stderr : res.raw) || 'agent runner returned not-ok'
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
