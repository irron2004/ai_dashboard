import { useState } from 'react'
import type { AgentType } from '@apc/shared'
import {
  GATE_WIRING, GATE_WIRING_LABEL, HARNESS_FEATURE_GATES, STRUCTURE_STAGES, stageForState,
  type HarnessAgentPromptKey, type HarnessConfig, type HarnessFeatureGateKey, type StructureStageId,
} from '../harness-utils.js'

const ENGINES: AgentType[] = ['claude', 'opencode', 'codex']

type Props = {
  config: HarnessConfig
  /** 실행 중이면 현재 KhState (store.harnessProgress); 아니면 null. 해당 단계 카드를 하이라이트. */
  activeState: string | null
  onModelChange: (patch: Partial<HarnessConfig['model']>) => void
  onSafetyChange: (patch: Partial<HarnessConfig['safety']>) => void
  onToggleGate: (key: HarnessFeatureGateKey) => void
  onPromptChange: (key: HarnessAgentPromptKey, value: string) => void
  onClose: () => void
}

/** 하니스 구조도가 곧 설정 화면 — 파이프라인 단계를 실행 순서대로 보여주고,
 *  단계 카드를 클릭하면 그 단계의 프롬프트/모델(에이전트) 또는 safety/게이트(정책)를 편집한다. */
export function HarnessStructurePanel({ config, activeState, onModelChange, onSafetyChange, onToggleGate, onPromptChange, onClose }: Props) {
  const [selected, setSelected] = useState<StructureStageId | null>(null)
  const nowStage = activeState ? stageForState(activeState as Parameters<typeof stageForState>[0]) : null
  const stage = STRUCTURE_STAGES.find((s) => s.id === selected) ?? null

  return (
    <aside className="structure-panel panel">
      <header className="panel__header structure-panel__header">
        <h2>⚙ 에이전트 설정 — 하니스 구조</h2>
        <button type="button" onClick={onClose} aria-label="설정 닫기">✕</button>
      </header>

      <div className="structure-panel__pipe">
        {STRUCTURE_STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={[
              'structure-panel__card',
              `structure-panel__card--${s.kind}`,
              selected === s.id ? 'structure-panel__card--selected' : '',
              nowStage === s.id ? 'structure-panel__card--now' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setSelected(s.id)}
          >
            <span className="structure-panel__card-name">
              <span className="structure-panel__card-icon">{s.icon}</span>
              <span className="structure-panel__card-label">{s.name}</span>
              {s.kind === 'agent' && <em className="structure-panel__engine">{config.model.engine}</em>}
            </span>
            <span className="structure-panel__card-desc">{s.desc}</span>
          </button>
        ))}
      </div>

      {stage?.kind === 'agent' && stage.promptKey && (
        <div className="structure-panel__edit">
          <b>{stage.icon} {stage.name} 편집</b>
          <label>
            엔진
            <select aria-label="엔진" value={config.model.engine} onChange={(e) => onModelChange({ engine: e.target.value as AgentType })}>
              {ENGINES.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
            </select>
          </label>
          <label>
            프롬프트 오버라이드
            <textarea
              rows={4}
              value={config.prompts[stage.promptKey]}
              onChange={(e) => onPromptChange(stage.promptKey!, e.target.value)}
            />
          </label>
        </div>
      )}

      {stage?.kind === 'gate' && (
        <div className="structure-panel__edit">
          <b>🛡 정책 게이트</b>
          <label>
            스캔 민감도
            <select aria-label="스캔 민감도" value={config.safety.secretScanSensitivity} onChange={(e) => onSafetyChange({ secretScanSensitivity: e.target.value as HarnessConfig['safety']['secretScanSensitivity'] })}>
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
            </select>
          </label>
          <label>
            증거 요구 수준
            <select aria-label="증거 요구 수준" value={config.safety.evidenceRequirement} onChange={(e) => onSafetyChange({ evidenceRequirement: e.target.value as HarnessConfig['safety']['evidenceRequirement'] })}>
              <option value="balanced">balanced</option><option value="strict">strict</option>
            </select>
          </label>
          <ul className="structure-panel__gates">
            {HARNESS_FEATURE_GATES.map(({ key, label, description }) => {
              const wiring = GATE_WIRING[key]
              const editable = wiring === 'honored'
              return (
                <li key={key} title={description}>
                  <label>
                    <input type="checkbox" checked={config.featureGates[key]} disabled={!editable} onChange={() => onToggleGate(key)} />
                    {label}
                    <small>{GATE_WIRING_LABEL[wiring]}</small>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {stage?.kind === 'review' && (
        <div className="structure-panel__edit">
          <b>👤 인간 리뷰 / Promote</b>
          <p className="structure-panel__note">자동 쓰기는 staging vault까지만. 실제 vault 반영은 검수 화면의 Promote 버튼으로만 일어납니다.</p>
        </div>
      )}

      {stage?.kind === 'builtin' && (
        <div className="structure-panel__edit">
          <b>📥 수집 (materialize)</b>
          <p className="structure-panel__note">설정 없음 — 프로젝트 md와 최근 세션 Q&A를 모으는 내장 단계입니다. 모드(전체 문서/최근 세션)는 ▶ 위키 생성 드롭다운에서 고릅니다.</p>
        </div>
      )}
    </aside>
  )
}
