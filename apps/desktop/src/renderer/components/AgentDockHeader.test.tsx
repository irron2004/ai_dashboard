import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { AgentQuestionSummary } from '@apc/shared'
import { AgentDockHeader } from './AgentDockHeader.js'

function question(privacy: AgentQuestionSummary['privacy'], displayText: string): AgentQuestionSummary {
  return { displayText, privacy, askedAt: '2026-07-20T10:00:00Z', source: 'pty' }
}

function setup(
  status: 'idle' | 'running' | 'attention' | 'done' = 'idle',
  removable = false,
  recentQuestion?: AgentQuestionSummary,
) {
  const onStart = vi.fn(), onStop = vi.fn(), onSelect = vi.fn(), onRemove = vi.fn()
  const rendered = render(
    <AgentDockHeader agent="claude" status={status} selected={false} shortcut={1}
      statusColor="#888" onStart={onStart} onStop={onStop} onSelect={onSelect}
      question={recentQuestion} onRemove={removable ? onRemove : undefined} />,
  )
  return { ...rendered, onStart, onStop, onSelect, onRemove }
}

describe('AgentDockHeader', () => {
  it('renders start/stop icon buttons and the agent name', () => {
    setup()
    expect(screen.getByLabelText('에이전트 시작/재시작')).toBeDefined()
    expect(screen.getByLabelText('에이전트 중지')).toBeDefined()
    expect(screen.getByText('claude')).toBeDefined()
  })

  it('start click calls onStart and does not bubble to onSelect', () => {
    const { onStart, onSelect } = setup('idle')
    fireEvent.click(screen.getByLabelText('에이전트 시작/재시작'))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('stop is disabled when idle, enabled+calls onStop when running', () => {
    setup('idle')
    expect((screen.getByLabelText('에이전트 중지') as HTMLButtonElement).disabled).toBe(true)
  })

  it('stop click calls onStop when running', () => {
    const { onStop } = setup('running')
    const stop = screen.getByLabelText('에이전트 중지') as HTMLButtonElement
    expect(stop.disabled).toBe(false)
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('stop is disabled when done', () => {
    setup('done')
    expect((screen.getByLabelText('에이전트 중지') as HTMLButtonElement).disabled).toBe(true)
  })

  it('remove click is available for dynamic slots and does not select the pane', () => {
    const { onRemove, onSelect } = setup('idle', true)
    fireEvent.click(screen.getByRole('button', { name: 'claude 에이전트 제거' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps the existing title when there is no recent question', () => {
    const { container } = setup()
    expect(container.querySelector('.agent-dock-header__question')).toBeNull()
    expect(screen.getByText('claude')).toBeDefined()
  })

  it('shows a visible sanitized question with ellipsis styling and full safe detail', () => {
    const longQuestion = '이 문장이 아주 길어져도 헤더 너비를 밀어내지 않고 말줄임표로 표시되어야 해'.repeat(3)
    const { container } = setup('idle', false, question('visible', longQuestion))
    const title = container.querySelector('.agent-dock-header__question') as HTMLElement
    expect(title.textContent).toBe(`[${longQuestion}]`)
    expect(title.title).toBe(longQuestion)
    expect(title.classList.contains('agent-dock-header__question')).toBe(true)
  })

  it('ignores displayText for a masked question so raw text cannot enter the DOM', () => {
    const raw = 'sk-raw-secret-that-must-not-render'
    const { container } = setup('idle', false, question('masked', raw))
    expect(screen.getByText('[민감한 질문]')).toBeDefined()
    expect(container.innerHTML).not.toContain(raw)
  })

  it('renders only a generic marker for a hidden question', () => {
    const raw = '숨겨진 원문'
    const { container } = setup('idle', false, question('hidden', raw))
    expect(screen.getByText('[질문 숨김]')).toBeDefined()
    expect(container.innerHTML).not.toContain(raw)
  })
})
