import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GateEvent, Retro, RetroQuestion } from '@apc/shared'
import type { RetroProjectEvidenceDto } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { useStore } from '../store.js'

type Notice = { ok: boolean; text: string }
type ReviewNotes = { verificationEvidence: string; riskNotes: string }

function todayLocal(): string {
  const date = new Date()
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : 'HEAD?'
}

function localTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function reviewReady(
  project: RetroProjectEvidenceDto,
  questions: RetroQuestion[],
  drafts: Record<string, string>,
  notes: ReviewNotes | undefined,
): boolean {
  if (project.target.receiptId) return false
  const targetQuestions = questions.filter((question) => question.targetId === project.target.id)
  return targetQuestions.length > 0
    && targetQuestions.filter((question) => question.critical).every((question) => !!drafts[question.id]?.trim())
    && !!notes?.verificationEvidence.trim()
    && !!notes.riskNotes.trim()
}

export function RetroView() {
  const activeWorktrees = useStore((state) => state.activeWorktrees)
  const [retro, setRetro] = useState<Retro | null>(null)
  const [questions, setQuestions] = useState<RetroQuestion[]>([])
  const [projects, setProjects] = useState<RetroProjectEvidenceDto[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, ReviewNotes>>({})
  const [skips, setSkips] = useState<GateEvent[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyTargetId, setBusyTargetId] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setNotice(null)
    try {
      const registered = await api.listProjects()
      const targets = registered.flatMap((project) => {
        const active = activeWorktrees[project.id]
        const registeredRepo = project.repoPaths[0]
        // SSH projects do not have a local Git common-dir where this M1 gate can live.
        if (!active && (!registeredRepo || registeredRepo.startsWith('ssh://'))) return []
        return [{ projectId: project.id, worktreePath: active ?? undefined }]
      })
      const response = await api.retroPrepare({ date: todayLocal(), targets })
      if (!response.ok || !response.retro) {
        setNotice({ ok: false, text: response.reason ?? '오늘의 회고를 준비할 수 없습니다' })
        return
      }
      const nextQuestions = response.questions ?? []
      const nextProjects = response.projects ?? []
      setRetro(response.retro)
      setQuestions(nextQuestions)
      setProjects(nextProjects)
      setDrafts(Object.fromEntries(nextQuestions.map((question) => [question.id, question.answer ?? ''])))
      setNotes(Object.fromEntries(nextProjects.map((project) => [project.target.id, {
        verificationEvidence: project.target.verificationEvidence ?? '',
        riskNotes: project.target.riskNotes ?? '',
      }])))
      setSkips(response.skips ?? [])
      setProblems(response.problems ?? [])
    } catch (error) {
      setNotice({ ok: false, text: '회고 준비 실패: ' + String(error) })
    } finally {
      setLoading(false)
    }
  }, [activeWorktrees])

  useEffect(() => { void load() }, [load])

  const saveQuestion = async (question: RetroQuestion, skipped = false): Promise<boolean> => {
    const answer = skipped ? undefined : drafts[question.id]?.trim() ?? ''
    try {
      const response = await api.retroAnswer({ questionId: question.id, answer, skipped })
      if (!response.ok) {
        setNotice({ ok: false, text: response.reason ?? '답변을 저장할 수 없습니다' })
        return false
      }
      setQuestions((current) => current.map((item) => item.id === question.id ? {
        ...item,
        answer: skipped || !answer ? undefined : answer,
        skipped,
        answeredAt: skipped || answer ? new Date().toISOString() : undefined,
      } : item))
      return true
    } catch (error) {
      setNotice({ ok: false, text: '답변 저장 실패: ' + String(error) })
      return false
    }
  }

  const toggleUnknown = async (question: RetroQuestion) => {
    if (question.skipped) {
      setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, skipped: false } : item))
      await saveQuestion(question, false)
      return
    }
    await saveQuestion(question, true)
  }

  const issueReceipt = async (project: RetroProjectEvidenceDto) => {
    const targetQuestions = questions.filter((question) => question.targetId === project.target.id)
    const targetNotes = notes[project.target.id]
    if (!reviewReady(project, questions, drafts, targetNotes)) return
    setBusyTargetId(project.target.id)
    setNotice(null)
    try {
      for (const question of targetQuestions) {
        const response = await api.retroAnswer({
          questionId: question.id,
          answer: drafts[question.id]?.trim(),
          skipped: false,
        })
        if (!response.ok) throw new Error(response.reason ?? '답변 저장 실패')
      }
      const noteResponse = await api.retroTargetNotes({
        targetId: project.target.id,
        verificationEvidence: targetNotes.verificationEvidence.trim(),
        riskNotes: targetNotes.riskNotes.trim(),
      })
      if (!noteResponse.ok) throw new Error(noteResponse.reason ?? '검증 메모 저장 실패')

      const response = await api.receiptIssue({ targetId: project.target.id })
      if (!response.ok || !response.receipt) throw new Error(response.reason ?? 'Receipt 발급 실패')
      setQuestions((current) => current.map((question) => question.targetId === project.target.id
        ? { ...question, answer: drafts[question.id]?.trim() || undefined, skipped: false }
        : question))
      setProjects((current) => current.map((item) => item.target.id === project.target.id ? {
        ...item,
        headCovered: true,
        gateEnabled: true,
        target: { ...item.target, receiptId: response.receipt!.id },
      } : item))
      setNotice({ ok: true, text: `${project.name}: ${shortSha(response.receipt.reviewedHeadSha)} 이해 확인 완료 — 이 HEAD는 Push할 수 있습니다` })
    } catch (error) {
      setNotice({ ok: false, text: String(error).replace(/^Error:\s*/, '') })
    } finally {
      setBusyTargetId(null)
    }
  }

  const closingQuestions = useMemo(() => questions.filter((question) => !question.targetId), [questions])
  const closingReady = closingQuestions.length > 0
    && closingQuestions.every((question) => question.skipped || !!drafts[question.id]?.trim())
  const everyTargetReceipted = projects.length > 0 && projects.every((project) => !!project.target.receiptId)

  const completeRetro = async () => {
    if (!retro || !closingReady || !everyTargetReceipted) return
    setCompleting(true)
    setNotice(null)
    try {
      for (const question of closingQuestions) {
        const response = await api.retroAnswer({
          questionId: question.id,
          answer: question.skipped ? undefined : drafts[question.id]?.trim(),
          skipped: question.skipped,
        })
        if (!response.ok) throw new Error(response.reason ?? '마감 답변 저장 실패')
      }
      const response = await api.retroComplete({ retroId: retro.id })
      if (!response.ok) throw new Error(response.reason ?? '회고 마감 실패')
      setRetro((current) => current ? { ...current, completedAt: new Date().toISOString() } : current)
      setNotice({ ok: true, text: '오늘의 회고를 마감했습니다. 답변과 Receipt는 다음 판단을 위한 기록으로 남습니다' })
      const deeper = closingQuestions.find((question) => question.text.includes('깊게 파'))
      const firstProject = projects[0]
      const nextNote = deeper && !deeper.skipped ? drafts[deeper.id]?.trim() : ''
      if (firstProject && nextNote) void api.nextNoteAdd({ projectId: firstProject.projectId, text: `[회고] ${nextNote}` })
    } catch (error) {
      setNotice({ ok: false, text: String(error).replace(/^Error:\s*/, '') })
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="retro" role="region" aria-label="데일리 회고">
      <header className="retro__header">
        <div>
          <span className="retro__eyebrow">Learning Gate</span>
          <h2>오늘의 이해 확인 <small>{retro?.date ?? todayLocal()}</small></h2>
          <p>Push 전에 내가 변경을 이해했는지 직접 설명하고, 검증 근거와 아직 모르는 것을 남기는 화면입니다.</p>
        </div>
        <div className="retro__header-actions">
          {retro?.completedAt && <span className="retro__done-badge">오늘 마감 완료</span>}
          <button type="button" disabled={loading || !!busyTargetId || completing} onClick={() => void load()}>
            {loading ? '변경 수집 중…' : '변경 다시 수집'}
          </button>
        </div>
      </header>

      <section className="retro__guide" aria-label="회고 진행 방법">
        <div><b>1</b><span><strong>변경 파악</strong><small>커밋·diff·작업 트리</small></span></div>
        <div><b>2</b><span><strong>내 말로 설명</strong><small>흐름·위험·검증</small></span></div>
        <div><b>3</b><span><strong>Receipt 발급</strong><small>확인한 HEAD만 Push</small></span></div>
      </section>

      {notice && <div className={`retro__notice retro__notice--${notice.ok ? 'ok' : 'error'}`} role="status">{notice.text}</div>}

      {problems.length > 0 && (
        <section className="retro__problems" aria-label="수집하지 못한 항목">
          <strong>일부 프로젝트를 수집하지 못했습니다</strong>
          <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </section>
      )}

      {skips.length > 0 && (
        <section className="retro__skip-debt panel" aria-label="Learning Gate 우회 기록">
          <h3>우회 부채</h3>
          <p>긴급 Push로 넘겼던 변경입니다. 오늘 회고에서 다시 확인하세요.</p>
          <ul>{skips.map((skip) => <li key={skip.id}><time>{localTime(skip.ts)}</time><code>{skip.repoPath}</code>{skip.reason}</li>)}</ul>
        </section>
      )}

      <section className="retro__projects" aria-label="프로젝트별 변경과 이해 확인">
        {loading && projects.length === 0 && <div className="retro__empty panel">오늘의 커밋과 변경 통계를 수집하는 중…</div>}
        {!loading && projects.length === 0 && <div className="retro__empty panel">회고할 로컬 Git 프로젝트가 없습니다.</div>}
        {projects.map((project) => {
          const targetQuestions = questions.filter((question) => question.targetId === project.target.id)
          const targetNotes = notes[project.target.id] ?? { verificationEvidence: '', riskNotes: '' }
          const receipted = !!project.target.receiptId
          const remaining = targetQuestions.filter((question) => question.critical && !drafts[question.id]?.trim()).length
          const ready = reviewReady(project, questions, drafts, targetNotes)
          return (
            <article key={project.target.id} className={`retro-project panel${receipted ? ' retro-project--done' : ''}`} aria-label={`${project.name} 회고`}>
              <header className="retro-project__header">
                <div className="retro-project__identity">
                  <span className={`retro-project__state retro-project__state--${receipted ? 'done' : 'pending'}`} aria-hidden="true">
                    {receipted ? '✓' : '!'}
                  </span>
                  <div>
                    <h3>{project.name}</h3>
                    <p><code>{project.branch ?? 'detached'}</code><span>{project.repoPath}</span></p>
                  </div>
                </div>
                <div className="retro-project__gate">
                  {receipted || project.headCovered
                    ? <span className="retro-project__covered">✅ {shortSha(project.target.preparedHeadSha)} 확인됨</span>
                    : <span className="retro-project__uncovered">⛔ {shortSha(project.target.preparedHeadSha)} 미확인</span>}
                  {!project.hookInstalled && <span>터미널 Push hook 미설치</span>}
                </div>
              </header>

              {project.resetByHeadDrift && (
                <div className="retro-project__drift" role="alert">HEAD가 바뀌어 이전 답변·검증 근거·Receipt를 초기화했습니다. 새 변경을 다시 확인하세요.</div>
              )}

              <div className="retro-project__evidence">
                <section>
                  <h4>변경 규모</h4>
                  <div className="retro-project__stats">
                    <span><b>{project.commits.length}</b>커밋</span>
                    <span><b>{project.changedFiles}</b>파일</span>
                    <span className="retro-project__add">+{project.additions}</span>
                    <span className="retro-project__del">−{project.deletions}</span>
                  </div>
                  {project.workingTreeFiles > 0 && <p className="retro-project__working">커밋되지 않은 파일 {project.workingTreeFiles}개는 이 Receipt 범위에 포함되지 않습니다.</p>}
                </section>
                <section>
                  <h4>지난 Receipt 이후 커밋</h4>
                  <ul className="retro-project__commits">
                    {project.commits.map((commit) => (
                      <li key={commit.sha}><code>{shortSha(commit.sha)}</code><span>{commit.subject}</span><time>{localTime(commit.when)}</time></li>
                    ))}
                    {project.commits.length === 0 && <li className="retro-project__muted">새 커밋이 없습니다.</li>}
                  </ul>
                </section>
              </div>

              <section className="retro-project__questions" aria-label={`${project.name} Teach-back 질문`}>
                <header>
                  <div><h4>내 말로 설명하기</h4><p>agent의 결론을 복사하지 말고, 현재 HEAD의 흐름과 위험을 직접 적으세요.</p></div>
                  <span>{remaining > 0 ? `필수 ${remaining}개 남음` : '필수 답변 완료'}</span>
                </header>
                {targetQuestions.map((question, index) => (
                  <label key={question.id} className="retro-question">
                    <span><b>{index + 1}</b>{question.text}<em aria-hidden="true">필수</em></span>
                    <textarea
                      aria-label={question.text}
                      value={drafts[question.id] ?? ''}
                      rows={3}
                      disabled={receipted}
                      placeholder="내가 이해한 내용을 구체적으로 적으세요."
                      onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))}
                      onBlur={() => void saveQuestion(question, false)}
                    />
                  </label>
                ))}
              </section>

              <div className="retro-project__notes">
                <label>
                  <span>직접 확인한 검증 근거 <em>필수</em></span>
                  <textarea
                    aria-label="직접 확인한 검증 근거"
                    rows={2}
                    disabled={receipted}
                    value={targetNotes.verificationEvidence}
                    placeholder="예: pnpm test 16개 통과, 실제 로그의 request-id 확인, 수동 시나리오 재현"
                    onChange={(event) => setNotes((current) => ({ ...current, [project.target.id]: { ...targetNotes, verificationEvidence: event.target.value } }))}
                  />
                </label>
                <label>
                  <span>위험·아직 확인하지 못한 것 <em>필수</em></span>
                  <textarea
                    aria-label="위험·아직 확인하지 못한 것"
                    rows={2}
                    disabled={receipted}
                    value={targetNotes.riskNotes}
                    placeholder="없으면 ‘없음’이라고 명시하세요."
                    onChange={(event) => setNotes((current) => ({ ...current, [project.target.id]: { ...targetNotes, riskNotes: event.target.value } }))}
                  />
                </label>
              </div>

              <footer className="retro-project__footer">
                <p>{receipted
                  ? 'Receipt 발급 후 답변은 이 HEAD의 판단 기록으로 고정됩니다.'
                  : ready ? '모든 조건이 채워졌습니다. 서버가 HEAD와 답변을 다시 확인합니다.' : '필수 답변, 검증 근거, 위험 메모를 모두 채우세요.'}</p>
                <button
                  type="button"
                  className="button--accent"
                  disabled={!ready || busyTargetId === project.target.id || receipted}
                  onClick={() => void issueReceipt(project)}
                >
                  {receipted ? `Receipt 발급 완료 · ${shortSha(project.target.preparedHeadSha)}`
                    : busyTargetId === project.target.id ? '서버 재검증 중…' : 'Receipt 발급'}
                </button>
              </footer>
            </article>
          )
        })}
      </section>

      <section className="retro__closing panel" aria-label="오늘의 회고 마감">
        <header><div><h3>오늘의 판단을 내일로 연결하기</h3><p>활동을 경험으로 남기는 마지막 두 문장입니다.</p></div></header>
        <div className="retro__closing-grid">
          {closingQuestions.map((question) => (
            <div key={question.id} className="retro-question retro-question--closing">
              <label>
                <span>{question.text}</span>
                <textarea
                  aria-label={question.text}
                  rows={2}
                  disabled={question.skipped || !!retro?.completedAt}
                  value={drafts[question.id] ?? ''}
                  onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))}
                  onBlur={() => void saveQuestion(question, false)}
                />
              </label>
              <button type="button" disabled={!!retro?.completedAt} onClick={() => void toggleUnknown(question)}>
                {question.skipped ? '답변 입력으로 전환' : '지금은 모르겠음'}
              </button>
            </div>
          ))}
        </div>
        <footer>
          <p>{!everyTargetReceipted ? '먼저 모든 프로젝트의 Receipt를 발급하세요.' : !closingReady ? '마감 질문에 답하거나 ‘지금은 모르겠음’을 기록하세요.' : '회고를 마감할 수 있습니다.'}</p>
          <button type="button" className="button--accent" disabled={!everyTargetReceipted || !closingReady || completing || !!retro?.completedAt} onClick={() => void completeRetro()}>
            {retro?.completedAt ? '오늘 회고 마감됨' : completing ? '마감 검증 중…' : '오늘 회고 마감'}
          </button>
        </footer>
      </section>
    </div>
  )
}
