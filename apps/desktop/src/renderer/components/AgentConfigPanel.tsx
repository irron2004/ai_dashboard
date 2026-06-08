import type { AgentProfile, AgentType } from '@apc/shared'
import {
  HARNESS_AGENT_PROMPTS, HARNESS_FEATURE_GATES, GATE_WIRING, GATE_WIRING_LABEL, SHIPPED_GATE_VALUES,
  type HarnessConfig, type HarnessAgentPromptKey, type HarnessFeatureGateKey,
} from '../harness-utils.js'
import { HarnessPanel } from './HarnessPanel.js'

type Props = {
  config: HarnessConfig
  loading: boolean
  message: string | null
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
  onModelChange: (patch: Partial<HarnessConfig['model']>) => void
  onSafetyChange: (patch: Partial<HarnessConfig['safety']>) => void
  onToggleGate: (key: HarnessFeatureGateKey) => void
  onPromptChange: (key: HarnessAgentPromptKey, value: string) => void
  onRefresh: () => void
  onPromote: () => void
}

const ENGINE_OPTIONS: AgentType[] = ['claude', 'opencode', 'codex']

export function AgentConfigPanel({
  config, loading, message, profiles, onSelectProfile, onModelChange, onRefresh, onPromote,
}: Props) {
  // Honesty (C1/C2): only Engine reaches the run. Gates reflect the shipped policy read-only; temperature/
  // max-tokens/prompts/safety map to no backend knob in the MVP and are shown disabled + labeled.
  return (
    <aside className="panel agent-config-panel">
      <header className="panel__header agent-config-panel__header">
        <div>
          <h2>Agent Configuration</h2>
          <p>Engine selects the run backend. Other settings reflect the shipped harness policy and are read-only in the MVP.</p>
        </div>
      </header>

      <section className="agent-config-panel__section">
        <h3>Model Settings</h3>
        <label>
          <span>Engine</span>
          <select value={config.model.engine} onChange={(event) => onModelChange({ engine: event.target.value as AgentType })}>
            {ENGINE_OPTIONS.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
          </select>
        </label>
        <label className="agent-config-panel__disabled" title="Not wired in the MVP — the CLI agent backend exposes no temperature knob.">
          <span>Temperature: {config.model.temperature.toFixed(2)} <em>(not wired)</em></span>
          <input type="range" min="0" max="1" step="0.05" value={config.model.temperature} disabled readOnly />
        </label>
        <label className="agent-config-panel__disabled" title="Not wired in the MVP — the CLI agent backend exposes no max-tokens knob.">
          <span>Max tokens: {config.model.maxTokens} <em>(not wired)</em></span>
          <input type="number" value={config.model.maxTokens} disabled readOnly />
        </label>
      </section>

      <section className="agent-config-panel__section">
        <h3>Feature Gates</h3>
        <p className="agent-config-panel__note">
          Read-only — these reflect the shipped <code>harness/feature-gates.yml</code> policy. ALWAYS-ON safety
          checks and NOT-WIRED (P1) flags are not toggleable in the MVP; edit the YAML to change behavior.
        </p>
        <div className="agent-config-panel__gate-grid">
          {HARNESS_FEATURE_GATES.map((gate) => {
            const on = SHIPPED_GATE_VALUES[gate.key]
            const wiring = GATE_WIRING[gate.key]
            return (
              <div
                key={gate.key}
                className={`agent-config-panel__gate agent-config-panel__gate--readonly${on ? ' agent-config-panel__gate--on' : ''}`}
                title={`${gate.description} (${GATE_WIRING_LABEL[wiring]})`}
              >
                <span>{gate.label}</span>
                <small>{on ? 'on' : 'off'} · {GATE_WIRING_LABEL[wiring]}</small>
              </div>
            )
          })}
        </div>
      </section>

      <section className="agent-config-panel__section agent-config-panel__disabled">
        <h3>Agent Prompts <em>(not wired)</em></h3>
        <p className="agent-config-panel__note">The shipped <code>harness/harness-rules.md</code> preamble is used; per-run prompt overrides are a future feature.</p>
        <div className="agent-config-panel__prompts">
          {HARNESS_AGENT_PROMPTS.map((prompt) => (
            <label key={prompt.key} className="agent-config-panel__prompt">
              <span>{prompt.label}</span>
              <textarea value={config.prompts[prompt.key]} placeholder={prompt.hint} disabled readOnly />
            </label>
          ))}
        </div>
      </section>

      <section className="agent-config-panel__section agent-config-panel__disabled">
        <h3>Safety Settings <em>(not wired)</em></h3>
        <p className="agent-config-panel__note">Secret scan + evidence requirement are always-on with fixed behavior in the MVP.</p>
        <label>
          <span>Secret scan sensitivity</span>
          <select value={config.safety.secretScanSensitivity} disabled>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          <span>Evidence requirement</span>
          <select value={config.safety.evidenceRequirement} disabled>
            <option value="balanced">balanced</option>
            <option value="strict">strict</option>
          </select>
        </label>
      </section>

      <section className="agent-config-panel__actions">
        <button type="button" onClick={onRefresh} disabled={loading}>Refresh run</button>
        <button type="button" className="button button--accent" onClick={onPromote} disabled={loading}>Promote current</button>
      </section>

      {message && <div className="agent-config-panel__message">{message}</div>}

      {profiles.length > 0 && (
        <section className="agent-config-panel__profiles">
          <HarnessPanel profiles={profiles} onSelect={onSelectProfile} />
        </section>
      )}
    </aside>
  )
}
