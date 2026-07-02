import type { WorkspaceOverview } from '@apc/dashboard-api'

type Props = {
  overview: WorkspaceOverview | null
  onRefresh: () => void
  onOpenProject: (projectId: string) => void
}

/** hh:mm for a run's startedAt; falls back to the raw string if unparseable. */
function runTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function WorkspaceHome({ overview, onRefresh, onOpenProject }: Props) {
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
          {overview.projects.map((p) => (
            <section key={p.project.id} className="workspace-card" data-testid={`workspace-card-${p.project.id}`}>
              <header className="workspace-card__head">
                <button type="button" className="workspace-card__title" onClick={() => onOpenProject(p.project.id)}>
                  {p.project.name}
                </button>
                <span className="workspace-card__domain">{p.project.domain}</span>
              </header>
              <div className="workspace-card__badges">
                <span className="workspace-card__badge">진행중 {p.activeTaskCount}</span>
                {p.runningRuns.length > 0 && (
                  <span className="workspace-card__badge workspace-card__badge--running">실행중 {p.runningRuns.length}</span>
                )}
                {p.reviewQueueCount > 0 && (
                  <span className="workspace-card__badge workspace-card__badge--review">리뷰 {p.reviewQueueCount}</span>
                )}
              </div>
              {p.runningRuns.length > 0 && (
                <ul className="workspace-card__runs">
                  {p.runningRuns.map((r) => (
                    <li key={r.id}><span className="run-status">{r.agent}</span> · {runTime(r.startedAt)}</li>
                  ))}
                </ul>
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
          ))}
        </div>
      )}
    </div>
  )
}
