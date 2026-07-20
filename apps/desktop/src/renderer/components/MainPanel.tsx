import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type {
  ConversationHistoryReq,
  ConversationHistoryRes,
  ProjectDashboardRes,
} from '../../shared/ipc-contract.js'
import type { WorkspaceOverview } from '@apc/dashboard-api'
import type { AgentActivity, AgentPaneIdentity, ResolvedFileReference } from '@apc/shared'
import { HomeView, ProjectDocumentsView } from './HomeView.js'
import { KnowledgeView } from './KnowledgeView.js'
import { WikiGenDashboard } from './WikiGenDashboard.js'
import { WorkspaceHome } from './WorkspaceHome.js'
import { ConversationHistoryView, type HistoryFocus } from './ConversationHistoryView.js'
import { RetroView } from './RetroView.js'

export type MainTab = 'workspace' | 'home' | 'documents' | 'knowledge' | 'wikigen' | 'history' | 'retro'
export type ProjectLoadState = 'unselected' | 'loading' | 'ready'

type Props = {
  tab: MainTab
  onTab: (tab: MainTab) => void
  dashboard: ProjectDashboardRes | null
  projectLoadState: ProjectLoadState
  /** Right-aligned toolbar actions rendered inline in the tab row (so they don't claim a whole row). */
  actions?: ReactNode
  /** True while a wiki generation run is in flight — shows a pulsing dot on the Wiki Gen tab. */
  wikiGenRunning?: boolean
  overview?: WorkspaceOverview | null
  onRefreshWorkspace?: () => void
  onOpenProject?: (projectId: string) => void
  activities?: readonly AgentActivity[]
  onOpenActivityPane?: (pane: AgentPaneIdentity) => void
  onOpenActivityQuestion?: (activity: AgentActivity) => void
  onProjectChanged?: () => void
  historyFocus?: HistoryFocus | null
  onHistoryFocusConsumed?: () => void
  fetchConversationHistory?: (req: ConversationHistoryReq) => Promise<ConversationHistoryRes>
  activeWorktreePath?: string
  onOpenFileReference?: (reference: ResolvedFileReference) => void
}

const TABS: { id: MainTab; icon: string; label: string }[] = [
  { id: 'workspace', icon: '🌐', label: '전체' },
  { id: 'home', icon: '🏠', label: '홈' },
  { id: 'documents', icon: '📄', label: '문서' },
  { id: 'knowledge', icon: '📖', label: '지식' },
  { id: 'wikigen', icon: '⚙', label: '위키 생성' },
  { id: 'history', icon: '💬', label: '히스토리' },
  { id: 'retro', icon: '🧠', label: '회고' },
]

export function MainPanel({
  tab,
  onTab,
  dashboard,
  projectLoadState,
  actions,
  wikiGenRunning,
  overview,
  onRefreshWorkspace,
  onOpenProject,
  activities,
  onOpenActivityPane,
  onOpenActivityQuestion,
  onProjectChanged,
  historyFocus,
  onHistoryFocusConsumed,
  fetchConversationHistory,
  activeWorktreePath,
  onOpenFileReference,
}: Props) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const projectRequired = tab !== 'workspace' && tab !== 'retro' && projectLoadState !== 'ready'
  const activeTabId = `main-tab-${tab}`
  const activePanelId = `main-panel-${tab}`

  const handleTabKeyDown = (index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    onTab(TABS[nextIndex].id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div className="main-panel">
      <div className="main-panel__tabs">
        <nav aria-label="주 화면">
          <div role="tablist" aria-label="주 화면 탭" style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
            {TABS.map(({ id, icon, label }, index) => {
              const selected = tab === id
              const runningLabel = id === 'wikigen' && wikiGenRunning ? `${label} (실행 중)` : label
              return (
                <button
                  key={id}
                  ref={(node) => { tabRefs.current[index] = node }}
                  id={`main-tab-${id}`}
                  type="button"
                  role="tab"
                  className={`main-panel__tab${selected ? ' main-panel__tab--active' : ''}`}
                  aria-label={runningLabel}
                  aria-selected={selected}
                  aria-controls={`main-panel-${id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(index, event)}
                >
                  <span aria-hidden="true">{icon}</span> {label}
                  {id === 'wikigen' && wikiGenRunning && (
                    <span className="main-panel__tab-dot" data-testid="wikigen-running-dot" aria-hidden="true" />
                  )}
                </button>
              )
            })}
          </div>
        </nav>
        {actions && <div className="main-panel__tab-actions">{actions}</div>}
      </div>
      <div
        id={activePanelId}
        className="main-panel__content"
        role="tabpanel"
        aria-labelledby={activeTabId}
        tabIndex={0}
      >
        {projectRequired && (
          <div className="app-layout__placeholder" role="status" aria-live="polite">
            {projectLoadState === 'loading'
              ? '프로젝트를 불러오는 중…'
              : '프로젝트를 선택하거나 새 프로젝트를 추가하세요'}
          </div>
        )}
        {tab === 'home' && dashboard && <HomeView dashboard={dashboard} onChanged={onProjectChanged} />}
        {tab === 'documents' && dashboard && <ProjectDocumentsView dashboard={dashboard} />}
        {tab === 'knowledge' && dashboard && <KnowledgeView />}
        {tab === 'wikigen' && dashboard && <WikiGenDashboard />}
        {tab === 'history' && dashboard && fetchConversationHistory && (
          <ConversationHistoryView
            projectId={dashboard.project.id}
            focus={historyFocus ?? null}
            onFocusConsumed={onHistoryFocusConsumed ?? (() => {})}
            fetchHistory={fetchConversationHistory}
            activeWorktreePath={activeWorktreePath}
            onOpenFileReference={onOpenFileReference}
          />
        )}
        {tab === 'workspace' && (
          <WorkspaceHome
            overview={overview ?? null}
            onRefresh={onRefreshWorkspace ?? (() => {})}
            onOpenProject={onOpenProject ?? (() => {})}
            activities={activities ?? []}
            onOpenActivityPane={onOpenActivityPane ?? (() => {})}
            onOpenActivityQuestion={onOpenActivityQuestion ?? (() => {})}
          />
        )}
        {tab === 'retro' && <RetroView />}
      </div>
    </div>
  )
}
