import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { TimelineStrip } from './TimelineStrip.js'
import { TaskBoard } from './TaskBoard.js'
import { DevHarnessPanel } from './DevHarnessPanel.js'

type Props = { dashboard: ProjectDashboardRes }

export function PmHome({ dashboard }: Props) {
  const { project, reviewQueue, recentRuns, allTasks } = dashboard

  return (
    <div className="pm-home">
      <section className="pm-home__header">
        <div className="pm-home__goal">
          <h2>Current Goal</h2>
          <p>{project.goal ?? '(no goal set)'}</p>
        </div>
        {project.currentFocus && (
          <div className="pm-home__focus">
            <h2>Current Focus</h2>
            <p>{project.currentFocus}</p>
          </div>
        )}
        {(project.startDate || project.targetDate) && (
          <div className="pm-home__dates">
            <span>{project.startDate ?? '…'}</span>
            <span> → </span>
            <span>{project.targetDate ?? '…'}</span>
          </div>
        )}
      </section>

      <section className="pm-home__timeline">
        <h2>Timeline</h2>
        <TimelineStrip start={project.startDate} target={project.targetDate} tasks={allTasks} />
      </section>

      <section className="pm-home__board">
        <h2>Task Board</h2>
        <TaskBoard tasks={allTasks} />
      </section>

      <section className="pm-home__harness">
        <h2>Run Harness</h2>
        <DevHarnessPanel projectId={project.id} tasks={allTasks} />
      </section>

      <section className="pm-home__review-queue">
        <h2>Review Queue</h2>
        {reviewQueue.length === 0 ? (
          <p className="pm-home__empty">리뷰 대기 없음</p>
        ) : (
          <ul>
            {reviewQueue.map((t) => (
              <li key={t.id}>
                <span className="task-title">{t.title}</span>
                <span className="review-status"> [{t.reviewStatus}]</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pm-home__recent-runs">
        <h2>Recent Runs</h2>
        {recentRuns.length === 0 ? (
          <p className="pm-home__empty">최근 실행 없음</p>
        ) : (
          <ul>
            {recentRuns.map((r) => (
              <li key={r.id}>
                {r.id} — {r.agent} — <span className="run-status">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
