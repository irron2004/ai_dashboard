import { useState } from 'react'
import type { Task } from '@apc/shared'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { nextUp } from '@apc/dashboard-api'
import { TimelineStrip } from './TimelineStrip.js'
import { TaskBoard } from './TaskBoard.js'
import { DevHarnessPanel } from './DevHarnessPanel.js'

type Props = { dashboard: ProjectDashboardRes }

export function PmHome({ dashboard }: Props) {
  const { project, reviewQueue, recentRuns, allTasks } = dashboard
  const [depOverrides, setDepOverrides] = useState<Record<string, string[]>>({})
  const tasks: Task[] = allTasks.map((t) => (depOverrides[t.id] ? { ...t, blockedBy: depOverrides[t.id] } : t))
  const handleSetBlockedBy = async (taskId: string, blockedBy: string[]) => {
    const prevOverride = depOverrides[taskId]
    setDepOverrides((prev) => ({ ...prev, [taskId]: blockedBy }))
    const revert = () =>
      setDepOverrides((prev) => {
        const next = { ...prev }
        if (prevOverride !== undefined) next[taskId] = prevOverride
        else delete next[taskId]
        return next
      })
    try {
      const res = await api.taskSetBlockedBy({ taskId, blockedBy })
      if (!res.ok) {
        console.warn('taskSetBlockedBy rejected:', res.reason)
        revert()
      }
    } catch (err) {
      console.warn('taskSetBlockedBy failed:', err)
      revert()
    }
  }
  const upNext = nextUp(tasks)

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

      <section className="pm-home__next-up" data-testid="next-up">
        <h2>다음 할 일</h2>
        {upNext.length === 0 ? (
          <p className="pm-home__empty">진행할 수 있는 작업 없음</p>
        ) : (
          <ol className="pm-home__next-list">
            {upNext.map((t) => (
              <li key={t.id}>
                <span className="task-title">{t.title}</span>
                <span className={`pm-board__priority pm-board__priority--${t.priority}`}>{t.priority}</span>
                {t.dueDate && <span className="pm-board__due">{t.dueDate}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="pm-home__board">
        <h2>Task Board</h2>
        <TaskBoard tasks={tasks} onSetBlockedBy={handleSetBlockedBy} />
      </section>

      <section className="pm-home__harness">
        <h2>Run Harness</h2>
        <DevHarnessPanel key={project.id} projectId={project.id} tasks={allTasks} recentRuns={recentRuns} />
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
