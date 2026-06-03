import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { CliAgentRunner } from './cli-agent-runner.js'
import { parseStructured, unwrapAgentJson } from './parse-structured.js'
import type { AgentType } from '@apc/shared'

/**
 * #37 — opt-in real-LLM smoke. SKIPPED by default so CI stays hermetic. Run with a real agent CLI on PATH:
 *   KH_REAL_LLM=1 KH_REAL_ENGINE=claude pnpm --filter @apc/llm-wiki test real-llm-smoke
 * It verifies the end-to-end contract that the FakeAgentRunner cannot: a real model, asked for JSON only,
 * produces output that unwraps + parses against a schema. This is the one check that validates prompt
 * steering against an actual model before the harness is trusted with a real vault.
 */
const RUN_REAL = process.env.KH_REAL_LLM === '1'
const engine = (process.env.KH_REAL_ENGINE ?? 'claude') as AgentType

const Shape = z.object({ ok: z.boolean(), note: z.string().default('') })

describe('real-LLM smoke (opt-in)', () => {
  test.runIf(RUN_REAL)('a real CLI agent returns JSON that unwraps + parses', async () => {
    const runner = new CliAgentRunner()
    const prompt = 'Respond with ONLY this JSON object and nothing else: {"ok": true, "note": "smoke"}'
    const res = await runner.run({ agent: engine, prompt, timeoutMs: 120_000 })
    expect(res.ok).toBe(true)
    const parsed = parseStructured(unwrapAgentJson(res.output, engine), Shape)
    expect(parsed.ok).toBe(true)
  }, 130_000)

  test.skipIf(RUN_REAL)('placeholder so the suite is non-empty when the real-LLM smoke is skipped', () => {
    expect(RUN_REAL).toBe(false)
  })
})
