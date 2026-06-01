import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'

type Props = { dashboard: ProjectDashboardRes }

export function PmHome({ dashboard }: Props) {
  const { project, activeTasks, reviewQueue, recentRuns } = dashboard

  return (
    <div className="pm-home">
      <section className="pm-home__goal">
        <h2>Current Goal</h2>
        <p>{project.goal ?? '(no goal set)'}</p>
      </section>

      <section className="pm-home__active-tasks">
        <h2>Active Tasks</h2>
        <ul>
          {activeTasks.map((t) => (
            <li key={t.id}>
              <span className="task-title">{t.title}</span>
              <span className="task-priority"> [{t.priority}]</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pm-home__review-queue">
        <h2>Review Queue</h2>
        <ul>
          {reviewQueue.map((t) => (
            <li key={t.id}>
              <span className="task-title">{t.title}</span>
              <span className="review-status"> [{t.reviewStatus}]</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pm-home__recent-runs">
        <h2>Recent Runs</h2>
        <ul>
          {recentRuns.map((r) => (
            <li key={r.id}>
              {r.id} — {r.agent} — {r.status}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
