// packages/agents/src/resume.find.test.ts
import { describe, test, expect } from 'vitest'
import type { AgentIngestAdapter } from './types.js'
import type { AgentSource, NormalizedSession } from '@apc/shared'
import { findLatestSession } from './resume.js'

function fakeAdapter(rows: Array<{ source: Partial<AgentSource>; session: Partial<NormalizedSession> }>): AgentIngestAdapter {
  return {
    agentKind: 'claude',
    async discoverSources() {
      return rows.map((r, i) => ({
        id: `s${i}`, agentKind: 'claude', kind: 'jsonl-file', locator: `/l${i}`, ...r.source,
      })) as AgentSource[]
    },
    async parseSource(source) {
      const r = rows.find((x, i) => (x.source.id ?? `s${i}`) === source.id)!
      return { session: { id: 's', agentType: 'claude', ...r.session } as NormalizedSession, position: '' }
    },
  }
}

describe('findLatestSession', () => {
  test('picks newest session matching repoPath', async () => {
    const adapter = fakeAdapter([
      { source: { id: 's0' }, session: { id: 'old', repoPath: '/repo/a', endedAt: '2026-06-01T00:00:00Z' } },
      { source: { id: 's1' }, session: { id: 'new', repoPath: '/repo/a', endedAt: '2026-06-10T00:00:00Z' } },
      { source: { id: 's2' }, session: { id: 'other', repoPath: '/repo/b', endedAt: '2026-06-20T00:00:00Z' } },
    ])
    const r = await findLatestSession(adapter, '/repo/a')
    expect(r?.sessionId).toBe('new')
  })

  test('returns null when no session matches repoPath', async () => {
    const adapter = fakeAdapter([{ source: { id: 's0' }, session: { id: 'x', repoPath: '/other' } }])
    expect(await findLatestSession(adapter, '/repo/a')).toBeNull()
  })
})
