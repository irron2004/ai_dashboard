import type { AgentType } from '@apc/shared'
import type { AgentRunStatus } from '../store.js'

type Props = {
  agent: AgentType
  status: AgentRunStatus
  selected: boolean
  shortcut: number
  statusColor: string
  onStart: () => void
  onStop: () => void
  onSelect: () => void
}

const STOPPABLE: AgentRunStatus[] = ['running', 'attention']

export function AgentDockHeader({ agent, status, selected, shortcut, statusColor, onStart, onStop, onSelect }: Props) {
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
      <span style={{ fontWeight: selected ? 600 : 400 }}>{agent}</span>
      <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>⇧{shortcut}</span>
    </div>
  )
}
