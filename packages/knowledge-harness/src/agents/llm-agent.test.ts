import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { FakeAgentRunner } from '@apc/llm-wiki'
import type { AgentRunner, RunInput } from '@apc/llm-wiki'
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

const tinyAgent = () => new LlmAgent({ name: 'project-discovery', role: 'r', preamble: 'p', schema: z.object({ ok: z.boolean() }) })

describe('LlmAgent failure + cwd', () => {
  test('surfaces the runner raw error and the engine name when not ok', async () => {
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: 'spawn claude ENOENT' }) }
    await expect(tinyAgent().run({ runner: failing, engine: 'claude', input: {} }))
      .rejects.toThrow(/project-discovery failed \(claude\): .*ENOENT/)
  })

  test('forwards cwd to the runner', async () => {
    const calls: RunInput[] = []
    const rec: AgentRunner = { run: async (i) => { calls.push(i); return { ok: false, output: '', raw: '' } } }
    await tinyAgent().run({ runner: rec, engine: 'codex', input: { x: 1 }, cwd: '/my/proj' }).catch(() => {})
    expect(calls[0].cwd).toBe('/my/proj')
  })

  test('surfaces the TAIL of a long engine error (banner first, real error last)', async () => {
    // Engine CLIs (codex/claude/opencode) print a startup banner first and the actual failure LAST;
    // head-truncation would only show the useless banner.
    const longRaw = 'OpenAI Codex v0.137.0 banner '.repeat(60) + 'REAL_ERROR_AT_THE_END'
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: longRaw }) }
    await expect(tinyAgent().run({ runner: failing, engine: 'codex', input: {} }))
      .rejects.toThrow(/REAL_ERROR_AT_THE_END/)
  })
})
