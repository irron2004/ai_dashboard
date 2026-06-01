import { describe, expect, test } from 'vitest'
import { FakeAgentRunner } from './agent-runner.js'

describe('FakeAgentRunner', () => {
  test('returns queued outputs in order and records calls', async () => {
    const r = new FakeAgentRunner(['first', 'second'])
    expect((await r.run({ agent: 'claude', prompt: 'p1', timeoutMs: 1000 })).output).toBe('first')
    expect((await r.run({ agent: 'codex', prompt: 'p2', timeoutMs: 1000 })).output).toBe('second')
    expect(r.calls.map((c) => c.agent)).toEqual(['claude', 'codex'])
  })
  test('ok=false when the queue is exhausted', async () => {
    const r = new FakeAgentRunner([])
    expect((await r.run({ agent: 'claude', prompt: 'p', timeoutMs: 1 })).ok).toBe(false)
  })
})
