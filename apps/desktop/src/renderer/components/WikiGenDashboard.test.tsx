import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { HarnessRunBundle } from '../harness-utils.js'
import { WikiGenDashboard } from './WikiGenDashboard.js'

vi.mock('../api.js', () => ({ api: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }))


function reviewRun(): HarnessRunBundle {
  return {
    runState: {
      runId: 'RUN-r', state: 'HUMAN_REVIEW_REQUIRED', engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-06-12T01:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [
      { state: 'VALIDATED', name: 'eval-report', path: '/runs/RUN-r/eval.json', data: { scores: [] } },
    ],
    mode: 'full-docs',
  }
}

describe('WikiGenDashboard', () => {
  beforeEach(() => {
    useStore.setState({
      selectedProjectId: 'p1', harnessRuns: [reviewRun()], selectedHarnessRunId: 'RUN-r',
      harnessLoading: false, harnessProgress: null, harnessCanonicalProposals: [],
      // Override the project-change effects to no-ops so their async set(...) doesn't fire outside act().
      hydrateHarnessProject: () => {},
      loadWikiPolicy: async () => {},
    })
  })

  test('renders 실행 이력 rail and review subtabs', () => {
    render(<WikiGenDashboard />)
    expect(screen.getByText('실행 이력')).toBeDefined()
    for (const label of ['요약', 'Coverage', 'Quality', 'Proposals', 'Flow']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
  })

  test('settings panel is hidden until ⚙ 버튼 click', () => {
    render(<WikiGenDashboard />)
    expect(screen.queryByText(/하니스 구조/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /에이전트 설정/ }))
    expect(screen.getByText(/하니스 구조/)).toBeDefined()
  })

  test('shows progress view instead of subtabs while running', () => {
    useStore.setState({ harnessLoading: true, harnessProgress: 'NODE_PROPOSALS_CREATED' })
    render(<WikiGenDashboard />)
    expect(screen.queryByRole('button', { name: 'Coverage' })).toBeNull()
  })

  test('promote button appears for HUMAN_REVIEW_REQUIRED run with canonical proposals', () => {
    useStore.setState({
      harnessCanonicalProposals: [{ proposalRelPath: 'staging/a.md', canonicalPath: 'wiki/a.md', currentHash: null }],
    })
    render(<WikiGenDashboard />)
    // Multiple Promote buttons may appear (run-level "Promote run" + per-proposal "Promote")
    const promoteButtons = screen.getAllByRole('button', { name: /Promote/ })
    expect(promoteButtons.length).toBeGreaterThan(0)
  })

  test('switching to a subtab with no data shows its placeholder', () => {
    render(<WikiGenDashboard />)
    fireEvent.click(screen.getByRole('button', { name: 'Coverage' }))
    expect(screen.getByText(/커버리지 데이터 없음/)).toBeDefined()
  })

  test('위키 생성 전에 프로젝트 성격을 묻고 힌트를 run에 전달한다', () => {
    const startHarnessRun = vi.fn(async () => {})
    useStore.setState({ startHarnessRun })
    render(<WikiGenDashboard />)

    fireEvent.click(screen.getByRole('button', { name: /위키 생성/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /전체 문서/ }))
    expect(screen.getByRole('dialog', { name: '위키 생성 전 구조 설정' })).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText(/고객용 웹 앱/), { target: { value: '개발 문서와 작업 기록이 함께 있는 프로젝트' } })
    fireEvent.click(screen.getByRole('button', { name: '이 설정으로 위키 생성' }))

    expect(startHarnessRun).toHaveBeenCalledWith(true, undefined, false, {
      projectCharacter: '개발 문서와 작업 기록이 함께 있는 프로젝트',
      folderClassifications: [],
    })
  })

  test('구조 탭에서 project-discovery 결과를 시각화한다', () => {
    const run = reviewRun()
    run.artifacts.push(
      { state: 'PROJECT_SCANNED', name: 'project-discovery-report', path: 'a', data: { project_id: 'p1', summary: '모노레포', topics: ['desktop'] } },
      { state: 'DOCUMENTS_CLASSIFIED', name: 'folder-plan', path: 'b', data: { units: [{ id: 'u1', label: 'docs', memberPaths: ['docs'], role: 'reference', docSourceIds: ['raw/project-docs/0/docs/a.md'], folderClassifications: [{ path: 'docs', description: '문서', source: 'user' }] }], projectContext: { projectCharacter: '제품 개발 프로젝트' } } },
    )
    useStore.setState({ harnessRuns: [run] })
    render(<WikiGenDashboard />)
    fireEvent.click(screen.getByRole('button', { name: '구조' }))

    expect(screen.getByText('제품 개발 프로젝트')).toBeDefined()
    expect(screen.getByText('docs')).toBeDefined()
    expect(screen.getByText('문서')).toBeDefined()
  })
})
