import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const SHA = 'c'.repeat(40)
const targetQuestions = [
  '이번 변경으로 이전 동작이 어떻게 달라졌는가?',
  '가장 중요한 실행 흐름을 시작점부터 결과까지 설명해보라.',
  '가장 깨지기 쉬운 지점과 이를 발견할 로그·증상은 무엇인가?',
  '어떤 테스트나 실행 결과가 결론을 뒷받침하는가?',
  'agent가 내린 결론 중 직접 확인한 것과 아직 가정인 것은 무엇인가?',
]

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  retroPrepare: vi.fn(),
  retroAnswer: vi.fn(),
  retroTargetNotes: vi.fn(),
  receiptIssue: vi.fn(),
  retroComplete: vi.fn(),
  nextNoteAdd: vi.fn(),
}))

vi.mock('../api.js', () => ({ api: mocks }))

import { useStore } from '../store.js'
import { RetroView } from './RetroView.js'

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState({ activeWorktrees: { p1: '/work/project-one' } })
  mocks.listProjects.mockResolvedValue([{
    id: 'p1', name: '프로젝트1', status: 'active', projectType: 'git', domain: 'project-docs',
    repoPaths: ['/repo/project-one'], vaultPaths: [], sourcePaths: [],
  }])
  mocks.retroPrepare.mockResolvedValue({
    ok: true,
    retro: { id: 'retro:2026-07-20', date: '2026-07-20', startedAt: '2026-07-20T09:00:00Z' },
    questions: [
      ...targetQuestions.map((text, index) => ({
        id: `rq:${index}`, retroId: 'retro:2026-07-20', targetId: 'target:p1', projectId: 'p1',
        kind: 'template', critical: true, text, skipped: false,
      })),
      { id: 'rq:closing:0', retroId: 'retro:2026-07-20', kind: 'closing', critical: false, text: '오늘 배운 것 1가지는?', skipped: false },
      { id: 'rq:closing:1', retroId: 'retro:2026-07-20', kind: 'closing', critical: false, text: '내일 더 깊게 파 것 1가지는?', skipped: false },
    ],
    projects: [{
      projectId: 'p1', name: '프로젝트1', repoPath: '/work/project-one', branch: 'main',
      target: {
        id: 'target:p1', retroId: 'retro:2026-07-20', projectId: 'p1', repoPath: '/work/project-one',
        branch: 'main', preparedHeadSha: SHA, preparedAt: '2026-07-20T09:00:00Z',
      },
      headCovered: false, gateEnabled: true, hookInstalled: true, lastReceiptSha: null,
      commits: [{ sha: SHA, when: '2026-07-20T10:00:00+09:00', subject: 'feat: 큐 재시도' }],
      workingTreeFiles: 0, changedFiles: 2, additions: 15, deletions: 3, resetByHeadDrift: false,
    }],
    skips: [], problems: [],
  })
  mocks.retroAnswer.mockResolvedValue({ ok: true })
  mocks.retroTargetNotes.mockResolvedValue({ ok: true })
  mocks.receiptIssue.mockResolvedValue({
    ok: true,
    receipt: {
      id: 'receipt:1', projectId: 'p1', repoPath: '/work/project-one', branch: 'main', reviewedHeadSha: SHA,
      retroId: 'retro:2026-07-20', targetId: 'target:p1', answeredQuestionIds: targetQuestions.map((_, i) => `rq:${i}`),
      evidenceRefs: ['pnpm test 통과'], answerSnapshotHash: 'a'.repeat(64), issuedAt: '2026-07-20T21:00:00Z',
    },
  })
  mocks.retroComplete.mockResolvedValue({ ok: true })
  mocks.nextNoteAdd.mockResolvedValue({ ok: true })
})

describe('RetroView', () => {
  test('변경 증거와 의미를 보여주고, target의 질문·검증 근거를 저장한 뒤 Receipt를 발급한다', async () => {
    render(<RetroView />)

    expect(await screen.findByText('프로젝트1')).toBeDefined()
    expect(screen.getByText(/Push 전에 내가 변경을 이해했는지/)).toBeDefined()
    expect(screen.getByText('feat: 큐 재시도')).toBeDefined()
    expect(mocks.retroPrepare).toHaveBeenCalledWith(expect.objectContaining({
      targets: [{ projectId: 'p1', worktreePath: '/work/project-one' }],
    }))

    const project = screen.getByRole('article', { name: '프로젝트1 회고' })
    const receiptButton = within(project).getByRole('button', { name: /Receipt 발급/ })
    expect((receiptButton as HTMLButtonElement).disabled).toBe(true)

    for (const [index, question] of targetQuestions.entries()) {
      fireEvent.change(within(project).getByLabelText(question), { target: { value: `답변 ${index + 1}` } })
    }
    fireEvent.change(within(project).getByLabelText('직접 확인한 검증 근거'), { target: { value: 'pnpm test 통과' } })
    fireEvent.change(within(project).getByLabelText('위험·아직 확인하지 못한 것'), { target: { value: '없음' } })

    expect((receiptButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(receiptButton)

    await waitFor(() => expect(mocks.retroTargetNotes).toHaveBeenCalledWith({
      targetId: 'target:p1', verificationEvidence: 'pnpm test 통과', riskNotes: '없음',
    }))
    expect(mocks.receiptIssue).toHaveBeenCalledWith({ targetId: 'target:p1' })
    expect(await within(project).findByText(/Receipt 발급 완료/)).toBeDefined()
  })

  test('해당 target의 critical 질문·검증 근거·위험 메모가 모두 있어야 Receipt 버튼을 연다', async () => {
    render(<RetroView />)
    const project = await screen.findByRole('article', { name: '프로젝트1 회고' })
    const receiptButton = within(project).getByRole('button', { name: /Receipt 발급/ })

    for (const [index, question] of targetQuestions.entries()) {
      fireEvent.change(within(project).getByLabelText(question), { target: { value: `답변 ${index + 1}` } })
    }
    expect((receiptButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(project).getByLabelText('직접 확인한 검증 근거'), { target: { value: 'test result' } })
    expect((receiptButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(project).getByLabelText('위험·아직 확인하지 못한 것'), { target: { value: '없음' } })
    expect((receiptButton as HTMLButtonElement).disabled).toBe(false)
  })
})
