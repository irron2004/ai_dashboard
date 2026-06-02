import { beforeEach, describe, expect, test, vi } from 'vitest'

// Mock the IPC api layer so the store can be exercised without window.apc / Electron.
vi.mock('./api.js', () => ({
  api: {
    harnessRun: vi.fn(),
    harnessResume: vi.fn(),
    harnessGetRun: vi.fn(),
    harnessPromote: vi.fn(),
    harnessCanonicalProposals: vi.fn(),
    harnessPromoteCanonical: vi.fn(),
  },
}))

import { api } from './api.js'
import { useStore } from './store.js'

const mockApi = api as unknown as {
  harnessRun: ReturnType<typeof vi.fn>
  harnessResume: ReturnType<typeof vi.fn>
  harnessGetRun: ReturnType<typeof vi.fn>
  harnessPromote: ReturnType<typeof vi.fn>
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

  test('startHarnessRun runs then loads the run; selects it and reports final state', async () => {
    mockApi.harnessRun.mockResolvedValue({ ok: true, runId: 'RUN-2', finalState: 'HUMAN_REVIEW_REQUIRED' })
    mockApi.harnessGetRun.mockResolvedValue({ ok: true, runState: { ...RUN_STATE, runId: 'RUN-2' }, artifacts: [] })
    await useStore.getState().startHarnessRun()
    expect(mockApi.harnessRun).toHaveBeenCalledWith({ projectId: 'p1', engine: expect.any(String) })
    expect(useStore.getState().selectedHarnessRunId).toBe('RUN-2')
    expect(useStore.getState().harnessMessage).toContain('RUN-2')
  })

  test('startHarnessRun without a project errors instead of calling the api', async () => {
    useStore.setState({ selectedProjectId: null })
    await useStore.getState().startHarnessRun()
    expect(mockApi.harnessRun).not.toHaveBeenCalled()
    expect(useStore.getState().error).toContain('Select a project')
  })

  test('refreshHarnessRun without a selected run errors', async () => {
    useStore.setState({ selectedHarnessRunId: null })
    await useStore.getState().refreshHarnessRun()
    expect(mockApi.harnessGetRun).not.toHaveBeenCalled()
    expect(useStore.getState().error).toContain('Select a harness run')
  })

  test('promoteHarnessRun reports a basic staging promote (message survives the refresh)', async () => {
    mockApi.harnessPromote.mockResolvedValue({ ok: true, promoted: ['concepts/n1.md'], proposals: [] })
    await useStore.getState().promoteHarnessRun()
    expect(mockApi.harnessPromote).toHaveBeenCalledWith({ runId: 'RUN-1' })
    expect(useStore.getState().harnessMessage).toContain('Promoted 1 file')
  })

  test('promoteHarnessRun surfaces a failure reason', async () => {
    mockApi.harnessPromote.mockResolvedValue({ ok: false, reason: 'secret finding(s) in staging' })
    await useStore.getState().promoteHarnessRun()
    expect(useStore.getState().harnessMessage).toContain('secret finding')
  })

  test('selectHarnessRun clears stale canonical proposals (no cross-run promotion)', () => {
    useStore.setState({ harnessCanonicalProposals: [{ proposalRelPath: 'current.proposal.md', canonicalPath: 'current.md', currentHash: 'OLD' }] })
    useStore.getState().selectHarnessRun('RUN-OTHER')
    expect(useStore.getState().harnessCanonicalProposals).toEqual([])
  })

  test('loadCanonicalProposals surfaces an IPC error instead of silently showing empty', async () => {
    mockApi.harnessCanonicalProposals.mockRejectedValue(new Error('ipc boom'))
    await useStore.getState().loadCanonicalProposals('RUN-1')
    expect(useStore.getState().harnessCanonicalProposals).toEqual([])
    expect(useStore.getState().harnessMessage).toContain('Could not load canonical proposals')
  })
})
