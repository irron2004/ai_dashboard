import { describe, it, expect } from 'vitest'
import type { AgentRunner } from '@apc/llm-wiki'
import type { NormalizedSession } from '@apc/shared'
import { makeSessionSummarizer } from './session-summarizer.js'

const fakeRunner = (output: string): AgentRunner => ({
  run: async () => ({ ok: true, output, raw: output, exitCode: 0 }),
}) as unknown as AgentRunner

function session(texts: string[]): NormalizedSession {
  return { id: 's1', agentType: 'claude', turns: texts.map((t) => ({ role: 'user', text: t, toolCalls: [] })), filesTouched: [], sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} } } as NormalizedSession
}

describe('makeSessionSummarizer', () => {
  it('returns the LLM title', async () => {
    const summarize = makeSessionSummarizer({ runner: fakeRunner('{"title":"Recommend stocks for today"}'), engine: 'claude' })
    expect(await summarize(session(['추천 종목 알려줘']))).toBe('Recommend stocks for today')
  })
})
