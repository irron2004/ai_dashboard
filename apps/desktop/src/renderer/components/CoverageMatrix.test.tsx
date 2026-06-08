import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { KhCoverageReport } from '@apc/shared'
import { CoverageMatrix } from './CoverageMatrix.js'

const data: KhCoverageReport = {
  sources: [
    { path: 'raw/project-docs/0/PRD.md', status: 'covered', citedBy: ['n1'] },
    { path: 'raw/project-docs/0/notes.md', status: 'unmapped', citedBy: [] },
  ],
  nodes: [{ id: 'n1', title: 'Architecture', cites: ['raw/project-docs/0/PRD.md'] }],
  totals: { sourcesTotal: 2, covered: 1, unmapped: 1 },
}

describe('CoverageMatrix', () => {
  test('shows the covered/unmapped summary', () => {
    render(<CoverageMatrix data={data} />)
    expect(screen.getByTestId('coverage-summary').textContent).toContain('1/2')
    expect(screen.getByTestId('coverage-summary').textContent).toContain('1 누락')
  })

  test('lists unmapped sources and calls onOpenSource when clicked', () => {
    const onOpen = vi.fn()
    render(<CoverageMatrix data={data} onOpenSource={onOpen} />)
    const unmapped = screen.getByTestId('coverage-unmapped')
    fireEvent.click(within(unmapped).getByText('raw/project-docs/0/notes.md'))
    expect(onOpen).toHaveBeenCalledWith('raw/project-docs/0/notes.md')
  })

  test('shows an all-covered empty state when nothing is unmapped', () => {
    const allCovered: KhCoverageReport = {
      sources: [{ path: 'raw/a.md', status: 'covered', citedBy: ['n1'] }],
      nodes: [{ id: 'n1', title: 'A', cites: ['raw/a.md'] }],
      totals: { sourcesTotal: 1, covered: 1, unmapped: 0 },
    }
    render(<CoverageMatrix data={allCovered} />)
    expect(screen.getByText('누락 없음 — 전 문서 반영됨')).toBeDefined()
  })
})
