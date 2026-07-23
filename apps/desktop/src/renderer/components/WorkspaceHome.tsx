import type { WorkspaceOverview } from '@apc/dashboard-api'
import type { AgentActivity, AgentPaneIdentity } from '@apc/shared'
import { AgentActivityList } from './AgentActivityList.js'
import { useStore } from '../store.js'

type Props = {
  overview: WorkspaceOverview | null
  onRefresh: () => void
  onOpenProject: (projectId: string) => void
  activities?: readonly AgentActivity[]
  onOpenActivityPane?: (pane: AgentPaneIdentity) => void
  onOpenActivityQuestion?: (activity: AgentActivity) => void
}

/** hh:mm for a run's startedAt; falls back to the raw string if unparseable. */
function runTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function contextSource(source: 'user' | 'agent' | undefined, confirmedAt: string | undefined): string | null {
  if (source === 'user') return '사용자 작성'
  if (source === 'agent') return confirmedAt ? 'AI 제안 · 사용자 확정' : 'AI 제안'
  return null
}

export function WorkspaceHome({
  overview,
  onRefresh,
  onOpenProject,
  activities: activityOverride,
  onOpenActivityPane = () => {},
  onOpenActivityQuestion = () => {},
}: Props) {
  const storeActivities = useStore((state) => state.activities)
  const activities = activityOverride ?? storeActivities
  return (
    <div className="workspace-home">
      <header className="workspace-home__header">
        <h2>🌐 전체 프로젝트</h2>
        <button type="button" onClick={onRefresh} aria-label="전체 새로고침">⟳ 새로고침</button>
      </header>
      {!overview ? (
        <p className="workspace-home__empty">불러오는 중…</p>
      ) : overview.projects.length === 0 ? (
        <p className="workspace-home__empty">프로젝트 없음</p>
      ) : (
        <div className="workspace-home__grid">
          {overview.projects.map((p) => {
            const projectActivities = activities.filter((activity) => activity.pane.projectId === p.project.id)
            const questions = projectActivities
              .filter((activity) => activity.lastQuestion)
              .sort((left, right) => right.lastQuestion!.askedAt.localeCompare(left.lastQuestion!.askedAt))
              .slice(0, 3)
            return (
            <section key={p.project.id} className="workspace-card" data-testid={`workspace-card-${p.project.id}`}>
              <header className="workspace-card__head">
                <button type="button" className="workspace-card__title" onClick={() => onOpenProject(p.project.id)}>
                  {p.project.name}
                </button>
                <span className="workspace-card__domain">{p.project.domain}</span>
              </header>
              {(p.project.goal || p.project.currentFocus) && (
                <div className="workspace-card__context">
                  {p.project.goal && (
                    <div>
                      <span>목표 {contextSource(p.project.goalSource, p.project.goalConfirmedAt) && <small>{contextSource(p.project.goalSource, p.project.goalConfirmedAt)}</small>}</span>
                      <strong>{p.project.goal}</strong>
                    </div>
                  )}
                  {p.project.currentFocus && (
                    <div>
                      <span>현재 집중 {contextSource(p.project.currentFocusSource, p.project.currentFocusConfirmedAt) && <small>{contextSource(p.project.currentFocusSource, p.project.currentFocusConfirmedAt)}</small>}</span>
                      <strong>{p.project.currentFocus}</strong>
                    </div>
                  )}
                </div>
              )}
              <div className="workspace-card__badges">
                <span className="workspace-card__badge">진행중 {p.activeTaskCount}</span>
                {p.runningRuns.length > 0 && (
                  <span className="workspace-card__badge workspace-card__badge--running">실행중 {p.runningRuns.length}</span>
                )}
                {p.reviewQueueCount > 0 && (
                  <span className="workspace-card__badge workspace-card__badge--review">리뷰 {p.reviewQueueCount}</span>
                )}
              </div>
              {p.topNote && <div className="workspace-card__note">📌 {p.topNote}</div>}
              {p.runningRuns.length > 0 && (
                <ul className="workspace-card__runs">
                  {p.runningRuns.map((r) => (
                    <li key={r.id}><span className="run-status">{r.agent}</span> · {runTime(r.startedAt)}</li>
                  ))}
                </ul>
              )}
              <div className="workspace-card__activity">
                <h3>에이전트 상태</h3>
                <AgentActivityList
                  activities={projectActivities}
                  onSelectPane={onOpenActivityPane}
                  emptyMessage="최근 에이전트 활동 없음"
                />
              </div>
              {questions.length > 0 && (
                <div className="workspace-card__questions">
                  <h3>최근 질문</h3>
                  <ul>
                    {questions.map((activity) => (
                      <li key={`${activity.pane.paneId}:${activity.lastQuestion!.askedAt}`}>
                        <button type="button" onClick={() => onOpenActivityQuestion(activity)}>
                          <span>{activity.pane.agent}</span>
                          {activity.lastQuestion!.displayText}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="workspace-card__next">
                <h3>다음 할 일</h3>
                {p.nextUp.length === 0 ? (
                  <p className="workspace-home__empty">없음</p>
                ) : (
                  <ol className="workspace-card__next-list">
                    {p.nextUp.map((t) => (
                      <li key={t.id}>
                        <button type="button" className="workspace-card__task" onClick={() => onOpenProject(p.project.id)}>
                          {t.title}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          )})}
        </div>
      )}
    </div>
  )
}
