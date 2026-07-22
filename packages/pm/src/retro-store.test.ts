import { beforeEach, describe, expect, test } from 'vitest'
import { migrate, openDb, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { RetroStore } from './retro-store.js'

const TARGET_QUESTIONS = [
  { text: '무엇이 달라졌는가?', critical: true },
  { text: '어떻게 검증했는가?', critical: true },
]
const CLOSING_QUESTIONS = [
  { text: '오늘 배운 것은?', critical: false },
  { text: '내일 깊게 팔 것은?', critical: false },
]

describe('RetroStore', () => {
  let db: Db
  let store: RetroStore

  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    migratePm(db)
    store = new RetroStore(db)
  })

  test('opens one retro per date and keeps target questions scoped by target', () => {
    const retro = store.openForDate('2026-07-20', '2026-07-20T09:00:00Z')
    expect(store.openForDate('2026-07-20').id).toBe(retro.id)
    const first = store.prepareTarget({
      retroId: retro.id, projectId: 'p1', repoPath: '/r1', branch: 'main',
      preparedHeadSha: 'a'.repeat(40), preparedAt: '2026-07-20T09:01:00Z',
    }).target
    const second = store.prepareTarget({
      retroId: retro.id, projectId: 'p2', repoPath: '/r2', branch: 'main',
      preparedHeadSha: 'b'.repeat(40), preparedAt: '2026-07-20T09:02:00Z',
    }).target

    store.seedTargetQuestions(first, TARGET_QUESTIONS)
    store.seedTargetQuestions(second, TARGET_QUESTIONS)
    store.seedClosingQuestions(retro.id, CLOSING_QUESTIONS)

    expect(store.listQuestions(retro.id).filter((question) => question.targetId === first.id)).toHaveLength(2)
    expect(store.listQuestions(retro.id).filter((question) => question.targetId === second.id)).toHaveLength(2)
    expect(store.listQuestions(retro.id).filter((question) => !question.targetId)).toHaveLength(2)
  })

  test('HEAD drift resets only that target review evidence and answers', () => {
    const retro = store.openForDate('2026-07-20')
    const created = store.prepareTarget({
      retroId: retro.id, projectId: 'p1', repoPath: '/r1', branch: 'main',
      preparedHeadSha: 'a'.repeat(40), preparedAt: '2026-07-20T09:01:00Z',
    })
    const [question] = store.seedTargetQuestions(created.target, TARGET_QUESTIONS)
    store.answer(question.id, '답변', false, '2026-07-20T10:00:00Z')
    store.setTargetReviewNotes(created.target.id, 'pnpm test 통과', '미확인 사항 없음')
    store.markTargetReceipted(created.target.id, 'receipt:one')

    const drifted = store.prepareTarget({
      retroId: retro.id, projectId: 'p1', repoPath: '/r1', branch: 'main',
      preparedHeadSha: 'c'.repeat(40), preparedAt: '2026-07-20T11:00:00Z',
    })

    expect(drifted.reset).toBe(true)
    expect(drifted.target).toMatchObject({
      preparedHeadSha: 'c'.repeat(40), verificationEvidence: undefined,
      riskNotes: undefined, receiptId: undefined,
    })
    expect(store.listQuestions(retro.id).find((item) => item.id === question.id)?.answer).toBeUndefined()
  })

  test('critical counts and closing completion are deterministic', () => {
    const retro = store.openForDate('2026-07-20')
    const target = store.prepareTarget({
      retroId: retro.id, projectId: 'p1', repoPath: '/r1', branch: 'main',
      preparedHeadSha: 'a'.repeat(40), preparedAt: '2026-07-20T09:01:00Z',
    }).target
    const targetQuestions = store.seedTargetQuestions(target, TARGET_QUESTIONS)
    const closing = store.seedClosingQuestions(retro.id, CLOSING_QUESTIONS)
    expect(store.unansweredCritical(target.id)).toBe(2)
    expect(store.closingComplete(retro.id)).toBe(false)

    for (const question of targetQuestions) store.answer(question.id, '직접 확인함', false)
    store.answer(closing[0].id, '배운 것', false)
    store.answer(closing[1].id, null, true)

    expect(store.unansweredCritical(target.id)).toBe(0)
    expect(store.closingComplete(retro.id)).toBe(true)
    store.markComplete(retro.id, '2026-07-20T21:00:00Z')
    expect(store.getById(retro.id)?.completedAt).toBe('2026-07-20T21:00:00Z')
  })

  test('records bypass events newest first', () => {
    store.recordGateEvent({ repoPath: '/r1', kind: 'skip', reason: 'hotfix', ts: '2026-07-20T11:00:00Z' })
    store.recordGateEvent({ repoPath: '/r1', kind: 'skip', reason: 'demo', ts: '2026-07-20T12:00:00Z' })
    expect(store.listGateEvents().map((event) => event.reason)).toEqual(['demo', 'hotfix'])
  })
})
