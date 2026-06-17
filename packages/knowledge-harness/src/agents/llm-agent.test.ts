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

  test('embeds the output JSON Schema (exact field names + required) so the model cannot invent keys', async () => {
    const Schema = z.object({ project_id: z.string(), generated_by: z.string(), summary: z.string().default('') })
    const agent = new LlmAgent({ name: 'project-discovery', role: 'r', schema: Schema, preamble: 'P' })
    const prompt = agent.buildPrompt({ projectId: 'p1' })
    expect(prompt).toContain('"project_id"')
    expect(prompt).toContain('"generated_by"')
    expect(prompt).toContain('"required"')
    // required must list the no-default fields, not the defaulted `summary`
    expect(prompt).toMatch(/"required":\s*\[\s*"project_id",\s*"generated_by"\s*\]/)
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

  test('shows BOTH head and tail of a long error (defect B: error may be at either end)', async () => {
    const longRaw = 'HEAD_REAL_ERROR ' + 'noise '.repeat(300) + 'TAIL_REAL_ERROR'
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: longRaw }) }
    const err = await tinyAgent().run({ runner: failing, engine: 'codex', input: {} }).catch((e: Error) => e)
    expect(String(err)).toContain('HEAD_REAL_ERROR')
    expect(String(err)).toContain('TAIL_REAL_ERROR')
  })

  test('surfaces the engine JSON error (e.g. claude 429 session limit) over shell noise', async () => {
    // claude --output-format json reports the real failure in stdout; stderr here is just shell noise.
    const claudeJson = JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: "You've hit your session limit · resets 9am (UTC)" })
    const failing: AgentRunner = { run: async () => ({ ok: false, output: claudeJson, raw: claudeJson, stderr: 'bash: no job control in this shell' }) }
    const err = await tinyAgent().run({ runner: failing, engine: 'claude', input: {} }).catch((e: Error) => e)
    expect(String(err)).toContain('session limit')
    expect(String(err)).toContain('HTTP 429')
    expect(String(err)).not.toContain('no job control')
  })

  test('prefers stderr over raw when present', async () => {
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: 'file-listing-noise', stderr: 'codex: not authenticated' }) }
    const err = await tinyAgent().run({ runner: failing, engine: 'codex', input: {} }).catch((e: Error) => e)
    expect(String(err)).toContain('not authenticated')
    expect(String(err)).not.toContain('file-listing-noise')
  })

  test('includes exit code and log dir pointer when provided', async () => {
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: 'boom', exitCode: 2, logDir: '/runs/R/logs/01-X' }) }
    const err = await tinyAgent().run({ runner: failing, engine: 'codex', input: {} }).catch((e: Error) => e)
    expect(String(err)).toContain('exit 2')
    expect(String(err)).toContain('/runs/R/logs/01-X')
  })

  test('forwards label to the runner', async () => {
    const calls: RunInput[] = []
    const rec: AgentRunner = { run: async (i) => { calls.push(i); return { ok: false, output: '', raw: '' } } }
    await tinyAgent().run({ runner: rec, engine: 'codex', input: {}, label: 'STATE-agent' }).catch(() => {})
    expect(calls[0].label).toBe('STATE-agent')
  })
})
