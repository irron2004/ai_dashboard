import { HARNESS_STATE_ORDER, formatTimestamp, runStartedAt, runUpdatedAt, stateProgress, stateTone, type HarnessRunBundle } from '../harness-utils.js'

type Props = {
  runs: HarnessRunBundle[]
  selectedRunId: string | null
  loading: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onSelectRun: (runId: string) => void
  onRefresh: () => void
  onStartRun: () => void
}

function toneClass(tone: string): string {
  return `harness-run-list__state--${tone}`
}

export function HarnessRunList({ runs, selectedRunId, loading, collapsed, onToggleCollapse, onSelectRun, onRefresh, onStartRun }: Props) {
  if (collapsed) {
    return (
      <aside className="harness-run-list panel harness-run-list--rail">
        <button
          type="button"
          className="harness-run-list__rail-toggle"
          onClick={onToggleCollapse}
          title="Runs 펼치기"
          aria-label="Runs 펼치기"
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
          onClick={onStartRun}
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
          <h2>Runs</h2>
          <p>Timeline for the current project</p>
        </div>
        <div className="harness-run-list__actions">
          <button type="button" className="harness-run-list__collapse-btn" onClick={onToggleCollapse} title="Runs 접기" aria-label="Runs 접기">◂</button>
          <button type="button" onClick={onRefresh} disabled={loading || !selectedRunId}>Refresh</button>
          <button type="button" className="button button--accent" onClick={onStartRun} disabled={loading}>Start</button>
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
                <button
                  type="button"
                  className={selected ? 'harness-run-list__item harness-run-list__item--selected' : 'harness-run-list__item'}
                  onClick={() => onSelectRun(runState.runId)}
                  disabled={loading}
                >
                  <div className="harness-run-list__item-top">
                    <div>
                      <div className="harness-run-list__run-id">{runState.runId}</div>
                      <div className="harness-run-list__meta">{runState.engine} · {startedAt}</div>
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
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
