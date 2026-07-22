import { createHash } from 'node:crypto'
import type {
  GateEvent,
  Retro,
  RetroQuestion,
  RetroTarget,
  ReviewReceipt,
} from '@apc/shared'
import type { ReceiptStore, RetroStore } from '@apc/pm'
import type { GateService } from './gate-service.js'
import type { GitSyncService } from './git-sync-service.js'

export const TARGET_QUESTIONS: Array<{ text: string; critical: boolean }> = [
  { text: '이번 변경으로 이전 동작이 어떻게 달라졌는가?', critical: true },
  { text: '가장 중요한 실행 흐름을 시작점부터 결과까지 설명해보라.', critical: true },
  { text: '가장 깨지기 쉬운 지점과 이를 발견할 로그·증상은 무엇인가?', critical: true },
  { text: '어떤 테스트나 실행 결과가 결론을 뒷받침하는가?', critical: true },
  { text: 'agent가 내린 결론 중 직접 확인한 것과 아직 가정인 것은 무엇인가?', critical: true },
]

export const CLOSING_QUESTIONS: Array<{ text: string; critical: boolean }> = [
  { text: '오늘 배운 것 1가지는?', critical: false },
  { text: '내일 더 깊게 팔 것 1가지는?', critical: false },
]

export type RetroProjectEvidence = {
  projectId: string
  name: string
  repoPath: string
  branch: string | null
  target: RetroTarget
  headCovered: boolean
  gateEnabled: boolean
  hookInstalled: boolean
  lastReceiptSha: string | null
  commits: Array<{ sha: string; when: string; subject: string }>
  workingTreeFiles: number
  changedFiles: number
  additions: number
  deletions: number
  resetByHeadDrift: boolean
}

type RegistryLike = {
  get(id: string): { id: string; name: string; repoPaths: string[] } | undefined
}

export class RetroService {
  constructor(private readonly deps: {
    registry: RegistryLike
    gitSync: GitSyncService
    gate: GateService
    receipts: ReceiptStore
    retros: RetroStore
  }) {}

  async prepare(date: string, targets: Array<{ projectId: string; worktreePath?: string }>): Promise<{
    retro: Retro
    questions: RetroQuestion[]
    projects: RetroProjectEvidence[]
    skips: GateEvent[]
    problems: string[]
  }> {
    const { registry, gitSync, gate, receipts, retros } = this.deps
    const retro = retros.openForDate(date)
    retros.seedClosingQuestions(retro.id, CLOSING_QUESTIONS)
    const projects: RetroProjectEvidence[] = []
    const problems: string[] = []

    for (const requested of targets) {
      const project = registry.get(requested.projectId)
      if (!project) {
        problems.push('등록되지 않은 프로젝트입니다: ' + requested.projectId)
        continue
      }
      const repoPath = requested.worktreePath ?? project.repoPaths[0]
      if (!repoPath) {
        problems.push(project.name + ': repo 경로가 없습니다')
        continue
      }
      const [status, gateStatus, headSha] = await Promise.all([
        gitSync.status(repoPath),
        gate.status(repoPath),
        gitSync.headSha(repoPath),
      ])
      if (!status.ok || !headSha) {
        problems.push(project.name + ': Git HEAD를 준비할 수 없습니다' + (status.reason ? ' — ' + status.reason : ''))
        continue
      }

      const prepared = retros.prepareTarget({
        retroId: retro.id,
        projectId: project.id,
        repoPath,
        branch: status.branch,
        preparedHeadSha: headSha,
        preparedAt: new Date().toISOString(),
      })
      retros.seedTargetQuestions(prepared.target, TARGET_QUESTIONS)
      const lastReceipt = receipts.latestForRepo(repoPath)
      const [commits, stats] = await Promise.all([
        gitSync.logSince(repoPath, lastReceipt?.reviewedHeadSha ?? null),
        gitSync.diffStatsSince(repoPath, lastReceipt?.reviewedHeadSha ?? null),
      ])
      for (const skip of await gate.readAndClearSkips(repoPath)) {
        retros.recordGateEvent({ repoPath, kind: 'skip', reason: skip.reason, ts: skip.ts })
      }
      projects.push({
        projectId: project.id,
        name: project.name,
        repoPath,
        branch: status.branch ?? null,
        target: prepared.target,
        headCovered: gateStatus.headCovered,
        gateEnabled: gateStatus.enabled,
        hookInstalled: gateStatus.hookInstalled,
        lastReceiptSha: lastReceipt?.reviewedHeadSha ?? null,
        commits,
        workingTreeFiles: status.files.length,
        ...stats,
        resetByHeadDrift: prepared.reset,
      })
    }

    return {
      retro: retros.getById(retro.id) ?? retro,
      questions: retros.listQuestions(retro.id),
      projects,
      skips: retros.listGateEvents(20),
      problems,
    }
  }

  updateTargetNotes(targetId: string, verificationEvidence: string, riskNotes: string): { ok: boolean; reason?: string } {
    const target = this.deps.retros.getTarget(targetId)
    if (!target) return { ok: false, reason: '회고 대상을 찾을 수 없습니다' }
    if (target.receiptId) return { ok: false, reason: 'Receipt가 발급된 대상은 수정할 수 없습니다. HEAD가 변경되면 새 대상으로 다시 검토합니다' }
    this.deps.retros.setTargetReviewNotes(targetId, verificationEvidence, riskNotes)
    return { ok: true }
  }

  async issueReceipt(targetId: string): Promise<{ ok: boolean; reason?: string; receipt?: ReviewReceipt }> {
    const { gitSync, gate, receipts, retros } = this.deps
    const target = retros.getTarget(targetId)
    if (!target) return { ok: false, reason: '서버에 준비된 회고 대상을 찾을 수 없습니다' }
    const retro = retros.getById(target.retroId)
    if (!retro) return { ok: false, reason: '회고를 찾을 수 없습니다' }
    const project = this.deps.registry.get(target.projectId)
    if (!project) return { ok: false, reason: '등록된 프로젝트가 아닙니다' }

    const questions = retros.listQuestions(target.retroId).filter((question) => question.targetId === target.id)
    const unanswered = retros.unansweredCritical(target.id)
    if (questions.length < TARGET_QUESTIONS.length || unanswered > 0) {
      return { ok: false, reason: 'critical 질문 ' + Math.max(unanswered, TARGET_QUESTIONS.length - questions.length) + '개가 미응답입니다' }
    }
    if (!target.verificationEvidence?.trim()) return { ok: false, reason: '최소 1개의 검증 근거를 입력하세요' }
    if (!target.riskNotes?.trim()) return { ok: false, reason: '위험·미확인 사항을 명시하세요. 없으면 “없음”이라고 입력하세요' }

    const [currentHead, currentStatus] = await Promise.all([
      gitSync.headSha(target.repoPath),
      gitSync.status(target.repoPath),
    ])
    if (!currentHead) return { ok: false, reason: '현재 HEAD를 읽을 수 없습니다' }
    if (currentHead !== target.preparedHeadSha || (target.branch ?? null) !== (currentStatus.branch ?? null)) {
      return { ok: false, reason: 'HEAD 또는 branch가 리뷰 시작 이후 변경되었습니다 — 새로고침 후 다시 확인하세요' }
    }

    const answeredQuestionIds = questions.filter((question) => !!question.answer).map((question) => question.id)
    const answerSnapshotHash = createHash('sha256').update(JSON.stringify({
      targetId: target.id,
      headSha: currentHead,
      answers: questions.map((question) => ({ id: question.id, text: question.text, answer: question.answer })),
      verificationEvidence: target.verificationEvidence,
      riskNotes: target.riskNotes,
    })).digest('hex')
    const existing = target.receiptId ? receipts.get(target.receiptId) : receipts.forTarget(target.id)
    if (existing && existing.reviewedHeadSha === currentHead && existing.answerSnapshotHash === answerSnapshotHash) {
      if (target.receiptId !== existing.id) retros.markTargetReceipted(target.id, existing.id)
      return { ok: true, receipt: existing }
    }

    const receipt = receipts.add({
      projectId: target.projectId,
      repoPath: target.repoPath,
      branch: target.branch,
      reviewedHeadSha: currentHead,
      retroId: target.retroId,
      targetId: target.id,
      answeredQuestionIds,
      evidenceRefs: [target.verificationEvidence],
      answerSnapshotHash,
      issuedAt: new Date().toISOString(),
    })
    const recorded = await gate.recordReviewedSha(target.repoPath, currentHead)
    if (!recorded.ok) {
      receipts.delete(receipt.id)
      return { ok: false, reason: '게이트 파일 기록 실패: ' + (recorded.reason ?? '원인 미상') }
    }
    try {
      retros.markTargetReceipted(target.id, receipt.id)
    } catch (error) {
      receipts.delete(receipt.id)
      await gate.removeReviewedSha(target.repoPath, currentHead)
      return { ok: false, reason: 'Receipt 연결 실패: ' + String(error) }
    }
    return { ok: true, receipt }
  }

  async complete(retroId: string): Promise<{ ok: boolean; reason?: string }> {
    const { gitSync, receipts, retros } = this.deps
    if (!retros.getById(retroId)) return { ok: false, reason: '회고를 찾을 수 없습니다' }
    if (!retros.closingComplete(retroId)) return { ok: false, reason: '마감 질문에 모두 답하거나 “모르겠음”을 선택하세요' }

    for (const target of retros.listTargets(retroId)) {
      const receipt = target.receiptId ? receipts.get(target.receiptId) : null
      if (!receipt) return { ok: false, reason: target.projectId + ': 현재 target의 Receipt가 없습니다' }
      const currentHead = await gitSync.headSha(target.repoPath)
      if (!currentHead || currentHead !== target.preparedHeadSha || currentHead !== receipt.reviewedHeadSha) {
        return { ok: false, reason: target.projectId + ': Receipt 이후 HEAD가 변경되었습니다' }
      }
    }
    retros.markComplete(retroId)
    return { ok: true }
  }
}
