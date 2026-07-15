import { useState } from 'react'
import { WIKI_GENERATION_ENGINE, type WikiPolicyRecordDto } from '../../shared/ipc-contract.js'
import {
  GATE_WIRING, GATE_WIRING_LABEL, HARNESS_FEATURE_GATES, STRUCTURE_STAGES, stageForState,
  REASONING_EFFORTS, CODEX_SANDBOXES, CODEX_APPROVALS,
  type HarnessAgentPromptKey, type HarnessConfig, type HarnessFeatureGateKey, type StructureStageId,
} from '../harness-utils.js'

type Props = {
  config: HarnessConfig
  /** 실행 중이면 현재 KhState (store.harnessProgress); 아니면 null. 해당 단계 카드를 하이라이트. */
  activeState: string | null
  onModelChange: (patch: Partial<HarnessConfig['model']>) => void
  onSafetyChange: (patch: Partial<HarnessConfig['safety']>) => void
  onToggleGate: (key: HarnessFeatureGateKey) => void
  onPromptChange: (key: HarnessAgentPromptKey, value: string) => void
  onClose: () => void
  policy: WikiPolicyRecordDto | null
  policyPreview: string | null
  policyBusy: boolean
  onProposePolicy: () => void
  onApprovePolicy: () => void
  onRevertPolicy: () => void
}

/** 하니스 구조도가 곧 설정 화면 — 파이프라인 단계를 실행 순서대로 보여주고,
 *  단계 카드를 클릭하면 그 단계의 프롬프트/모델(에이전트) 또는 safety/게이트(정책)를 편집한다. */
export function HarnessStructurePanel({ config, activeState, onModelChange, onSafetyChange, onToggleGate, onPromptChange, onClose, policy, policyPreview, policyBusy, onProposePolicy, onApprovePolicy, onRevertPolicy }: Props) {
  const [selected, setSelected] = useState<StructureStageId | null>(null)
  const nowStage = activeState ? stageForState(activeState as Parameters<typeof stageForState>[0]) : null
  const stage = STRUCTURE_STAGES.find((s) => s.id === selected) ?? null

  return (
    <aside className="structure-panel panel">
      <header className="panel__header structure-panel__header">
        <h2>⚙ 에이전트 설정 — 하니스 구조</h2>
        <button type="button" onClick={onClose} aria-label="설정 닫기">✕</button>
      </header>

      <section className="structure-panel__policy">
        <h3>위키 정책 (프로젝트 맞춤)</h3>
        <p className="muted">거버넌스 규칙 1–8은 잠겨 있으며 변경되지 않습니다. advisor는 그 위에 프로젝트 맞춤 섹션만 제안합니다.</p>
        <div className="structure-panel__policy-actions">
          <button type="button" onClick={onProposePolicy} disabled={policyBusy}>
            {policyBusy ? '제안 생성 중…' : '✨ 정책 제안 받기'}
          </button>
          {policy?.status === 'proposed' && (
            <button type="button" onClick={onApprovePolicy}>승인</button>
          )}
          {policy && (
            <button type="button" onClick={onRevertPolicy}>기본값으로 되돌리기</button>
          )}
        </div>
        {policy && (
          <p className="structure-panel__policy-status">
            상태: {policy.status === 'approved' ? `승인됨${policy.approvedAt ? ` (${policy.approvedAt})` : ''}` : '제안됨 — 검토 필요'}
          </p>
        )}
        {policy && (policy.proposal.rationale || policy.proposal.evidence.length > 0) && (
          <div className="structure-panel__policy-why">
            {policy.proposal.rationale && <p><strong>근거:</strong> {policy.proposal.rationale}</p>}
            {policy.proposal.evidence.length > 0 && (
              <ul>
                {policy.proposal.evidence.map((e, i) => (
                  // signal can repeat (e.g. two 'topics' rows), so compose with the index for a stable+unique key
                  <li key={`${e.signal}-${i}`}><strong>{e.signal}</strong>{e.detail ? ` — ${e.detail}` : ''}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {policyPreview && (
          <details>
            <summary>합성된 effective preamble 미리보기</summary>
            <pre className="structure-panel__policy-preview">{policyPreview}</pre>
          </details>
        )}
      </section>

      <section className="structure-panel__engine-cfg">
        <h3>Codex 모델 / 권한 (하니스별)</h3>
        <p className="muted">위키 생성의 모든 에이전트 호출은 Codex로 고정됩니다. 모델을 비워두면 Codex 기본값을 씁니다.</p>
        <label>
          엔진
          <input aria-label="엔진" value={WIKI_GENERATION_ENGINE} readOnly disabled />
        </label>
        <label>
          모델 (예: gpt-5.5)
          <input
            aria-label="모델"
            type="text"
            value={config.model.model ?? ''}
            placeholder="엔진 기본값"
            onChange={(e) => onModelChange({ model: e.target.value })}
          />
        </label>
        <label>
          폴더 워커 동시 실행 (1 = 순차)
          <input
            aria-label="워커 동시 실행"
            type="number"
            min={1}
            max={16}
            value={config.model.workerConcurrency ?? 1}
            onChange={(e) => onModelChange({ workerConcurrency: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label>
          reasoning effort
          <select aria-label="reasoning effort" value={config.model.reasoningEffort ?? ''} onChange={(e) => onModelChange({ reasoningEffort: (e.target.value || undefined) as HarnessConfig['model']['reasoningEffort'] })}>
            <option value="">엔진 기본값</option>
            {REASONING_EFFORTS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>
          sandbox
          <select aria-label="sandbox" value={config.model.sandbox ?? ''} onChange={(e) => onModelChange({ sandbox: (e.target.value || undefined) as HarnessConfig['model']['sandbox'] })}>
            <option value="">엔진 기본값</option>
            {CODEX_SANDBOXES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          approval
          <select aria-label="approval" value={config.model.approval ?? ''} onChange={(e) => onModelChange({ approval: (e.target.value || undefined) as HarnessConfig['model']['approval'] })}>
            <option value="">엔진 기본값</option>
            {CODEX_APPROVALS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </section>

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
              {s.kind === 'agent' && <em className="structure-panel__engine">{WIKI_GENERATION_ENGINE}</em>}
            </span>
            <span className="structure-panel__card-desc">{s.desc}</span>
          </button>
        ))}
      </div>

      {stage?.kind === 'agent' && stage.promptKey && (
        <div className="structure-panel__edit">
          <b>{stage.icon} {stage.name} 편집</b>
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
