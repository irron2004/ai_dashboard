import type { AgentQuestionSummary, AgentType } from '@apc/shared'
import type { AgentRunStatus } from '../store.js'
import './agent-activity.css'

type Props = {
  agent: AgentType
  label?: string
  status: AgentRunStatus
  selected: boolean
  shortcut: number
  statusColor: string
  question?: AgentQuestionSummary
  onStart: () => void
  onStop: () => void
  onSelect: () => void
  onRemove?: () => void
}

const STOPPABLE: AgentRunStatus[] = ['running', 'attention']

export type PresentedAgentQuestion = {
  summary: string
  detail?: string
}

/** Never exposes displayText when its privacy contract says it is masked or hidden. */
export function presentAgentQuestion(question: AgentQuestionSummary | undefined): PresentedAgentQuestion | null {
  if (!question) return null
  if (question.privacy === 'masked') return { summary: '[민감한 질문]', detail: '[민감한 질문]' }
  if (question.privacy === 'hidden') return { summary: '[질문 숨김]' }
  return { summary: `[${question.displayText}]`, detail: question.displayText }
}

export function AgentDockHeader({
  agent, label, status, selected, shortcut, statusColor, question,
  onStart, onStop, onSelect, onRemove,
}: Props) {
  const stoppable = STOPPABLE.includes(status)
  const presentedQuestion = presentAgentQuestion(question)
  return (
    <div
      className={`agent-dock-header${selected ? ' agent-dock-header--selected' : ''}`}
      onClick={onSelect}
      title={`Shift+${shortcut}`}
    >
      <button
        type="button"
        aria-label="에이전트 시작/재시작"
        onClick={(e) => { e.stopPropagation(); onStart() }}
        style={{ background: 'none', border: 'none', color: '#7bdc7b', cursor: 'pointer', padding: 0, fontSize: '0.85rem', lineHeight: 1 }}
      >▶</button>
      <button
        type="button"
        aria-label="에이전트 중지"
        disabled={!stoppable}
        onClick={(e) => { e.stopPropagation(); onStop() }}
        style={{ background: 'none', border: 'none', color: stoppable ? '#dc7b7b' : '#555', cursor: stoppable ? 'pointer' : 'default', padding: 0, fontSize: '0.85rem', lineHeight: 1 }}
      >⏹</button>
      <span style={{ color: statusColor, fontSize: '0.9rem', lineHeight: 1 }}>●</span>
      <span className="agent-dock-header__title">
        <span className="agent-dock-header__agent">{label ?? agent}</span>
        {presentedQuestion && (
          <span className="agent-dock-header__question" title={presentedQuestion.detail}>
            {presentedQuestion.summary}
          </span>
        )}
      </span>
      <span className="agent-dock-header__shortcut">⇧{shortcut}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`${label ?? agent} 에이전트 제거`}
          title="이 터미널 닫기"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          style={{
            width: 18, height: 18, padding: 0, display: 'grid', placeItems: 'center',
            background: 'transparent', border: 'none', borderRadius: 4, color: '#777',
            fontSize: '0.9rem', lineHeight: 1,
          }}
        >×</button>
      )}
    </div>
  )
}
