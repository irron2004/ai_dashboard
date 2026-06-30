import { z } from 'zod'
import { LlmAgent } from '@apc/knowledge-harness'
import type { AgentRunner } from '@apc/llm-wiki'
import type { AgentType, NormalizedSession } from '@apc/shared'

const TitleSchema = z.object({ title: z.string() })

const ROLE = [
  'You summarize an agent work session into a single concise task title (≤ 80 chars).',
  'The title should name what the user asked for, in their language. No quotes, no trailing period.',
].join(' ')

/** LLM-backed session → one-line title. Throws on runner/parse failure (caller falls back). */
export function makeSessionSummarizer(deps: { runner: AgentRunner; engine: AgentType; preamble?: string }): (session: NormalizedSession) => Promise<string> {
  const agent = new LlmAgent({ name: 'session-titler', role: ROLE, schema: TitleSchema, preamble: deps.preamble ?? '' })
  return async (session: NormalizedSession): Promise<string> => {
    const requests = session.turns.filter((t) => t.role === 'user' && t.text.trim()).map((t) => t.text.trim()).slice(0, 6)
    const out = await agent.run({ runner: deps.runner, engine: deps.engine, input: { requests }, label: 'session-titler' })
    return out.title.trim()
  }
}
