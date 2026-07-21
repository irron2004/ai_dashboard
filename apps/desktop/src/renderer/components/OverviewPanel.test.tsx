import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { HarnessRunBundle } from '../harness-utils.js'
import { OverviewPanel } from './OverviewPanel.js'

function run(state = 'HUMAN_REVIEW_REQUIRED'): HarnessRunBundle {
  return {
    runState: {
      runId: 'RUN-r',
      state,
      engine: 'codex',
      projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-07-21T00:00:00Z' }],
      artifacts: {},
    } as HarnessRunBundle['runState'],
    artifacts: [],
  }
}

describe('OverviewPanel', () => {
  test('headline chips navigate to review with the matching filter', () => {
    const onGoToReview = vi.fn()
    render(
      <OverviewPanel
        run={run()}
        proposalsCount={5}
        approvedCount={2}
        excludedCount={1}
        warningCount={3}
        fanout={null}
        onGoToReview={onGoToReview}
        onOpenSource={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /미결 2/ }))
    expect(onGoToReview).toHaveBeenCalledWith('pending')
    fireEvent.click(screen.getByRole('button', { name: /승인 2/ }))
    expect(onGoToReview).toHaveBeenCalledWith('approved')
    fireEvent.click(screen.getByRole('button', { name: /경고 3/ }))
    expect(onGoToReview).toHaveBeenCalledWith('flagged')
  })

  test('shows the coverage placeholder and wires real source buttons when data exists', () => {
    const onOpenSource = vi.fn()
    const common = {
      run: run(), proposalsCount: 0, approvedCount: 0, excludedCount: 0,
      warningCount: 0, fanout: null, onGoToReview: () => {}, onOpenSource,
    }
    const { rerender } = render(<OverviewPanel {...common} />)
    expect(screen.getByText(/커버리지 데이터 없음/)).toBeDefined()
    rerender(
      <OverviewPanel
        {...common}
        coverage={{
          sources: [{ path: 'raw/a', status: 'unmapped', citedBy: [] }],
          nodes: [],
          totals: { sourcesTotal: 1, covered: 0, unmapped: 1 },
        }}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /raw\/a/ })[0])
    expect(onOpenSource).toHaveBeenCalledWith('raw/a')
  })

  test('shows the persisted failure reason for a failed run', () => {
    const failed = run('FAILED')
    failed.runState.error = 'boom'
    render(
      <OverviewPanel
        run={failed}
        proposalsCount={0}
        approvedCount={0}
        excludedCount={0}
        warningCount={0}
        fanout={null}
        onGoToReview={() => {}}
        onOpenSource={() => {}}
      />,
    )
    expect(screen.getByText(/boom/)).toBeDefined()
  })
})
