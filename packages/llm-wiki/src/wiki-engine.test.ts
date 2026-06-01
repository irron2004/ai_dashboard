import { describe, expect, test } from 'vitest'
import { FakeAgentRunner } from './agent-runner.js'
import { WikiEngine } from './wiki-engine.js'
import type { NormalizedSession } from '@apc/shared'

const session: NormalizedSession = {
  id: 's1', agentType: 'claude', repoPath: '/work/apc',
  turns: [{ role: 'user', text: 'do the thing', toolCalls: [] }], filesTouched: [],
}

describe('WikiEngine.generate', () => {
  test('runs the chosen engine, parses JSON, returns a validated WikiGeneration', async () => {
    const runner = new FakeAgentRunner([
      JSON.stringify({ workSummary: 'did the thing', filesTouched: ['a.ts'],
        openProblems: [], nextTasks: [{ title: 'next', rationale: 'because' }],
        currentProposalMarkdown: '## Current\n- did the thing\n' }),
    ])
    const engine = new WikiEngine(runner)
    const gen = await engine.generate(session, { engine: 'codex', currentCanonical: '' })
    expect(gen.workSummary).toBe('did the thing')
    expect(gen.nextTasks[0].title).toBe('next')
    expect(runner.calls[0].agent).toBe('codex')        // used the selected engine
  })

  test('throws a clear error when the runner fails', async () => {
    const engine = new WikiEngine(new FakeAgentRunner([]))   // exhausted → ok:false
    await expect(engine.generate(session, { engine: 'claude', currentCanonical: '' }))
      .rejects.toThrow(/engine run failed/i)
  })
})
