import type { AgentType } from '@apc/shared'
import type { AgentRunStatus } from '../store.js'

type Props = {
  agent: AgentType
  label?: string
  status: AgentRunStatus
  selected: boolean
  shortcut: number
  statusColor: string
  onStart: () => void
  onStop: () => void
  onSelect: () => void
  onRemove?: () => void
}

const STOPPABLE: AgentRunStatus[] = ['running', 'attention']

export function AgentDockHeader({ agent, label, status, selected, shortcut, statusColor, onStart, onStop, onSelect, onRemove }: Props) {
  const stoppable = STOPPABLE.includes(status)
  return (
    <div
      onClick={onSelect}
      title={`Shift+${shortcut}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        padding: '3px 8px', fontSize: '0.8rem', flex: '0 0 auto',
        background: selected ? '#23311f' : '#161616',
      }}
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
      <span style={{ fontWeight: selected ? 600 : 400 }}>{label ?? agent}</span>
      <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>⇧{shortcut}</span>
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
