import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { QuestionLogEntry } from '@apc/shared'
import { QuestionHistory } from './QuestionHistory.js'

const rows: QuestionLogEntry[] = [
  { projectId: 'p1', sessionId: 's2', ts: '2026-07-07T14:20:00Z', agent: 'claude', text: 'capex 어떻게 읽지?' },
  { projectId: 'p2', sessionId: 's1', ts: '2026-07-07T11:05:00Z', agent: 'codex', text: '이 커리큘럼 순서 맞아?' },
]

describe('QuestionHistory', () => {
  test('lists fetched questions newest-first', async () => {
    const fetchLog = vi.fn(async () => rows)
    render(<QuestionHistory open scope={null} fetchLog={fetchLog} onClose={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(screen.getByText(/capex 어떻게 읽지/)).toBeTruthy())
    expect(screen.getByText(/이 커리큘럼 순서 맞아/)).toBeTruthy()
    expect(fetchLog).toHaveBeenCalledWith({})
  })

  test('scope filters by project', async () => {
    const fetchLog = vi.fn(async () => [rows[0]])
    render(<QuestionHistory open scope="p1" fetchLog={fetchLog} onClose={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(fetchLog).toHaveBeenCalledWith({ projectId: 'p1' }))
  })

  test('clicking a row fires onPick', async () => {
    const onPick = vi.fn()
    render(<QuestionHistory open scope={null} fetchLog={async () => rows} onClose={() => {}} onPick={onPick} />)
    await waitFor(() => screen.getByText(/capex 어떻게 읽지/))
    fireEvent.click(screen.getByText(/capex 어떻게 읽지/))
    expect(onPick).toHaveBeenCalledWith(rows[0])
  })
})
