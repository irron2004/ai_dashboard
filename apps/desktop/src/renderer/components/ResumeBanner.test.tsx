import { describe, expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ResumeCard } from '@apc/dashboard-api'
import { ResumeBanner } from './ResumeBanner.js'

const card: ResumeCard = {
  project: { id: 'p1', name: 'coin', repoPaths: ['/w'] } as never,
  lastSummary: 'capex를 bear 카드로 정리',
  lastQuestion: { text: 'MA20 회복 조건?', ts: '2026-07-07T10:00:00Z', agent: 'claude' },
  nextNotes: [{ id: 'n1', projectId: 'p1', text: '7/10 상장 반영', createdAt: '2026-07-07T00:00:00Z', done: false }],
  resumeTarget: { agent: 'claude', sessionId: 's1' },
  hasHistory: true,
}

describe('ResumeBanner', () => {
  test('renders summary, question, and note when open', () => {
    render(<ResumeBanner card={card} onDismiss={() => {}} onResume={() => {}} onOpenHistory={() => {}} onAddNote={() => {}} />)
    expect(screen.getByText(/capex를 bear 카드로 정리/)).toBeTruthy()
    expect(screen.getByText(/MA20 회복 조건/)).toBeTruthy()
    expect(screen.getByText(/7\/10 상장 반영/)).toBeTruthy()
  })

  test('resume button fires onResume with the resume target', () => {
    const onResume = vi.fn()
    render(<ResumeBanner card={card} onDismiss={() => {}} onResume={onResume} onOpenHistory={() => {}} onAddNote={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /이어서 대화/ }))
    expect(onResume).toHaveBeenCalledWith({ agent: 'claude', sessionId: 's1' })
  })

  test('adding a note fires onAddNote with the typed text', async () => {
    const onAddNote = vi.fn()
    render(<ResumeBanner card={card} onDismiss={() => {}} onResume={() => {}} onOpenHistory={() => {}} onAddNote={onAddNote} />)
    fireEvent.change(screen.getByPlaceholderText(/다음 할 일/), { target: { value: 'bear 2차 검증' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/다음 할 일/), { key: 'Enter' })
    await waitFor(() => expect(onAddNote).toHaveBeenCalledWith('bear 2차 검증'))
  })
})
