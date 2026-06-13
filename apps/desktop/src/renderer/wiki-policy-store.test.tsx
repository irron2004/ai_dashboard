import { beforeEach, describe, expect, test, vi } from 'vitest'

// Mock the IPC api layer so the store can be exercised without window.apc / Electron.
vi.mock('./api.js', () => ({
  api: {
    harnessProposePolicy: vi.fn(),
    harnessApprovePolicy: vi.fn(),
    harnessGetPolicy: vi.fn(),
    harnessRevertPolicy: vi.fn(),
  },
}))

import { api } from './api.js'
import { useStore } from './store.js'

const mockApi = api as unknown as {
  harnessProposePolicy: ReturnType<typeof vi.fn>
  harnessApprovePolicy: ReturnType<typeof vi.fn>
  harnessGetPolicy: ReturnType<typeof vi.fn>
  harnessRevertPolicy: ReturnType<typeof vi.fn>
}

const PROPOSAL = {
  project_id: 'p1',
  generated_by: 'a',
  project_character: '',
  node_type_priorities: [],
  canonical_definition: '',
  scan_scope_notes: '',
  tailoring_markdown: '',
  rationale: '',
  evidence: [],
}

describe('wiki policy store actions (api mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      selectedProjectId: 'p1',
      wikiPolicy: null,
      wikiPolicyPreview: null,
      wikiPolicyBusy: false,
      wikiPolicyMessage: null,
    })
  })

  test('proposeWikiPolicy stores the returned proposal + preview', async () => {
    mockApi.harnessProposePolicy.mockResolvedValue({
      ok: true,
      proposal: PROPOSAL,
      effectivePreview: 'BASE\n\n## Project Tailoring',
      body: '## Project Tailoring',
    })
    await useStore.getState().proposeWikiPolicy('p1', 'claude')
    expect(useStore.getState().wikiPolicyPreview).toBe('BASE\n\n## Project Tailoring')
    expect(useStore.getState().wikiPolicy?.proposal.project_id).toBe('p1')
    expect(useStore.getState().wikiPolicy?.body).toBe('## Project Tailoring')   // real body, not ''
  })

  test('proposeWikiPolicy sets wikiPolicyBusy=false after completion', async () => {
    mockApi.harnessProposePolicy.mockResolvedValue({ ok: true, proposal: PROPOSAL, effectivePreview: 'X' })
    await useStore.getState().proposeWikiPolicy('p1', 'claude')
    expect(useStore.getState().wikiPolicyBusy).toBe(false)
  })

  test('proposeWikiPolicy stores a failure message on ok:false', async () => {
    mockApi.harnessProposePolicy.mockResolvedValue({ ok: false, reason: 'context too short' })
    await useStore.getState().proposeWikiPolicy('p1', 'claude')
    expect(useStore.getState().wikiPolicyMessage).toContain('context too short')
    expect(useStore.getState().wikiPolicy).toBeNull()
    expect(useStore.getState().wikiPolicyBusy).toBe(false)
  })

  test('proposeWikiPolicy clears wikiPolicyBusy even when the api rejects', async () => {
    mockApi.harnessProposePolicy.mockRejectedValue(new Error('ipc down'))
    await useStore.getState().proposeWikiPolicy('p1', 'claude')
    expect(useStore.getState().wikiPolicyBusy).toBe(false)
    expect(useStore.getState().wikiPolicyMessage).toContain('ipc down')
  })

  test('revertWikiPolicy keeps the policy and reports failure on ok:false', async () => {
    mockApi.harnessRevertPolicy.mockResolvedValue({ ok: false, reason: 'read-only mount' })
    useStore.setState({ wikiPolicy: { status: 'approved', proposal: PROPOSAL, generatedAt: '2026-01-01T00:00:00.000Z', body: 'x' } })
    await useStore.getState().revertWikiPolicy('p1')
    expect(useStore.getState().wikiPolicy).not.toBeNull()
    expect(useStore.getState().wikiPolicyMessage).toContain('read-only mount')
  })

  test('approveWikiPolicy stores the returned record on ok:true', async () => {
    const record = { status: 'approved' as const, proposal: PROPOSAL, generatedAt: '2026-01-01T00:00:00.000Z', approvedAt: '2026-01-01T01:00:00.000Z', body: 'body text' }
    mockApi.harnessApprovePolicy.mockResolvedValue({ ok: true, record })
    await useStore.getState().approveWikiPolicy('p1')
    expect(useStore.getState().wikiPolicy).toEqual(record)
    expect(useStore.getState().wikiPolicyMessage).toContain('승인됨')
  })

  test('approveWikiPolicy stores a failure message on ok:false', async () => {
    mockApi.harnessApprovePolicy.mockResolvedValue({ ok: false, reason: 'no proposal found' })
    await useStore.getState().approveWikiPolicy('p1')
    expect(useStore.getState().wikiPolicyMessage).toContain('no proposal found')
  })

  test('loadWikiPolicy populates wikiPolicy from the api response', async () => {
    const record = { status: 'approved' as const, proposal: PROPOSAL, generatedAt: '2026-01-01T00:00:00.000Z', body: 'b' }
    mockApi.harnessGetPolicy.mockResolvedValue({ ok: true, record })
    await useStore.getState().loadWikiPolicy('p1')
    expect(useStore.getState().wikiPolicy).toEqual(record)
    expect(useStore.getState().wikiPolicyPreview).toBeNull()
  })

  test('loadWikiPolicy sets wikiPolicy to null when record is null', async () => {
    mockApi.harnessGetPolicy.mockResolvedValue({ ok: true, record: null })
    useStore.setState({ wikiPolicy: { status: 'proposed', proposal: PROPOSAL, generatedAt: '2026-01-01T00:00:00.000Z', body: '' } })
    await useStore.getState().loadWikiPolicy('p1')
    expect(useStore.getState().wikiPolicy).toBeNull()
  })

  test('revertWikiPolicy clears wikiPolicy and sets a revert message', async () => {
    mockApi.harnessRevertPolicy.mockResolvedValue({ ok: true })
    useStore.setState({ wikiPolicy: { status: 'approved', proposal: PROPOSAL, generatedAt: '2026-01-01T00:00:00.000Z', body: 'x' }, wikiPolicyPreview: 'p' })
    await useStore.getState().revertWikiPolicy('p1')
    expect(mockApi.harnessRevertPolicy).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(useStore.getState().wikiPolicy).toBeNull()
    expect(useStore.getState().wikiPolicyPreview).toBeNull()
    expect(useStore.getState().wikiPolicyMessage).toContain('기본 정책으로')
  })
})
