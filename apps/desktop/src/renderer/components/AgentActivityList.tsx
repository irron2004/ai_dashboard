import { deriveAgentActivityStatus, type AgentActivity, type AgentPaneIdentity } from '@apc/shared'
import { presentAgentQuestion } from './AgentDockHeader.js'
import './agent-activity.css'

const STATUS_LABEL = {
  working: '작업 중',
  awaiting_user: '응답 대기',
  idle: '유휴',
  error: '오류',
  disconnected: '연결 끊김',
} as const

type Props = {
  activities: readonly AgentActivity[]
  onSelectPane: (pane: AgentPaneIdentity) => void
  now?: string | number | Date
  emptyMessage?: string
}

function timestamp(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return Date.parse(value)
}

export function formatAgentActivityAge(value: string, now: string | number | Date = Date.now()): string {
  const thenMs = Date.parse(value)
  const nowMs = timestamp(now)
  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) return '시각 확인 불가'
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1_000))
  if (seconds < 5) return '방금 전'
  if (seconds < 60) return `${seconds}초 전`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

function pathBasename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || path
}

function agentLabel(agent: AgentPaneIdentity['agent']): string {
  if (agent === 'claude') return 'Claude'
  if (agent === 'codex') return 'Codex'
  return 'OpenCode'
}

export function AgentActivityList({ activities, onSelectPane, now = Date.now(), emptyMessage = '에이전트 활동이 없습니다.' }: Props) {
  if (activities.length === 0) return <div className="agent-activity-list__empty">{emptyMessage}</div>
  const sorted = [...activities].sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))

  return (
    <ul className="agent-activity-list" aria-label="에이전트 활동">
      {sorted.map((activity) => {
        const status = deriveAgentActivityStatus(activity)
        const age = formatAgentActivityAge(activity.lastActivityAt, now)
        const question = presentAgentQuestion(activity.lastQuestion)
        const secondary = activity.currentLabel
          ?? (activity.reason ? `최근 종료: ${activity.reason}` : '현재 작업 정보 없음')
        return (
          <li key={activity.pane.paneId}>
            <button
              type="button"
              className="agent-activity-row"
              onClick={() => onSelectPane(activity.pane)}
              aria-label={`${agentLabel(activity.pane.agent)} ${pathBasename(activity.pane.worktreePath)} ${activity.pane.slotId} 열기`}
            >
              <span className={`agent-activity-row__status agent-activity-row__status--${status}`}>
                {STATUS_LABEL[status]}
              </span>
              <span
                className={`agent-activity-row__process${activity.processAlive ? ' agent-activity-row__process--alive' : ''}`}
                aria-label={activity.processAlive ? '프로세스 실행 중' : '프로세스 종료'}
                title={activity.processAlive ? '프로세스 실행 중' : '프로세스 종료'}
              >●</span>
              <span className="agent-activity-row__identity">
                <strong>{agentLabel(activity.pane.agent)}</strong>
                <span title={activity.pane.worktreePath}>{pathBasename(activity.pane.worktreePath)} · {activity.pane.slotId}</span>
              </span>
              <span className="agent-activity-row__detail" title={secondary}>{secondary}</span>
              {question && <span className="agent-activity-row__question" title={question.detail}>{question.summary}</span>}
              <time className="agent-activity-row__time" dateTime={activity.lastActivityAt} title={activity.lastActivityAt}>
                마지막 활동 {age}
              </time>
              {activity.staleSince && (
                <span className="agent-activity-row__stale">마지막 활동 {age} · 중단 가능성</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
