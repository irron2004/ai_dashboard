import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { HarnessRunBundle } from '../harness-utils.js'
import { HarnessRunList } from './HarnessRunList.js'

function bundle(runId: string, state: string, mode?: 'full-docs' | 'recent-sessions'): HarnessRunBundle {
  return {
    runState: {
      runId, state, engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-06-12T01:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [],
    mode,
  }
}

const baseProps = {
  selectedRunId: null, loading: false, collapsed: false,
  onToggleCollapse: vi.fn(), onSelectRun: vi.fn(), onRefresh: vi.fn(),
}

describe('HarnessRunList (실행 이력)', () => {
  test('header reads 실행 이력 and has a single ▶ 위키 생성 dropdown button', () => {
    render(<HarnessRunList {...baseProps} runs={[]} onStartRun={vi.fn()} onResumeRun={vi.fn()} />)
    expect(screen.getByText('실행 이력')).toBeDefined()
    expect(screen.getByRole('button', { name: /위키 생성/ })).toBeDefined()
  })

  test('dropdown offers 전체 문서 / 최근 세션 and fires onStartRun with materialize flag', () => {
    const onStartRun = vi.fn()
    render(<HarnessRunList {...baseProps} runs={[]} onStartRun={onStartRun} onResumeRun={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /위키 생성/ }))
    fireEvent.click(screen.getByText('전체 문서'))
    expect(onStartRun).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /위키 생성/ }))
    fireEvent.click(screen.getByText(/최근 세션/))
    expect(onStartRun).toHaveBeenCalledWith(false)
  })

  test('이어하기 shows only on resumable runs and fires onResumeRun', () => {
    const onResumeRun = vi.fn()
    render(
      <HarnessRunList
        {...baseProps}
        runs={[bundle('RUN-fail', 'FAILED'), bundle('RUN-review', 'HUMAN_REVIEW_REQUIRED')]}
        onStartRun={vi.fn()}
        onResumeRun={onResumeRun}
      />,
    )
    const resumeButtons = screen.getAllByRole('button', { name: /이어하기/ })
    expect(resumeButtons).toHaveLength(1)
    fireEvent.click(resumeButtons[0])
    expect(onResumeRun).toHaveBeenCalledWith('RUN-fail')
  })

  test('card shows mode label when bundle has mode', () => {
    render(<HarnessRunList {...baseProps} runs={[bundle('RUN-1', 'MERGED', 'full-docs')]} onStartRun={vi.fn()} onResumeRun={vi.fn()} />)
    expect(screen.getByText(/전체 문서/)).toBeDefined()
  })
})
