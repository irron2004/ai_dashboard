import type { ReactNode } from 'react'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { HomeView } from './HomeView.js'
import { KnowledgeView } from './KnowledgeView.js'
import { WikiGenDashboard } from './WikiGenDashboard.js'

export type MainTab = 'home' | 'knowledge' | 'wikigen'

type Props = {
  tab: MainTab
  onTab: (tab: MainTab) => void
  dashboard: ProjectDashboardRes
  /** Right-aligned toolbar actions rendered inline in the tab row (so they don't claim a whole row). */
  actions?: ReactNode
  /** True while a wiki generation run is in flight — shows a pulsing dot on the Wiki Gen tab. */
  wikiGenRunning?: boolean
}

const TABS: { id: MainTab; label: string }[] = [
  { id: 'home', label: '🏠 Home' },
  { id: 'knowledge', label: '📖 Knowledge' },
  { id: 'wikigen', label: '⚙ Wiki Gen' },
]

export function MainPanel({ tab, onTab, dashboard, actions, wikiGenRunning }: Props) {
  return (
    <div className="main-panel">
      <nav className="main-panel__tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`main-panel__tab${tab === id ? ' main-panel__tab--active' : ''}`}
            aria-pressed={tab === id}
            onClick={() => onTab(id)}
          >
            {label}
            {id === 'wikigen' && wikiGenRunning && (
              <span className="main-panel__tab-dot" data-testid="wikigen-running-dot" aria-hidden="true" />
            )}
          </button>
        ))}
        {actions && <div className="main-panel__tab-actions">{actions}</div>}
      </nav>
      <div className="main-panel__content">
        {tab === 'home' && <HomeView dashboard={dashboard} />}
        {tab === 'knowledge' && <KnowledgeView />}
        {tab === 'wikigen' && <WikiGenDashboard />}
      </div>
    </div>
  )
}
