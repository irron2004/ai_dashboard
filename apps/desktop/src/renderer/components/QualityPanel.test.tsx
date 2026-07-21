import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { KhEvalReport } from '@apc/shared'
import { QualityPanel } from './QualityPanel.js'

const data: KhEvalReport = {
  coverage: { raw_sources_total: 10, raw_sources_classified: 10, task_mapped_sources: 10, unmapped_sources: 0 },
  evidence_quality: { node_proposals_total: 5, proposals_without_evidence: 2, proposals_with_minimum_evidence: 3, inference_without_note: 0 },
  graph_quality: { orphan_nodes: 0, duplicate_candidates: 0, broken_links: 1, missing_backlinks: 0 },
  safety: { raw_modified: false, secret_warnings: 0, canonical_direct_overwrite_attempts: 0, delete_attempts: 0 },
  usefulness: { current_update_proposals: 1, next_task_candidates: 0, shared_promotion_candidates: 0 },
}

describe('QualityPanel', () => {
  test('renders metric values', () => {
    render(<QualityPanel data={data} />)
    expect(screen.getByTestId('q-node_proposals_total').textContent).toContain('5')
    expect(screen.getByTestId('q-broken_links').textContent).toContain('1')
    expect(screen.queryByTestId('q-next_task_candidates')).toBeNull()
  })

  test('flags problem metrics with the warn class', () => {
    render(<QualityPanel data={data} />)
    // proposals_without_evidence = 2 (>0) → warn
    expect(screen.getByTestId('q-proposals_without_evidence').className).toContain('quality__row--warn')
    // broken_links = 1 (>0) → warn
    expect(screen.getByTestId('q-broken_links').className).toContain('quality__row--warn')
    // inference_without_note = 0 → NOT warn
    expect(screen.getByTestId('q-inference_without_note').className).not.toContain('quality__row--warn')
  })

  test('flags raw_modified=true as a safety warning', () => {
    const breached: KhEvalReport = { ...data, safety: { ...data.safety, raw_modified: true } }
    render(<QualityPanel data={breached} />)
    expect(screen.getByTestId('q-raw_modified').className).toContain('quality__row--warn')
    expect(screen.getByTestId('q-raw_modified').textContent).toContain('YES')
  })
})
