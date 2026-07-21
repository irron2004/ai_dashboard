import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { HarnessRunBundle } from './harness-utils.js'
import { saveHarnessRuns, saveHarnessSelectedRun } from './harness-utils.js'

const mocks = vi.hoisted(() => ({
  harnessSetReviewDecisions: vi.fn(),
  harnessPromote: vi.fn(),
}))

vi.mock('./api.js', () => ({ api: mocks }))

import { useStore } from './store.js'

function bundle(
  runId: string,
  decisions: Array<{ proposal_id: string; verdict: 'approved' | 'excluded'; decided_at: string }> = [],
  withArtifact = decisions.length > 0,
): HarnessRunBundle {
  const path = 'artifacts/HUMAN_REVIEW_REQUIRED/review-decisions.json'
  return {
    runState: {
      runId,
      projectId: 'p1',
      engine: 'codex',
      state: 'HUMAN_REVIEW_REQUIRED',
      history: [],
      artifacts: withArtifact ? { HUMAN_REVIEW_REQUIRED: [path] } : {},
    },
    artifacts: withArtifact ? [{
      state: 'HUMAN_REVIEW_REQUIRED', name: 'review-decisions', path, data: { decisions },
    }] : [],
  }
}

function withProposals(run: HarnessRunBundle, proposalIds: string[]): HarnessRunBundle {
  return {
    ...run,
    artifacts: [
      ...run.artifacts,
      {
        state: 'NODE_PROPOSALS_CREATED',
        name: 'node-proposals',
        path: 'artifacts/NODE_PROPOSALS_CREATED/node-proposals.json',
        data: { proposals: proposalIds.map((proposal_id) => ({ proposal_id })) },
      },
    ],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.harnessSetReviewDecisions.mockResolvedValue({ ok: true })
  mocks.harnessPromote.mockResolvedValue({ ok: false, reason: 'expected test stop' })
  useStore.setState({
    selectedProjectId: 'p1',
    harnessRuns: [],
    selectedHarnessRunId: null,
    harnessReviewDecisions: {},
    harnessMessage: null,
  })
})

describe('review verdict store', () => {
  test('hydrates and switches verdicts from each run artifact', () => {
    const now = '2026-07-21T00:00:00Z'
    const runs = [
      bundle('RUN-1', [{ proposal_id: 'NP-1', verdict: 'approved', decided_at: now }]),
      bundle('RUN-2', [{ proposal_id: 'NP-2', verdict: 'excluded', decided_at: now }]),
    ]
    saveHarnessRuns('p1', runs)
    saveHarnessSelectedRun('p1', 'RUN-1')

    useStore.getState().hydrateHarnessProject('p1')
    expect(useStore.getState().harnessReviewDecisions).toEqual({ 'NP-1': 'approved' })
    useStore.getState().selectHarnessRun('RUN-2')
    expect(useStore.getState().harnessReviewDecisions).toEqual({ 'NP-2': 'excluded' })
  })

  test('optimistically saves the full decision map and updates the cached run artifact', async () => {
    useStore.setState({
      harnessRuns: [bundle('RUN-1')], selectedHarnessRunId: 'RUN-1', harnessReviewDecisions: {},
    })
    const saving = useStore.getState().setReviewVerdict(['NP-1'], 'approved')
    expect(useStore.getState().harnessReviewDecisions).toEqual({ 'NP-1': 'approved' })
    await saving

    expect(mocks.harnessSetReviewDecisions).toHaveBeenCalledWith({
      runId: 'RUN-1',
      decisions: [{ proposal_id: 'NP-1', verdict: 'approved', decided_at: expect.any(String) }],
    })
    expect(useStore.getState().harnessRuns[0].artifacts.find((item) => item.name === 'review-decisions')?.data)
      .toMatchObject({ decisions: [{ proposal_id: 'NP-1', verdict: 'approved' }] })
  })

  test('rolls back the exact optimistic snapshot when persistence fails', async () => {
    mocks.harnessSetReviewDecisions.mockResolvedValue({ ok: false, reason: 'disk full' })
    useStore.setState({
      harnessRuns: [bundle('RUN-1')],
      selectedHarnessRunId: 'RUN-1',
      harnessReviewDecisions: { 'NP-1': 'approved' },
    })
    await useStore.getState().setReviewVerdict(['NP-2'], 'excluded')
    expect(useStore.getState().harnessReviewDecisions).toEqual({ 'NP-1': 'approved' })
    expect(useStore.getState().harnessMessage).toContain('disk full')
  })

  test('serializes replace-all writes so a rapid newer verdict cannot be overwritten by an older request', async () => {
    const first = deferred<{ ok: true }>()
    const second = deferred<{ ok: true }>()
    mocks.harnessSetReviewDecisions
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    useStore.setState({
      harnessRuns: [bundle('RUN-1')], selectedHarnessRunId: 'RUN-1', harnessReviewDecisions: {},
    })

    const saveFirst = useStore.getState().setReviewVerdict(['NP-1'], 'approved')
    const saveSecond = useStore.getState().setReviewVerdict(['NP-2'], 'excluded')
    await vi.waitFor(() => expect(mocks.harnessSetReviewDecisions).toHaveBeenCalledTimes(1))

    first.resolve({ ok: true })
    await saveFirst
    await vi.waitFor(() => expect(mocks.harnessSetReviewDecisions).toHaveBeenCalledTimes(2))
    expect(mocks.harnessSetReviewDecisions.mock.calls[1][0].decisions).toEqual([
      { proposal_id: 'NP-1', verdict: 'approved', decided_at: expect.any(String) },
      { proposal_id: 'NP-2', verdict: 'excluded', decided_at: expect.any(String) },
    ])
    second.resolve({ ok: true })
    await saveSecond
    expect(useStore.getState().harnessReviewDecisions)
      .toEqual({ 'NP-1': 'approved', 'NP-2': 'excluded' })
  })

  test('persists the selected decision snapshot before promoting a proposal-bearing run', async () => {
    const order: string[] = []
    mocks.harnessSetReviewDecisions.mockImplementation(async () => {
      order.push('decisions')
      return { ok: true }
    })
    mocks.harnessPromote.mockImplementation(async () => {
      order.push('promote')
      return { ok: false, reason: 'expected test stop' }
    })
    useStore.setState({
      harnessRuns: [withProposals(bundle('RUN-1'), ['NP-1', 'NP-2'])],
      selectedHarnessRunId: 'RUN-1',
      harnessReviewDecisions: { 'NP-1': 'approved' },
    })

    await useStore.getState().promoteHarnessRun()

    expect(order).toEqual(['decisions', 'promote'])
    expect(mocks.harnessSetReviewDecisions).toHaveBeenCalledWith({
      runId: 'RUN-1',
      decisions: [{ proposal_id: 'NP-1', verdict: 'approved', decided_at: expect.any(String) }],
    })
  })

  test('does not promote when the final decision artifact write fails', async () => {
    mocks.harnessSetReviewDecisions.mockResolvedValue({ ok: false, reason: 'disk full' })
    useStore.setState({
      harnessRuns: [withProposals(bundle('RUN-1'), ['NP-1'])],
      selectedHarnessRunId: 'RUN-1',
      harnessReviewDecisions: { 'NP-1': 'approved' },
    })

    await useStore.getState().promoteHarnessRun()

    expect(mocks.harnessPromote).not.toHaveBeenCalled()
    expect(useStore.getState().harnessMessage).toContain('판단 저장 실패: disk full')
  })
})
