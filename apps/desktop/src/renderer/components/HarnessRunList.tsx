import { useState } from 'react'
import {
  HARNESS_STATE_ORDER, formatTimestamp, isRunResumable, runModeLabel, runStartedAt, runUpdatedAt,
  stateProgress, stateTone, type HarnessRunBundle,
} from '../harness-utils.js'

type Props = {
  runs: HarnessRunBundle[]
  selectedRunId: string | null
  loading: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onSelectRun: (runId: string) => void
  onRefresh: () => void
  onStartRun: (materialize: boolean) => void
  onResumeRun: (runId: string) => void
}

function toneClass(tone: string): string {
  return `harness-run-list__state--${tone}`
}

function StartRunDropdown({ loading, onStartRun }: { loading: boolean; onStartRun: (materialize: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="start-run-dropdown">
      <button type="button" className="button button--accent" disabled={loading} onClick={() => setOpen((v) => !v)}>
        ▶ 위키 생성 ▾
      </button>
      {open && (
        <div className="start-run-dropdown__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onStartRun(true) }}>
            전체 문서
            <small>프로젝트 md 전체 + 세션 Q&A로 위키 생성 (기본)</small>
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onStartRun(false) }}>
            최근 세션
            <small>최근 에이전트 세션만으로 빠르게 실행</small>
          </button>
        </div>
      )}
    </div>
  )
}

export function HarnessRunList({ runs, selectedRunId, loading, collapsed, onToggleCollapse, onSelectRun, onRefresh, onStartRun, onResumeRun }: Props) {
  if (collapsed) {
    return (
      <aside className="harness-run-list panel harness-run-list--rail">
        <button
          type="button"
          className="harness-run-list__rail-toggle"
          onClick={onToggleCollapse}
          title="실행 이력 펼치기"
          aria-label="실행 이력 펼치기"
        >
          ▸
        </button>
        <div className="harness-run-list__rail-items">
          {runs.map((bundle) => {
            const { runState } = bundle
            const selected = runState.runId === selectedRunId
            const tone = stateTone(runState.state)
            return (
              <button
                key={runState.runId}
                type="button"
                className={`harness-run-list__rail-dot harness-run-list__rail-dot--${tone}${selected ? ' harness-run-list__rail-dot--selected' : ''}`}
                onClick={() => onSelectRun(runState.runId)}
                disabled={loading}
                title={`${runState.runId} · ${runState.state.replace(/_/g, ' ')}`}
                aria-label={`${runState.runId} (${runState.state})`}
              />
            )
          })}
        </div>
        <button
          type="button"
          className="harness-run-list__rail-start"
          onClick={() => onStartRun(true)}
          disabled={loading}
          title="Start run"
          aria-label="Start run"
        >
          +
        </button>
      </aside>
    )
  }

  return (
    <aside className="harness-run-list panel">
      <header className="panel__header harness-run-list__header">
        <div>
          <h2>실행 이력</h2>
          <p>이 프로젝트의 위키 생성 run</p>
        </div>
        <div className="harness-run-list__actions">
          <button type="button" className="harness-run-list__collapse-btn" onClick={onToggleCollapse} title="실행 이력 접기" aria-label="실행 이력 접기">◂</button>
          <button type="button" onClick={onRefresh} disabled={loading || !selectedRunId}>⟳</button>
          <StartRunDropdown loading={loading} onStartRun={onStartRun} />
        </div>
      </header>

      {runs.length === 0 ? (
        <div className="panel__empty">
          <p>No harness runs yet.</p>
          <span>Launch a run to populate the timeline.</span>
        </div>
      ) : (
        <ul className="harness-run-list__items">
          {runs.map((bundle) => {
            const { runState } = bundle
            const selected = runState.runId === selectedRunId
            const tone = stateTone(runState.state)
            const startedAt = formatTimestamp(runStartedAt(runState))
            const updatedAt = formatTimestamp(runUpdatedAt(runState))
            const progress = stateProgress(runState.state)

            return (
              <li key={runState.runId}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={runState.runId}
                  className={selected ? 'harness-run-list__item harness-run-list__item--selected' : 'harness-run-list__item'}
                  onClick={() => { if (!loading) onSelectRun(runState.runId) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !loading) onSelectRun(runState.runId) }}
                >
                  <div className="harness-run-list__item-top">
                    <div>
                      <div className="harness-run-list__run-id">{runState.runId}</div>
                      <div className="harness-run-list__meta">{runModeLabel(bundle.mode) || runState.engine} · {startedAt}</div>
                    </div>
                    <span className={`harness-run-list__badge ${toneClass(tone)}`}>{runState.state.replace(/_/g, ' ')}</span>
                  </div>

                  <div className="harness-run-list__progress" aria-hidden="true">
                    <span style={{ width: `${progress}%` }} />
                  </div>

                  <div className="harness-run-list__history">
                    {HARNESS_STATE_ORDER.map((step) => {
                      const reached = runState.history.some((event) => event.state === step)
                      return <span key={step} className={reached ? 'harness-run-list__step harness-run-list__step--active' : 'harness-run-list__step'} />
                    })}
                  </div>

                  <div className="harness-run-list__footer">
                    <span>{updatedAt}</span>
                    <span>{bundle.artifacts.length} artifacts</span>
                    {isRunResumable(runState.state) && (
                      <button
                        type="button"
                        className="harness-run-list__resume"
                        disabled={loading}
                        onClick={(e) => { e.stopPropagation(); onResumeRun(runState.runId) }}
                      >
                        ↻ 이어하기
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
