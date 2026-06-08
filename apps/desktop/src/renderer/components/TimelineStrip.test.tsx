import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Task } from '@apc/shared'
import { TimelineStrip, timelineAxis, datePct } from './TimelineStrip.js'

const t = (id: string, dueDate?: string): Task => ({
  id, projectId: 'p1', title: `task ${id}`, status: 'todo', assigneeType: 'agent',
  priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], dueDate,
})

describe('timelineAxis', () => {
  test('uses start and target when both present', () => {
    expect(timelineAxis('2026-06-01', '2026-06-11', [])).toEqual({
      min: Date.parse('2026-06-01'), max: Date.parse('2026-06-11'),
    })
  })

  test('falls back to min/max of dueDates when range is absent', () => {
    const axis = timelineAxis(undefined, undefined, ['2026-06-05', '2026-06-01', '2026-06-09'])
    expect(axis).toEqual({ min: Date.parse('2026-06-01'), max: Date.parse('2026-06-09') })
  })

  test('returns null when fewer than two distinct dates exist', () => {
    expect(timelineAxis(undefined, undefined, [])).toBeNull()
    expect(timelineAxis('2026-06-01', undefined, ['2026-06-01'])).toBeNull()
  })
})

describe('datePct', () => {
  test('maps a midpoint date to 50%', () => {
    const axis = { min: Date.parse('2026-06-01'), max: Date.parse('2026-06-11') }
    expect(datePct('2026-06-06', axis)).toBe(50)
  })

  test('clamps out-of-range dates to 0 and 100', () => {
    const axis = { min: Date.parse('2026-06-01'), max: Date.parse('2026-06-11') }
    expect(datePct('2026-05-01', axis)).toBe(0)
    expect(datePct('2026-07-01', axis)).toBe(100)
  })
})

describe('TimelineStrip', () => {
  test('renders a marker per task with a dueDate', () => {
    render(<TimelineStrip start="2026-06-01" target="2026-06-11" tasks={[t('A', '2026-06-06'), t('B')]} />)
    expect(screen.getByTitle('task A')).toBeDefined()
    expect(screen.queryByTitle('task B')).toBeNull() // no dueDate → no marker
  })

  test('shows an empty state when no axis can be derived', () => {
    render(<TimelineStrip start={undefined} target={undefined} tasks={[t('A')]} />)
    expect(screen.getByText('일정 정보 없음')).toBeDefined()
  })
})
