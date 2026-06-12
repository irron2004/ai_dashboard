import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { HarnessRunBundle } from '../harness-utils.js'
import { WikiGenDashboard } from './WikiGenDashboard.js'

vi.mock('../api.js', () => ({ api: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }))


function reviewRun(): HarnessRunBundle {
  return {
    runState: {
      runId: 'RUN-r', state: 'HUMAN_REVIEW_REQUIRED', engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-06-12T01:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [
      { state: 'VALIDATED', name: 'eval-report', path: '/runs/RUN-r/eval.json', data: { scores: [] } },
    ],
    mode: 'full-docs',
  }
}

describe('WikiGenDashboard', () => {
  beforeEach(() => {
    useStore.setState({
      selectedProjectId: 'p1', harnessRuns: [reviewRun()], selectedHarnessRunId: 'RUN-r',
      harnessLoading: false, harnessProgress: null, harnessCanonicalProposals: [],
      // Override hydrateHarnessProject to be a no-op so the useEffect doesn't reset test state.
      hydrateHarnessProject: () => {},
    })
  })

  test('renders 실행 이력 rail and review subtabs', () => {
    render(<WikiGenDashboard />)
    expect(screen.getByText('실행 이력')).toBeDefined()
    for (const label of ['요약', 'Coverage', 'Quality', 'Proposals', 'Flow']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
  })

  test('settings panel is hidden until ⚙ 버튼 click', () => {
    render(<WikiGenDashboard />)
    expect(screen.queryByText(/하니스 구조/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /에이전트 설정/ }))
    expect(screen.getByText(/하니스 구조/)).toBeDefined()
  })

  test('shows progress view instead of subtabs while running', () => {
    useStore.setState({ harnessLoading: true, harnessProgress: 'NODE_PROPOSALS_CREATED' })
    render(<WikiGenDashboard />)
    expect(screen.queryByRole('button', { name: 'Coverage' })).toBeNull()
  })

  test('promote button appears for HUMAN_REVIEW_REQUIRED run with canonical proposals', () => {
    useStore.setState({
      harnessCanonicalProposals: [{ proposalRelPath: 'staging/a.md', canonicalPath: 'wiki/a.md', currentHash: null }],
    })
    render(<WikiGenDashboard />)
    // Multiple Promote buttons may appear (run-level "Promote run" + per-proposal "Promote")
    const promoteButtons = screen.getAllByRole('button', { name: /Promote/ })
    expect(promoteButtons.length).toBeGreaterThan(0)
  })

  test('switching to a subtab with no data shows its placeholder', () => {
    render(<WikiGenDashboard />)
    fireEvent.click(screen.getByRole('button', { name: 'Coverage' }))
    expect(screen.getByText(/커버리지 데이터 없음/)).toBeDefined()
  })
})
