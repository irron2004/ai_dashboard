import { beforeEach, describe, expect, test, vi } from 'vitest'

// Mock the IPC api layer so the store can be exercised without window.apc / Electron.
vi.mock('./api.js', () => ({
  api: {
    harnessResume: vi.fn(),
    harnessGetRun: vi.fn(),
    harnessCanonicalProposals: vi.fn(),
    harnessPromoteCanonical: vi.fn(),
  },
}))

import { api } from './api.js'
import { useStore } from './store.js'

const mockApi = api as unknown as {
  harnessResume: ReturnType<typeof vi.fn>
  harnessGetRun: ReturnType<typeof vi.fn>
  harnessCanonicalProposals: ReturnType<typeof vi.fn>
  harnessPromoteCanonical: ReturnType<typeof vi.fn>
}

const RUN_STATE = { runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'HUMAN_REVIEW_REQUIRED', history: [], artifacts: {} }

describe('harness store actions (api mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({ selectedProjectId: 'p1', selectedHarnessRunId: 'RUN-1', harnessRuns: [], harnessCanonicalProposals: [], harnessMessage: null, error: null })
    mockApi.harnessGetRun.mockResolvedValue({ ok: true, runState: RUN_STATE, artifacts: [] })
    mockApi.harnessCanonicalProposals.mockResolvedValue([])
  })

  test('resumeHarnessRun calls api.harnessResume and reports the final state', async () => {
    mockApi.harnessResume.mockResolvedValue({ ok: true, runId: 'RUN-1', finalState: 'HUMAN_REVIEW_REQUIRED' })
    await useStore.getState().resumeHarnessRun()
    expect(mockApi.harnessResume).toHaveBeenCalledWith({ runId: 'RUN-1' })
    expect(useStore.getState().harnessMessage).toContain('Resumed')
  })

  test('resumeHarnessRun surfaces a failure reason without throwing', async () => {
    mockApi.harnessResume.mockResolvedValue({ ok: false, reason: 'run already in progress' })
    await useStore.getState().resumeHarnessRun()
    expect(useStore.getState().harnessMessage).toContain('already in progress')
  })

  test('loadCanonicalProposals populates state with the fetched list', async () => {
    mockApi.harnessCanonicalProposals.mockResolvedValue([{ proposalRelPath: 'current.proposal.md', canonicalPath: 'current.md', currentHash: 'H' }])
    await useStore.getState().loadCanonicalProposals('RUN-1')
    expect(useStore.getState().harnessCanonicalProposals).toEqual([{ proposalRelPath: 'current.proposal.md', canonicalPath: 'current.md', currentHash: 'H' }])
  })

  test('promoteCanonicalDoc passes the captured lastReadHash and reports a promote', async () => {
    mockApi.harnessPromoteCanonical.mockResolvedValue({ ok: true, status: 'promoted', canonicalPath: 'current.md' })
    await useStore.getState().promoteCanonicalDoc('current.proposal.md', 'CAPTURED_HASH')
    expect(mockApi.harnessPromoteCanonical).toHaveBeenCalledWith({ runId: 'RUN-1', proposalRelPath: 'current.proposal.md', lastReadHash: 'CAPTURED_HASH' })
    expect(useStore.getState().harnessMessage).toContain('Promoted')
  })

  test('promoteCanonicalDoc surfaces a conflict result', async () => {
    mockApi.harnessPromoteCanonical.mockResolvedValue({ ok: true, status: 'conflict', conflictPath: 'current.2026-06-03.conflict.md' })
    await useStore.getState().promoteCanonicalDoc('current.proposal.md', 'STALE')
    expect(useStore.getState().harnessMessage).toContain('conflict.md')
  })
})
