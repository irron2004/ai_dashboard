import type { AgentProfile, AgentType, KhState } from '@apc/shared'
import {
  HARNESS_AGENT_PROMPTS, HARNESS_FEATURE_GATES, GATE_WIRING, GATE_WIRING_LABEL, SHIPPED_GATE_VALUES, HARNESS_STATE_ORDER,
  type HarnessConfig, type HarnessAgentPromptKey, type HarnessFeatureGateKey,
} from '../harness-utils.js'
import { HarnessPanel } from './HarnessPanel.js'

type Props = {
  config: HarnessConfig
  loading: boolean
  /** A harness run is in progress — drives the live pulse on the active pipeline agent. */
  running?: boolean
  /** Current pipeline milestone (harnessProgress KhState); lights up agents up to/at this point. */
  activeState?: string | null
  message: string | null
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
  onModelChange: (patch: Partial<HarnessConfig['model']>) => void
  onSafetyChange: (patch: Partial<HarnessConfig['safety']>) => void
  onToggleGate: (key: HarnessFeatureGateKey) => void
  onPromptChange: (key: HarnessAgentPromptKey, value: string) => void
  onRefresh: () => void
  onPromote: () => void
  onForcePromote?: () => void
  /** Set when promote was blocked by a validation gate that allowInvalid can override; shows the force UI. */
  promoteBlockedReason?: string | null
  canPromote?: boolean
}

const ENGINE_OPTIONS: AgentType[] = ['claude', 'opencode', 'codex']

// The pipeline milestone each agent produces — used to light up the agent currently doing work during a run.
const AGENT_STATE: Record<HarnessAgentPromptKey, KhState> = {
  projectDiscovery: 'PROJECT_SCANNED',
  conversationHistory: 'SOURCES_EXTRACTED',
  documentIntent: 'DOCUMENTS_CLASSIFIED',
  knowledgeNodeExtractor: 'NODE_PROPOSALS_CREATED',
  wikiGraphLead: 'WRITE_PLAN_CREATED',
  policyGuard: 'VALIDATED',
}

type AgentActivity = 'done' | 'active' | 'idle'

export function AgentConfigPanel({
  config, loading, running = false, activeState, message, profiles, onSelectProfile, onModelChange,
  onRefresh, onPromote, onForcePromote, promoteBlockedReason, canPromote = true,
}: Props) {
  // Honesty (C1/C2): only Engine reaches the run. Gates reflect the shipped policy read-only; temperature/
  // max-tokens/prompts/safety map to no backend knob in the MVP and are shown disabled + labeled.

  // Live pipeline activity: the active agent is the first whose milestone hasn't been reached yet.
  const reachedIdx = activeState ? HARNESS_STATE_ORDER.indexOf(activeState as KhState) : -1
  const firstPendingKey = running
    ? HARNESS_AGENT_PROMPTS.find((p) => HARNESS_STATE_ORDER.indexOf(AGENT_STATE[p.key]) > reachedIdx)?.key
    : undefined
  const activeAgentLabel = HARNESS_AGENT_PROMPTS.find((p) => p.key === firstPendingKey)?.label
  const activityOf = (key: HarnessAgentPromptKey): AgentActivity => {
    if (!running) return 'idle'
    if (HARNESS_STATE_ORDER.indexOf(AGENT_STATE[key]) <= reachedIdx) return 'done'
    return key === firstPendingKey ? 'active' : 'idle'
  }

  const honored = HARNESS_FEATURE_GATES.filter((g) => GATE_WIRING[g.key] === 'honored')
  const alwaysOn = HARNESS_FEATURE_GATES.filter((g) => GATE_WIRING[g.key] === 'structural')
  const notWired = HARNESS_FEATURE_GATES.filter((g) => GATE_WIRING[g.key] === 'forward-declared')

  const renderGate = (gate: (typeof HARNESS_FEATURE_GATES)[number]) => {
    const wiring = GATE_WIRING[gate.key]
    const on = SHIPPED_GATE_VALUES[gate.key]
    return (
      <div
        key={gate.key}
        className={`agent-config-panel__gate agent-config-panel__gate--${wiring}${on ? ' agent-config-panel__gate--on' : ''}`}
        title={`${gate.description} (${GATE_WIRING_LABEL[wiring]})`}
      >
        <span className="agent-config-panel__gate-mark" aria-hidden />
        <span className="agent-config-panel__gate-label">{gate.label}</span>
      </div>
    )
  }

  return (
    <aside className="panel agent-config-panel">
      <header className="panel__header agent-config-panel__header">
        <div>
          <h2>Agent Configuration</h2>
          <p>위키 생성이 따르는 현재 정책입니다. <b>Engine만 변경 가능</b>하고 나머지는 읽기 전용 표시입니다.</p>
        </div>
      </header>

      {/* The one real control */}
      <section className="agent-config-panel__section">
        <h3>Model</h3>
        <label>
          <span>Engine <em className="agent-config-panel__editable">변경 가능</em></span>
          <select value={config.model.engine} onChange={(event) => onModelChange({ engine: event.target.value as AgentType })}>
            {ENGINE_OPTIONS.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
          </select>
        </label>
        <details className="agent-config-panel__more">
          <summary>고급 (미연결)</summary>
          <label className="agent-config-panel__disabled" title="Not wired in the MVP — the CLI agent backend exposes no temperature knob.">
            <span>Temperature: {config.model.temperature.toFixed(2)}</span>
            <input type="range" min="0" max="1" step="0.05" value={config.model.temperature} disabled readOnly />
          </label>
          <label className="agent-config-panel__disabled" title="Not wired in the MVP — the CLI agent backend exposes no max-tokens knob.">
            <span>Max tokens: {config.model.maxTokens}</span>
            <input type="number" value={config.model.maxTokens} disabled readOnly />
          </label>
        </details>
      </section>

      {/* Pipeline agents — live activity (pulses the agent currently doing work) */}
      <section className="agent-config-panel__section">
        <h3>
          Pipeline Agents
          {running && (
            <span className="agent-config-panel__live">
              ● {activeAgentLabel ? `${activeAgentLabel} 작동 중` : '실행 중'}
            </span>
          )}
        </h3>
        <ul className="agent-config-panel__agents">
          {HARNESS_AGENT_PROMPTS.map((prompt) => {
            const activity = activityOf(prompt.key)
            return (
              <li key={prompt.key} className={`agent-config-panel__agent agent-config-panel__agent--${activity}`}>
                <span className="agent-config-panel__agent-dot" aria-hidden>{activity === 'done' ? '✓' : ''}</span>
                <div className="agent-config-panel__agent-body">
                  <span className="agent-config-panel__agent-name">
                    {prompt.label}{activity === 'active' ? ' · 작동 중…' : ''}
                  </span>
                  <small>{prompt.hint}</small>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Feature gates — grouped by what they actually do */}
      <section className="agent-config-panel__section">
        <h3>Feature Gates</h3>

        <div className="agent-config-panel__gate-group">
          <h4>실행 단계 <span>작동 중</span></h4>
          <div className="agent-config-panel__gate-grid">{honored.map(renderGate)}</div>
        </div>

        <div className="agent-config-panel__gate-group">
          <h4>안전장치 <span>항상 켜짐</span></h4>
          <div className="agent-config-panel__gate-grid">{alwaysOn.map(renderGate)}</div>
        </div>

        <details className="agent-config-panel__gate-group agent-config-panel__notwired">
          <summary>미구현 {notWired.length}개 · 예정 기능</summary>
          <div className="agent-config-panel__gate-grid">{notWired.map(renderGate)}</div>
        </details>
      </section>

      <details className="agent-config-panel__section agent-config-panel__more">
        <summary>Safety Settings (고정)</summary>
        <p className="agent-config-panel__note">Secret scan + evidence requirement은 MVP에서 항상 켜진 고정값입니다.</p>
        <label className="agent-config-panel__disabled">
          <span>Secret scan sensitivity: {config.safety.secretScanSensitivity}</span>
        </label>
        <label className="agent-config-panel__disabled">
          <span>Evidence requirement: {config.safety.evidenceRequirement}</span>
        </label>
      </details>

      <section className="agent-config-panel__actions">
        <button type="button" onClick={onRefresh} disabled={loading}>Refresh run</button>
        <button type="button" className="button button--accent" onClick={onPromote} disabled={loading || !canPromote} title={canPromote ? undefined : '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 promote할 수 있습니다'}>Promote current</button>
      </section>

      {promoteBlockedReason && (
        <div className="agent-config-panel__promote-block">
          <div className="agent-config-panel__promote-block-head">
            <span aria-hidden>⚠</span>
            <strong>Promote 차단</strong>
          </div>
          <p>{promoteBlockedReason}</p>
          <small>깨진 링크·중복 노드 등 검증 실패. 상세는 Markdown 탭의 validation 리포트에서 확인하세요.</small>
          <button
            type="button"
            className="agent-config-panel__force-btn"
            onClick={onForcePromote}
            disabled={loading || !onForcePromote}
          >
            검증 무시하고 promote
          </button>
        </div>
      )}

      {message && <div className="agent-config-panel__message">{message}</div>}

      {profiles.length > 0 && (
        <section className="agent-config-panel__profiles">
          <HarnessPanel profiles={profiles} onSelect={onSelectProfile} />
        </section>
      )}
    </aside>
  )
}
