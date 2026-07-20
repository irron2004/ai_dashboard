import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProjectContextFields, projectContextProvenanceLabel } from './ProjectContextFields.js'

describe('projectContextProvenanceLabel', () => {
  test('distinguishes user, agent proposal, and confirmed proposal', () => {
    expect(projectContextProvenanceLabel('user', '2026-07-20')).toBe('사용자 작성')
    expect(projectContextProvenanceLabel('agent', undefined)).toBe('AI 제안')
    expect(projectContextProvenanceLabel('agent', '2026-07-20')).toBe('AI 제안 · 사용자 확정')
    expect(projectContextProvenanceLabel(undefined, undefined)).toBeNull()
  })
})

describe('ProjectContextFields', () => {
  test('edits both values and confirms only an unconfirmed agent proposal', () => {
    const onGoalChange = vi.fn()
    const onCurrentFocusChange = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ProjectContextFields
        goal="Agent goal"
        currentFocus="User focus"
        goalSource="agent"
        currentFocusSource="user"
        currentFocusConfirmedAt="2026-07-20T00:00:00Z"
        onGoalChange={onGoalChange}
        onCurrentFocusChange={onCurrentFocusChange}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.change(screen.getByLabelText('프로젝트 목표'), { target: { value: 'Changed goal' } })
    fireEvent.change(screen.getByLabelText('현재 집중 항목'), { target: { value: 'Changed focus' } })
    fireEvent.click(screen.getByLabelText('목표 AI 제안 확정'))
    expect(onGoalChange).toHaveBeenCalledWith('Changed goal')
    expect(onCurrentFocusChange).toHaveBeenCalledWith('Changed focus')
    expect(onConfirm).toHaveBeenCalledWith('goal')
    expect(screen.queryByLabelText('현재 집중 항목 AI 제안 확정')).toBeNull()
  })

  test('disables inputs and confirmation during a save', () => {
    render(
      <ProjectContextFields
        goal="Agent goal"
        currentFocus=""
        goalSource="agent"
        disabled
        confirmingField="goal"
        onGoalChange={() => {}}
        onCurrentFocusChange={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect((screen.getByLabelText('프로젝트 목표') as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getByLabelText('목표 AI 제안 확정') as HTMLButtonElement).disabled).toBe(true)
  })
})

