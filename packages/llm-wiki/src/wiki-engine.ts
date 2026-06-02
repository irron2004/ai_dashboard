import { WikiGenerationSchema, type AgentType, type NormalizedSession, type WikiGeneration } from '@apc/shared'
import type { AgentRunner } from './agent-runner.js'
import { buildWikiPrompt } from './prompts.js'
import { parseStructured, unwrapAgentJson } from './parse-structured.js'

export class WikiEngine {
  constructor(private readonly runner: AgentRunner, private readonly timeoutMs = 120000) {}

  async generate(
    session: NormalizedSession,
    opts: { engine: AgentType; currentCanonical: string },
  ): Promise<WikiGeneration> {
    const prompt = buildWikiPrompt(session, { currentCanonical: opts.currentCanonical })
    const res = await this.runner.run({ agent: opts.engine, prompt, timeoutMs: this.timeoutMs })
    if (!res.ok) throw new Error(`Wiki engine run failed (engine=${opts.engine})`)
    return parseStructured(unwrapAgentJson(res.output, opts.engine), WikiGenerationSchema)
  }
}
