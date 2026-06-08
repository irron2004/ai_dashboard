import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { LlmAgent } from './llm-agent.js'

const Out = z.object({ value: z.string() })

describe('LlmAgent', () => {
  test('assembles preamble+role+input, runs, unwraps, and parses to schema', async () => {
    const runner = new FakeAgentRunner([JSON.stringify({ value: 'hi' })])
    const agent = new LlmAgent({
      name: 'test-agent', role: 'You output JSON.', schema: Out, preamble: 'RULES-PREAMBLE',
    })
    const out = await agent.run({ runner, engine: 'codex', input: { topic: 'x' }, timeoutMs: 1000 })
    expect(out).toEqual({ value: 'hi' })
    const prompt = runner.calls[0].prompt
    expect(prompt).toContain('RULES-PREAMBLE')
    expect(prompt).toContain('You output JSON.')
    expect(prompt).toContain('"topic"')
    expect(runner.calls[0].agent).toBe('codex')
  })

  test('throws when the runner reports not-ok', async () => {
    const runner = new FakeAgentRunner([])  // first call returns ok:false
    const agent = new LlmAgent({ name: 't', role: 'r', schema: Out, preamble: 'P' })
    await expect(agent.run({ runner, engine: 'claude', input: {}, timeoutMs: 10 })).rejects.toThrow(/failed/)
  })
})
