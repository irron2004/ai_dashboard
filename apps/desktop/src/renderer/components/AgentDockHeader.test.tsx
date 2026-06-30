import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentDockHeader } from './AgentDockHeader.js'

function setup(status: 'idle' | 'running' | 'attention' | 'done' = 'idle') {
  const onStart = vi.fn(), onStop = vi.fn(), onSelect = vi.fn()
  render(
    <AgentDockHeader agent="claude" status={status} selected={false} shortcut={1}
      statusColor="#888" onStart={onStart} onStop={onStop} onSelect={onSelect} />,
  )
  return { onStart, onStop, onSelect }
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
})
