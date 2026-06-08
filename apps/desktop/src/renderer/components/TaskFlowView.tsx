import { HARNESS_STATE_ORDER, buildTaskStepStatus, formatTimestamp, runCompletionLabel, type HarnessRunBundle } from '../harness-utils.js'

type Props = {
  run: HarnessRunBundle | null
}

export function TaskFlowView({ run }: Props) {
  if (!run) {
    return <section className="panel task-flow-view"><div className="panel__empty"><p>Select a run to inspect its flow.</p></div></section>
  }

  const { runState } = run
  return (
    <section className="panel task-flow-view">
      <header className="panel__header task-flow-view__header">
        <div>
          <h2>Task Flow View</h2>
          <p>{runState.runId} · {runState.engine}</p>
        </div>
        <span className={`task-flow-view__status task-flow-view__status--${runState.state === 'FAILED' ? 'danger' : runState.state === 'MERGED' ? 'success' : 'warning'}`}>
          {runCompletionLabel(runState.state)}
        </span>
      </header>

      <div className="task-flow-view__timeline">
        {HARNESS_STATE_ORDER.map((step, index) => {
          const status = buildTaskStepStatus(runState.state, step)
          return (
            <article key={step} className={`task-flow-view__step task-flow-view__step--${status}`}>
              <div className="task-flow-view__step-index">{index + 1}</div>
              <div className="task-flow-view__step-copy">
                <h3>{step.replace(/_/g, ' ')}</h3>
                <p>
                  {status === 'done' && 'Completed'}
                  {status === 'current' && 'Currently active'}
                  {status === 'upcoming' && 'Queued'}
                  {status === 'blocked' && 'Blocked by failure'}
                </p>
              </div>
              <div className="task-flow-view__step-state">{status}</div>
            </article>
          )
        })}
      </div>

      <div className="task-flow-view__history">
        <h3>History</h3>
        <ul>
          {runState.history.map((entry) => (
            <li key={`${entry.state}:${entry.at}`}>
              <span>{entry.state.replace(/_/g, ' ')}</span>
              <small>{formatTimestamp(entry.at)}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
