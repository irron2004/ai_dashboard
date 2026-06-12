import type { ReactNode } from 'react'
import type { AgentProfile } from '@apc/shared'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'
import { HarnessDashboard } from './HarnessDashboard.js'

export type MainTab = 'home' | 'knowledge' | 'wikigen'

type Props = {
  tab: MainTab
  onTab: (tab: MainTab) => void
  dashboard: ProjectDashboardRes
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
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

export function MainPanel({ tab, onTab, dashboard, profiles, onSelectProfile, actions, wikiGenRunning }: Props) {
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
              <span className="main-panel__tab-dot" data-testid="wikigen-running-dot" aria-label="생성 진행 중" />
            )}
          </button>
        ))}
        {actions && <div className="main-panel__tab-actions">{actions}</div>}
      </nav>
      <div className="main-panel__content">
        {tab === 'home' && <PmHome dashboard={dashboard} />}
        {tab === 'knowledge' && <HarnessDashboard profiles={profiles} onSelectProfile={onSelectProfile} />}
        {tab === 'wikigen' && <div className="main-panel__placeholder">⚙ Wiki Gen — Phase 2에서 구현</div>}
      </div>
    </div>
  )
}
