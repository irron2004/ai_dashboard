import { useState } from 'react'
import { taskSourceOf, type Task, type TaskStatus } from '@apc/shared'
import { unresolvedBlockers } from '@apc/dashboard-api'
import { api } from '../api.js'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: '할 일' },
  { status: 'in_progress', label: '진행 중' },
  { status: 'review', label: '리뷰' },
  { status: 'done', label: '완료' },
]

type Props = {
  tasks: Task[]
  onSetBlockedBy?: (taskId: string, blockedBy: string[]) => void
  onComposeTask?: (taskId: string) => void
  onRunTask?: (taskId: string) => void
  onOpenTask?: (task: Task) => void
  onChanged?: () => void
  singleBlocker?: boolean
}

const SOURCE_LABEL: Record<ReturnType<typeof taskSourceOf>, string> = {
  manual: '직접 생성',
  conversation: '대화 추출',
  note: '메모 전환',
  review: '리뷰 생성',
  system: '시스템',
}

export function TaskBoard({
  tasks,
  onSetBlockedBy,
  onComposeTask,
  onRunTask,
  onOpenTask,
  onChanged,
  singleBlocker = false,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [mutating, setMutating] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<{ taskId: string; message: string } | null>(null)
  const byId = new Map(tasks.map((t) => [t.id, t]))

  const complete = async (task: Task) => {
    setMutating(task.id)
    setMutationError(null)
    try {
      const result = await api.taskUpdate({
        projectId: task.projectId,
        taskId: task.id,
        title: task.title,
        status: 'done',
        priority: task.priority,
        dueDate: task.dueDate,
      })
      if (!result.ok) {
        setMutationError({ taskId: task.id, message: result.reason ?? '완료 상태를 저장하지 못했습니다.' })
        return
      }
      onChanged?.()
    } catch {
      setMutationError({ taskId: task.id, message: '완료 상태를 저장하지 못했습니다.' })
    } finally {
      setMutating(null)
    }
  }

  const remove = async (task: Task) => {
    if (!window.confirm(`“${task.title}” Task를 삭제할까요?`)) return
    setMutating(task.id)
    setMutationError(null)
    try {
      const result = await api.taskDelete({ projectId: task.projectId, taskId: task.id })
      if (!result.ok) {
        setMutationError({ taskId: task.id, message: result.reason ?? 'Task를 삭제하지 못했습니다.' })
        return
      }
      onChanged?.()
    } catch {
      setMutationError({ taskId: task.id, message: 'Task를 삭제하지 못했습니다.' })
    } finally {
      setMutating(null)
    }
  }

  return (
    <div className="pm-board">
      {COLUMNS.map(({ status, label }) => {
        const items = tasks.filter((t) => t.status === status)
        return (
          <div key={status} className="pm-board__col" data-testid={`col-${status}`}>
            <h3 className="pm-board__col-title">{label} <span className="pm-board__count">{items.length}</span></h3>
            {items.length === 0 ? (
              <p className="pm-board__empty">—</p>
            ) : (
              items.map((task) => {
                const blockers = unresolvedBlockers(task, byId)
                const composeDisabled = task.status === 'done' || task.status === 'rejected'
                const runDisabled = composeDisabled || task.status === 'review' || blockers.length > 0
                const busy = mutating === task.id
                return (
                  <div key={task.id} className="pm-board__card">
                    <span className="pm-board__card-title">{task.title}</span>
                    <span className="pm-board__provenance">
                      <span className={`pm-board__source pm-board__source--${taskSourceOf(task)}`}>출처: {SOURCE_LABEL[taskSourceOf(task)]}</span>
                      {task.userEditedAt && <span className="pm-board__edited">사용자 수정</span>}
                    </span>
                    <span className="pm-board__card-meta">
                      <span className={`pm-board__priority pm-board__priority--${task.priority}`}>{task.priority}</span>
                      {task.dueDate && <span className="pm-board__due">{task.dueDate}</span>}
                      {blockers.length > 0 && (
                        <span className="pm-board__blocked" title={`차단: ${blockers.map((b) => b.title).join(', ')}`}>🚫 차단</span>
                      )}
                      {onSetBlockedBy && (
                        <button
                          type="button" className="pm-board__dep-btn" aria-label={`의존성 편집 ${task.title}`}
                          onClick={() => setEditing((cur) => (cur === task.id ? null : task.id))}
                        >⛓</button>
                      )}
                    </span>
                    {(onComposeTask || onRunTask) && (
                      <span className="pm-board__card-actions">
                        {onComposeTask && (
                          <button
                            type="button"
                            className="pm-board__compose-btn"
                            aria-label={`${task.title} 컨텍스트 조립`}
                            disabled={composeDisabled}
                            title={composeDisabled ? '완료된 작업은 다시 조립할 수 없습니다' : undefined}
                            onClick={() => onComposeTask(task.id)}
                          >📋 조립</button>
                        )}
                        {onRunTask && (
                          <button
                            type="button"
                            className="pm-board__run-btn"
                            aria-label={`${task.title} Harness 실행`}
                            disabled={runDisabled}
                            title={blockers.length > 0 ? '차단 작업을 먼저 완료하세요' : runDisabled ? '진행 가능한 작업만 실행할 수 있습니다' : undefined}
                            onClick={() => onRunTask(task.id)}
                          >▶ Run</button>
                        )}
                      </span>
                    )}
                    {(onOpenTask || onChanged) && (
                      <span className="pm-board__manage-actions">
                        {onOpenTask && <button type="button" aria-label={`${task.title} 편집`} onClick={() => onOpenTask(task)} disabled={busy}>편집</button>}
                        {onChanged && task.status !== 'done' && task.status !== 'rejected' && (
                          <button type="button" aria-label={`${task.title} 완료`} onClick={() => void complete(task)} disabled={busy}>완료</button>
                        )}
                        {onChanged && <button type="button" aria-label={`${task.title} 삭제`} onClick={() => void remove(task)} disabled={busy}>삭제</button>}
                      </span>
                    )}
                    {mutationError?.taskId === task.id && <p className="pm-board__mutation-error" role="alert">{mutationError.message}</p>}
                    {onSetBlockedBy && editing === task.id && (
                      <select
                        multiple={!singleBlocker} className="pm-board__dep-select" aria-label={`차단 작업 선택 ${task.title}`}
                        value={singleBlocker ? (task.blockedBy[0] ?? '') : task.blockedBy}
                        onChange={(e) => onSetBlockedBy(
                          task.id,
                          Array.from(e.target.selectedOptions, (o) => o.value).filter(Boolean),
                        )}
                      >
                        {singleBlocker && <option value="">차단 없음</option>}
                        {tasks.filter((o) => o.id !== task.id).map((o) => (
                          <option key={o.id} value={o.id}>{o.title}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )
      })}
    </div>
  )
}
