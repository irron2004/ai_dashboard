import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { KhNodeProposal } from '@apc/shared'
import { ReviewPanel } from './ReviewPanel.js'

const apiMock = vi.hoisted(() => ({
  harnessReadStagedDoc: vi.fn(async () => ({ ok: true as const, content: '# Generated draft\n\nstaged body' })),
  harnessReadSourceExcerpt: vi.fn(async () => ({
    ok: true as const,
    matched: true,
    excerpt: 'actual context before\nactual source sentence\nactual context after',
    line: 12,
  })),
  harnessOpenSourceFile: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('../api.js', () => ({ api: apiMock }))

function proposal(id: string, title: string, sourcePath: string): KhNodeProposal {
  return {
    proposal_id: `NP-${id}`,
    proposal_type: 'create_or_update_node',
    proposed_by: 'extractor',
    source_type: 'agent_session',
    created_at: '2026-07-21T00:00:00Z',
    node: {
      id,
      type: 'ConceptNode',
      scope: 'project',
      title,
      summary: `${title} AI summary`,
      project_ids: [],
      tags: [],
    },
    claims: [{
      claim_id: `CL-${id}`,
      text: `${title} AI claim`,
      claim_type: 'observation',
      confidence: 'medium',
      inference: false,
      evidence_ids: [`EV-${id}`],
    }],
    evidence: [{
      evidence_id: `EV-${id}`,
      source_id: sourcePath,
      source_path: sourcePath,
      evidence_type: 'quote',
      quote_or_summary: 'AI supplied summary, not the raw excerpt',
      confidence: 'medium',
    }],
    claim_policy: {
      minimum_evidence_count: 1,
      requires_direct_source: true,
      allow_inference: true,
      inference_note_required: true,
    },
    actions: [],
    risk: { level: 'low', reason: 'extractor assessment' },
    review: { requires_human_review: false, reviewer_question: '' },
  } as KhNodeProposal
}

const DIFF = [
  'diff --git a/nodes/n1.md b/nodes/n1.md',
  '--- a/nodes/n1.md',
  '+++ b/nodes/n1.md',
  '@@ -1,2 +1,2 @@',
  ' # Alpha',
  '-old line',
  '+new line',
  '',
].join('\n')

function renderPanel(overrides: Partial<Parameters<typeof ReviewPanel>[0]> = {}) {
  const onVerdict = vi.fn()
  render(
    <ReviewPanel
      runId="RUN-r"
      projectId="p1"
      proposals={[
        proposal('n1', 'Alpha', 'raw/a'),
        proposal('n2', 'Beta', 'raw/b'),
      ]}
      warnings={[]}
      unverifiable={[]}
      violations={[]}
      diffPatch={DIFF}
      decisions={{}}
      onVerdict={onVerdict}
      {...overrides}
    />,
  )
  return { onVerdict }
}

describe('ReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Most interaction tests are synchronous; keep background reads pending so they do not update a
    // component after the assertion has completed. The source/result test opts into resolved reads.
    apiMock.harnessReadStagedDoc.mockImplementation(() => new Promise<never>(() => {}))
    apiMock.harnessReadSourceExcerpt.mockImplementation(() => new Promise<never>(() => {}))
    apiMock.harnessOpenSourceFile.mockResolvedValue({ ok: true })
  })

  test('separates raw source, AI interpretation, and staged result', async () => {
    apiMock.harnessReadStagedDoc.mockResolvedValue({ ok: true, content: '# Generated draft\n\nstaged body' })
    apiMock.harnessReadSourceExcerpt.mockResolvedValue({
      ok: true,
      matched: true,
      excerpt: 'actual context before\nactual source sentence\nactual context after',
      line: 12,
    })
    renderPanel()
    const source = screen.getByTestId('review-source')
    const ai = screen.getByTestId('review-ai')
    const result = screen.getByTestId('review-result')
    expect(within(source).getByText('📄 원본')).toBeDefined()
    expect(within(ai).getByText('🤖 AI 해석')).toBeDefined()
    expect(within(result).getByText('📝 반영 결과')).toBeDefined()

    await waitFor(() => expect(apiMock.harnessReadSourceExcerpt).toHaveBeenCalledWith({
      runId: 'RUN-r', sourcePath: 'raw/a', quote: 'AI supplied summary, not the raw excerpt',
    }))
    expect(await within(source).findByText(/actual context before/)).toBeDefined()
    expect(within(source).queryByText('AI supplied summary, not the raw excerpt')).toBeNull()
    expect(within(ai).getByText('AI supplied summary, not the raw excerpt')).toBeDefined()
    expect(within(source).getByText('✓ 원문 일치')).toBeDefined()
    expect(within(result).getByText('Generated draft')).toBeDefined()
  })

  test('labels verifier warnings as a possible AI summary', () => {
    renderPanel({
      warnings: [{
        proposal_id: 'NP-n1', evidence_id: 'EV-n1', source_path: 'raw/a', reason: 'quote_not_found',
      }],
    })
    expect(screen.getByText('⚠ AI 요약일 수 있음')).toBeDefined()
  })

  test('shows an explicit failure badge when the cited original is unverifiable', () => {
    renderPanel({
      unverifiable: [{
        proposal_id: 'NP-n1', evidence_id: 'EV-n1', source_path: 'raw/a', reason: 'source_not_found',
      }],
    })
    expect(screen.getByText('⛔ 원본 확인 불가')).toBeDefined()
  })

  test('opens a raw source through the validated native IPC', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'raw/a' }))
    expect(apiMock.harnessOpenSourceFile).toHaveBeenCalledWith({ runId: 'RUN-r', sourcePath: 'raw/a' })
  })

  test('approve and exclude report verdicts, and re-clicking the active verdict clears it', () => {
    const { onVerdict } = renderPanel({ decisions: { 'NP-n1': 'approved' } })
    const verdictBar = screen.getByTestId('review-verdict-bar')
    fireEvent.click(within(verdictBar).getByRole('button', { name: '✗ 제외' }))
    expect(onVerdict).toHaveBeenCalledWith(['NP-n1'], 'excluded')
    fireEvent.click(within(verdictBar).getByRole('button', { name: '✓ 승인' }))
    expect(onVerdict).toHaveBeenCalledWith(['NP-n1'], null)
  })

  test('filters the list and bulk actions apply only to visible proposals', () => {
    const { onVerdict } = renderPanel({ decisions: { 'NP-n1': 'approved' } })
    fireEvent.click(screen.getByRole('button', { name: '미결' }))
    expect(screen.queryByRole('button', { name: /Alpha/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Beta/ })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '표시된 항목 모두 승인' }))
    expect(onVerdict).toHaveBeenCalledWith(['NP-n2'], 'approved')
    fireEvent.click(screen.getByRole('button', { name: '모두 제외' }))
    expect(onVerdict).toHaveBeenCalledWith(['NP-n2'], 'excluded')
  })

  test('renders before and after lines for the selected node diff', () => {
    renderPanel()
    expect(screen.getByText('old line')).toBeDefined()
    expect(screen.getByText('new line')).toBeDefined()
  })

  test('shows verdict badges in the proposal list', () => {
    renderPanel({ decisions: { 'NP-n1': 'approved', 'NP-n2': 'excluded' } })
    const list = screen.getByTestId('review-list')
    expect(within(list).getByText('✓ 승인')).toBeDefined()
    expect(within(list).getByText('✗ 제외')).toBeDefined()
  })
})
