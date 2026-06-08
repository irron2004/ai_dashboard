import type { AgentProfile } from '@apc/shared'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'
import { HarnessDashboard } from './HarnessDashboard.js'

export type MainTab = 'pm' | 'harness'

type Props = {
  tab: MainTab
  onTab: (tab: MainTab) => void
  dashboard: ProjectDashboardRes
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
}

const TABS: { id: MainTab; label: string }[] = [
  { id: 'pm', label: 'PM Home' },
  { id: 'harness', label: 'Knowledge Harness' },
]

export function MainPanel({ tab, onTab, dashboard, profiles, onSelectProfile }: Props) {
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
          </button>
        ))}
      </nav>
      <div className="main-panel__content">
        {tab === 'pm'
          ? <PmHome dashboard={dashboard} />
          : <HarnessDashboard profiles={profiles} onSelectProfile={onSelectProfile} />}
      </div>
    </div>
  )
}
