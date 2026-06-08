import { describe, expect, test } from 'vitest'
import { buildWikiPrompt } from './prompts.js'
import type { NormalizedSession } from '@apc/shared'

const session: NormalizedSession = {
  id: 's1', agentType: 'claude', repoPath: '/work/apc', branch: 'main',
  sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
  turns: [
    { role: 'user', text: 'add ingest adapters', toolCalls: [] },
    { role: 'assistant', text: 'done; edited claude-adapter.ts', toolCalls: [] },
  ],
  filesTouched: ['packages/agents/src/claude-adapter.ts'],
}

describe('buildWikiPrompt', () => {
  test('includes the transcript, files, and a strict JSON-output instruction', () => {
    const p = buildWikiPrompt(session, { currentCanonical: '## Current\n- nothing yet\n' })
    expect(p).toContain('add ingest adapters')
    expect(p).toContain('claude-adapter.ts')
    expect(p).toContain('## Current')
    expect(p.toLowerCase()).toContain('json')
    expect(p).toContain('workSummary')        // names the required output keys
    expect(p).toContain('currentProposalMarkdown')
  })
  test('truncates very long transcripts to a bounded size', () => {
    const big = { ...session, turns: [{ role: 'user' as const, text: 'x'.repeat(50000), toolCalls: [] }] }
    expect(buildWikiPrompt(big, { currentCanonical: '' }).length).toBeLessThan(40000)
  })
})
