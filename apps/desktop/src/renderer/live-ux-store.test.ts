import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentActivity } from '@apc/shared'
import type { ResumeCard } from '@apc/dashboard-api'

const mocks = vi.hoisted(() => ({
  agentActivitySnapshot: vi.fn(),
  resumeCard: vi.fn(),
}))

vi.mock('./api.js', () => ({
  api: {
    agentActivitySnapshot: mocks.agentActivitySnapshot,
    resumeCard: mocks.resumeCard,
  },
}))

import { mergeAgentActivities, useStore } from './store.js'

function activity(paneId: string, revision: number, lastActivityAt = '2026-07-20T10:00:00Z'): AgentActivity {
  return {
    pane: {
      paneId, projectId: 'p1', worktreePath: '/repo', slotId: paneId.split(':').at(-1) ?? paneId, agent: 'codex',
    },
    launchId: `launch-${revision}`,
    connection: 'connected',
    phase: 'working',
    processAlive: true,
    lastActivityAt,
    revision,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState({
    selectedProjectId: 'p1',
    activities: [],
    activitySnapshotAsOf: null,
    activityLoadGeneration: 0,
    resumeCard: null,
    resumeBannerOpen: false,
    error: null,
  })
})

describe('live UX store ordering', () => {
  test('keeps the exact worktree and slot when targeting a pane', () => {
    const pane = {
      paneId: 'p1:feature:codex-2', projectId: 'p1', worktreePath: '/repo-feature', slotId: 'codex-2', agent: 'codex' as const,
    }

    useStore.getState().focusAgentPane(pane)

    expect(useStore.getState().activeWorktrees.p1).toBe('/repo-feature')
    expect(useStore.getState().paneTarget?.pane).toEqual(pane)
    useStore.getState().clearPaneTarget('another-pane')
    expect(useStore.getState().paneTarget?.pane).toEqual(pane)
    useStore.getState().clearPaneTarget(pane.paneId)
    expect(useStore.getState().paneTarget).toBeNull()
  })

  test('never rolls a pane backward when a lower or equal revision arrives', () => {
    const current = activity('p1:main:codex-1', 5)
    const result = mergeAgentActivities(
      [current],
      [activity('p1:main:codex-1', 4), activity('p1:main:codex-1', 5)],
    )

    expect(result).toEqual([current])
  })

  test('keeps a newer live event when an older snapshot resolves later', async () => {
    useStore.setState({ activities: [activity('p1:main:codex-1', 8)] })
    mocks.agentActivitySnapshot.mockResolvedValue({
      activities: [activity('p1:main:codex-1', 3)],
      asOf: '2026-07-20T10:01:00Z',
    })

    await useStore.getState().loadAgentActivities('p1')

    expect(useStore.getState().activities[0]?.revision).toBe(8)
    expect(useStore.getState().activitySnapshotAsOf).toBe('2026-07-20T10:01:00Z')
  })

  test('drops a resume-card response after the selected project changes', async () => {
    const pending = deferred<ResumeCard | null>()
    mocks.resumeCard.mockReturnValue(pending.promise)
    const existing = { project: { id: 'p2' }, hasHistory: false }
    useStore.setState({ resumeCard: existing as unknown as ResumeCard })

    const request = useStore.getState().loadResumeCard('p1')
    useStore.setState({ selectedProjectId: 'p2' })
    pending.resolve({ project: { id: 'p1' }, hasHistory: true } as unknown as ResumeCard)
    await request

    expect(useStore.getState().resumeCard).toBe(existing)
    expect(useStore.getState().resumeBannerOpen).toBe(false)
  })
})
