import { describe, expect, test } from 'vitest'
import type { AgentSource, NormalizedSession } from '@apc/shared'
import type { AgentIngestAdapter } from './types.js'
import { pickLatestSession } from './latest-session.js'

function sess(id: string, repoPath: string, endedAt: string): NormalizedSession {
  return {
    id, agentType: 'claude', repoPath, endedAt,
    sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
    turns: [{ role: 'user', text: `q-${id}`, timestamp: endedAt, toolCalls: [] }], filesTouched: [],
  }
}
function adapter(sessions: NormalizedSession[]): AgentIngestAdapter {
  return {
    discoverSources: async () => sessions.map((s, i) => ({ id: `src${i}`, agentKind: 'claude', kind: 'jsonl-file', locator: `/x${i}.jsonl`, repoPath: s.repoPath, mtimeMs: Date.parse(s.endedAt!) })),
    parseSource: async (src: AgentSource) => ({ session: sessions.find((s) => s.repoPath === src.repoPath && Date.parse(s.endedAt!) === src.mtimeMs)!, position: 'p' }),
  } as unknown as AgentIngestAdapter
}

describe('pickLatestSession', () => {
  test('returns the newest repoPath-matching session across adapters', async () => {
    const a = adapter([sess('old', '/work/apc', '2026-07-01T00:00:00Z'), sess('new', '/work/apc', '2026-07-07T00:00:00Z')])
    const b = adapter([sess('other', '/work/other', '2026-07-08T00:00:00Z')])
    const got = await pickLatestSession([{ agent: 'claude', adapter: a }, { agent: 'codex', adapter: b }], '/work/apc')
    expect(got?.session.id).toBe('new')
    expect(got?.agent).toBe('claude')
  })

  test('returns null when no session matches repoPath', async () => {
    const a = adapter([sess('x', '/work/other', '2026-07-07T00:00:00Z')])
    expect(await pickLatestSession([{ agent: 'claude', adapter: a }], '/work/apc')).toBeNull()
  })
})
