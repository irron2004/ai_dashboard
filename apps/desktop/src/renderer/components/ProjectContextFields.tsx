import type { ProjectContextSource } from '@apc/shared'

export type ProjectContextField = 'goal' | 'currentFocus'

type Props = {
  goal: string
  currentFocus: string
  goalSource?: ProjectContextSource
  goalConfirmedAt?: string
  currentFocusSource?: ProjectContextSource
  currentFocusConfirmedAt?: string
  disabled?: boolean
  confirmingField?: ProjectContextField | null
  onGoalChange: (value: string) => void
  onCurrentFocusChange: (value: string) => void
  onConfirm?: (field: ProjectContextField) => void
}

export function projectContextProvenanceLabel(
  source: ProjectContextSource | undefined,
  confirmedAt: string | undefined,
): string | null {
  if (source === 'agent') return confirmedAt ? 'AI 제안 · 사용자 확정' : 'AI 제안'
  if (source === 'user') return '사용자 작성'
  return null
}

function Provenance({
  field, source, confirmedAt, disabled, confirming, onConfirm,
}: {
  field: ProjectContextField
  source?: ProjectContextSource
  confirmedAt?: string
  disabled: boolean
  confirming: boolean
  onConfirm?: (field: ProjectContextField) => void
}) {
  const label = projectContextProvenanceLabel(source, confirmedAt)
  if (!label) return null
  const fieldLabel = field === 'goal' ? '목표' : '현재 집중 항목'
  return (
    <span className={`project-context-fields__provenance project-context-fields__provenance--${source}`}>
      <span>{label}</span>
      {source === 'agent' && !confirmedAt && onConfirm && (
        <button
          type="button"
          onClick={() => onConfirm(field)}
          disabled={disabled || confirming}
          aria-label={`${fieldLabel} AI 제안 확정`}
        >
          {confirming ? '확정 중…' : '제안 확정'}
        </button>
      )}
    </span>
  )
}

export function ProjectContextFields({
  goal, currentFocus, goalSource, goalConfirmedAt, currentFocusSource, currentFocusConfirmedAt,
  disabled = false, confirmingField = null, onGoalChange, onCurrentFocusChange, onConfirm,
}: Props) {
  return (
    <fieldset className="project-context-fields" disabled={disabled}>
      <legend>프로젝트 컨텍스트</legend>
      <label>
        프로젝트 목표
        <textarea
          aria-label="프로젝트 목표"
          value={goal}
          onChange={(event) => onGoalChange(event.target.value)}
          disabled={disabled}
          placeholder="이 프로젝트에서 달성하려는 결과"
          rows={3}
        />
        <Provenance
          field="goal"
          source={goalSource}
          confirmedAt={goalConfirmedAt}
          disabled={disabled}
          confirming={confirmingField === 'goal'}
          onConfirm={onConfirm}
        />
      </label>
      <label>
        현재 집중 항목
        <input
          aria-label="현재 집중 항목"
          value={currentFocus}
          onChange={(event) => onCurrentFocusChange(event.target.value)}
          disabled={disabled}
          placeholder="지금 가장 먼저 끝낼 일"
        />
        <Provenance
          field="currentFocus"
          source={currentFocusSource}
          confirmedAt={currentFocusConfirmedAt}
          disabled={disabled}
          confirming={confirmingField === 'currentFocus'}
          onConfirm={onConfirm}
        />
      </label>
    </fieldset>
  )
}
