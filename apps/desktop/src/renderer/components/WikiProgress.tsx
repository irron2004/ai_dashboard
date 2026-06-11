import { useState } from 'react'
import type { KhState } from '@apc/shared'
import { HARNESS_STATE_ORDER } from '../harness-utils.js'

type Props = {
  /** Current pipeline state (harnessProgress) — a KhState name, or null before the first event. */
  state: string | null
  /** Label of the engine emitting the live log (e.g. the CLI step name). */
  liveLabel: string | null
  /** Last few raw engine log lines. */
  liveTail: string[]
}

type StepStatus = 'done' | 'current' | 'upcoming'

// User-facing pipeline phases. Each maps to the KhState that marks the phase *reached*;
// the phase whose state has not yet been reached is the one currently in progress.
const STEPS: { state: KhState; label: string; hint: string }[] = [
  { state: 'PROJECT_SCANNED',       label: '프로젝트 스캔',        hint: '저장소 파일과 문서를 훑는 중' },
  { state: 'SOURCES_EXTRACTED',     label: '소스 추출',           hint: '대화·코드에서 근거 소스를 모으는 중' },
  { state: 'DOCUMENTS_CLASSIFIED',  label: '문서 분류',           hint: '수집한 문서를 유형별로 분류' },
  { state: 'NODE_PROPOSALS_CREATED', label: '노드 제안 생성',      hint: '위키 노드 후보를 제안' },
  { state: 'LEAD_MERGED',           label: '리드 병합',           hint: '중복 노드를 정리해 대표를 선정' },
  { state: 'WRITE_PLAN_CREATED',    label: '작성 계획',           hint: '어떤 문서를 쓸지 계획 수립' },
  { state: 'STAGING_WRITTEN',       label: '위키 작성·스테이징',    hint: '초안을 스테이징 영역에 작성' },
  { state: 'VALIDATED',             label: '검증',                hint: '링크·커버리지·품질 검사' },
  { state: 'HUMAN_REVIEW_REQUIRED', label: '리뷰 대기',           hint: '사람 검토를 기다리는 중' },
]

/** Last non-empty line of the tail — the one-line summary shown under the active step. */
function lastMeaningfulLine(tail: string[]): string | null {
  for (let i = tail.length - 1; i >= 0; i--) {
    const trimmed = tail[i]?.trim()
    if (trimmed) return trimmed
  }
  return null
}

const MARKER = { done: '✓', current: '●', upcoming: '' } as const

export function WikiProgress({ state, liveLabel, liveTail }: Props) {
  const [showLog, setShowLog] = useState(false)

  const failed = state === 'FAILED'
  // Index of the milestone reached so far (-1 = nothing reached yet → first step is in progress).
  const reachedIdx = state ? HARNESS_STATE_ORDER.indexOf(state as KhState) : -1
  // The active step is the first phase whose state hasn't been reached yet.
  const currentStepIdx = STEPS.findIndex((step) => HARNESS_STATE_ORDER.indexOf(step.state) > reachedIdx)
  const allDone = currentStepIdx === -1 && !failed

  const statusFor = (i: number): StepStatus => {
    if (allDone) return 'done'
    if (currentStepIdx === -1) return 'done'
    if (i < currentStepIdx) return 'done'
    if (i === currentStepIdx) return 'current'
    return 'upcoming'
  }

  const doneCount = allDone ? STEPS.length : Math.max(currentStepIdx, 0)
  const stepNo = allDone ? STEPS.length : Math.min(doneCount + 1, STEPS.length)
  const pct = Math.round(((allDone ? STEPS.length : doneCount + 0.5) / STEPS.length) * 100)
  const summary = lastMeaningfulLine(liveTail)

  if (failed) {
    return (
      <div className="wiki-progress wiki-progress--failed">
        <div className="wiki-progress__head">
          <div className="wiki-progress__title">
            <span className="wiki-progress__fail-mark" aria-hidden>✕</span>
            위키 생성 실패
          </div>
        </div>
        <p className="wiki-progress__fail-msg">{summary ?? '엔진이 오류로 중단되었습니다. 아래 로그를 확인하세요.'}</p>
        {liveTail.length > 0 && (
          <pre className="wiki-progress__log">
            {(liveLabel ? `[${liveLabel}]\n` : '') + liveTail.join('\n')}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="wiki-progress">
      <div className="wiki-progress__head">
        <div className="wiki-progress__title">
          <span className="wiki-progress__spinner" aria-hidden />
          위키 생성 중…
        </div>
        <span className="wiki-progress__count">{stepNo} / {STEPS.length}</span>
      </div>

      <div className="wiki-progress__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>

      <ol className="wiki-progress__steps">
        {STEPS.map((step, i) => {
          const status = statusFor(i)
          return (
            <li key={step.state} className={`wiki-progress__step wiki-progress__step--${status}`}>
              <span className="wiki-progress__marker" aria-hidden>{MARKER[status]}</span>
              <div className="wiki-progress__step-body">
                <span className="wiki-progress__step-label">
                  {step.label}{status === 'current' ? ' 중…' : ''}
                </span>
                {status === 'current' && (
                  <span className="wiki-progress__step-sub">{summary ?? step.hint}</span>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <button
        type="button"
        className="wiki-progress__toggle"
        onClick={() => setShowLog((v) => !v)}
        aria-expanded={showLog}
      >
        {showLog ? '간단히 ▴' : '자세히 ▾'}
      </button>
      {showLog && (
        <pre className="wiki-progress__log">
          {liveTail.length ? (liveLabel ? `[${liveLabel}]\n` : '') + liveTail.join('\n') : '(아직 엔진 로그가 없습니다)'}
        </pre>
      )}
    </div>
  )
}
