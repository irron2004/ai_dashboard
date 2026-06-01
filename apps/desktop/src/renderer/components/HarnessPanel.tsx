import type { AgentProfile } from '@apc/shared'

type Props = {
  profiles: AgentProfile[]
  onSelect: (profileId: string) => void
}

export function HarnessPanel({ profiles, onSelect }: Props) {
  return (
    <div className="harness-panel">
      <h2>Agent Profiles</h2>
      <ul className="harness-panel__list">
        {profiles.map((profile) => (
          <li key={profile.id} className="harness-panel__item">
            <div className="harness-panel__info">
              <span className="harness-panel__name">{profile.name}</span>
              <span className="harness-panel__provider">({profile.provider})</span>
              <span className="harness-panel__scope">{profile.scope}</span>
              {profile.mode && <span className="harness-panel__mode">{profile.mode}</span>}
            </div>
            <button
              type="button"
              className="harness-panel__use-btn"
              onClick={() => onSelect(profile.id)}
            >
              Use
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
