import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { migrate, openDb, type Db } from '@apc/core'
import { migratePm, ReceiptStore, RetroStore } from '@apc/pm'
import { GateService } from './gate-service.js'
import { GitSyncService } from './git-sync-service.js'
import { CLOSING_QUESTIONS, RetroService, TARGET_QUESTIONS } from './retro-service.js'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'APC Test', GIT_AUTHOR_EMAIL: 'apc@example.test',
  GIT_COMMITTER_NAME: 'APC Test', GIT_COMMITTER_EMAIL: 'apc@example.test',
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
}

const roots: string[] = []
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'apc-retro-'))
  roots.push(root)
  const repo = join(root, 'repo')
  git(root, ['init', '-b', 'main', repo])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-m', 'initial'])
  return repo
}

function commit(repo: string, text: string): string {
  writeFileSync(join(repo, 'a.txt'), text + '\n')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-m', text])
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('RetroService', () => {
  let db: Db
  let repo: string
  let receipts: ReceiptStore
  let retros: RetroStore
  let gate: GateService
  let service: RetroService

  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    migratePm(db)
    repo = makeRepo()
    receipts = new ReceiptStore(db)
    retros = new RetroStore(db)
    gate = new GateService()
    service = new RetroService({
      registry: { get: (id) => id === 'p1' ? { id: 'p1', name: 'Project One', repoPaths: [repo] } : undefined },
      gitSync: new GitSyncService(), gate, receipts, retros,
    })
  })

  test('prepare persists a server-owned target and target-scoped evidence/questions', async () => {
    const prepared = await service.prepare('2026-07-20', [{ projectId: 'p1', worktreePath: repo }])

    expect(prepared.projects).toHaveLength(1)
    expect(prepared.projects[0]).toMatchObject({
      projectId: 'p1', name: 'Project One', repoPath: repo,
      changedFiles: 1, additions: 1, deletions: 0,
    })
    expect(prepared.projects[0].target.preparedHeadSha).toBe(git(repo, ['rev-parse', 'HEAD']).trim())
    expect(prepared.projects[0].commits.map((item) => item.subject)).toEqual(['initial'])
    expect(prepared.questions.filter((question) => question.targetId === prepared.projects[0].target.id)).toHaveLength(TARGET_QUESTIONS.length)
    expect(prepared.questions.filter((question) => !question.targetId)).toHaveLength(CLOSING_QUESTIONS.length)
  })

  test('receipt requires a real prepared target, answers, notes and an unchanged server snapshot', async () => {
    const prepared = await service.prepare('2026-07-20', [{ projectId: 'p1', worktreePath: repo }])
    const target = prepared.projects[0].target
    expect((await service.issueReceipt('missing')).ok).toBe(false)
    expect((await service.issueReceipt(target.id)).reason).toContain('critical')

    for (const question of prepared.questions.filter((item) => item.targetId === target.id)) {
      retros.answer(question.id, '직접 확인한 답변', false)
    }
    expect((await service.issueReceipt(target.id)).reason).toContain('검증 근거')
    service.updateTargetNotes(target.id, 'pnpm test: 12 passed', '미확인 위험 없음')

    commit(repo, 'drifted')
    expect((await service.issueReceipt(target.id)).reason).toContain('변경되었습니다')

    const refreshed = await service.prepare('2026-07-20', [{ projectId: 'p1', worktreePath: repo }])
    const refreshedTarget = refreshed.projects[0].target
    expect(refreshedTarget.preparedHeadSha).toBe(git(repo, ['rev-parse', 'HEAD']).trim())
    expect(refreshed.questions.filter((item) => item.targetId === target.id).every((item) => !item.answer)).toBe(true)
    for (const question of refreshed.questions.filter((item) => item.targetId === target.id)) {
      retros.answer(question.id, '새 변경을 다시 확인함', false)
    }
    service.updateTargetNotes(target.id, 'pnpm test 재실행 통과', '미확인 위험 없음')

    const issued = await service.issueReceipt(refreshedTarget.id)
    expect(issued.ok).toBe(true)
    expect(issued.receipt).toMatchObject({
      targetId: refreshedTarget.id,
      reviewedHeadSha: refreshedTarget.preparedHeadSha,
      answeredQuestionIds: expect.arrayContaining(refreshed.questions.filter((item) => item.targetId === target.id).map((item) => item.id)),
    })
    expect((await gate.status(repo)).headCovered).toBe(true)

    const sealedQuestion = refreshed.questions.find((item) => item.targetId === target.id)!
    expect(retros.answer(sealedQuestion.id, '발급 후 조작', false)).toBe(false)
    expect(service.updateTargetNotes(target.id, '발급 후 조작', '없음')).toMatchObject({ ok: false })
    expect(retros.listQuestions(refreshed.retro.id).find((item) => item.id === sealedQuestion.id)?.answer).toBe('새 변경을 다시 확인함')
  })

  test('daily completion requires closing answers and a current receipt for every target', async () => {
    const prepared = await service.prepare('2026-07-20', [{ projectId: 'p1', worktreePath: repo }])
    const target = prepared.projects[0].target
    expect((await service.complete(prepared.retro.id)).reason).toContain('마감')

    for (const question of prepared.questions.filter((item) => item.targetId === target.id)) retros.answer(question.id, '답', false)
    for (const question of prepared.questions.filter((item) => !item.targetId)) retros.answer(question.id, '마감 답', false)
    expect((await service.complete(prepared.retro.id)).reason).toContain('Receipt')

    service.updateTargetNotes(target.id, '수동 실행 확인', '미확인 위험 없음')
    expect((await service.issueReceipt(target.id)).ok).toBe(true)
    expect(await service.complete(prepared.retro.id)).toEqual({ ok: true })

    commit(repo, 'after receipt')
    expect((await service.complete(prepared.retro.id)).reason).toContain('HEAD')
  })
})
