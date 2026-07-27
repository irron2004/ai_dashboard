import { useEffect, useState, type FormEvent } from 'react'
import type { Task, TaskStatus } from '@apc/shared'
import { api } from '../api.js'

export type TaskChangeKind = 'created' | 'updated' | 'deleted'

type Props = {
  projectId: string
  task?: Task
  fileManaged?: boolean
  onClose: () => void
  onChanged?: (task: Task, kind: TaskChangeKind) => void
}

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: '할 일' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'review', label: '리뷰' },
  { value: 'done', label: '완료' },
  { value: 'rejected', label: '제외' },
]

const PRIORITY_OPTIONS: Array<{ value: Task['priority']; label: string }> = [
  { value: 'high', label: '높음' },
  { value: 'medium', label: '보통' },
  { value: 'low', label: '낮음' },
]

function reasonText(reason: string | undefined): string {
  if (reason === 'empty-title') return '제목을 입력해 주세요.'
  if (reason === 'invalid-due-date') return '마감일 형식을 확인해 주세요.'
  if (reason === 'project-not-found') return '프로젝트를 찾을 수 없습니다.'
  if (reason === 'task-not-found') return 'Task를 찾을 수 없습니다.'
  if (reason === 'project-mismatch') return '다른 프로젝트의 Task는 변경할 수 없습니다.'
  if (reason === 'unsupported-status') return 'next.yml 프로젝트에서는 할 일·진행 중·완료 상태만 사용할 수 있습니다.'
  if (reason === 'proposal-conflict') return 'next.yml이 외부에서 변경되었습니다. 제안을 검토한 뒤 다시 시도해 주세요.'
  if (reason === 'career-pii-detected') return '개인정보 안전 검사를 통과하지 못해 제안을 만들지 않았습니다.'
  return reason ? `요청이 거부되었습니다: ${reason}` : '요청을 처리하지 못했습니다.'
}

export function TaskEditorDialog({ projectId, task, fileManaged = false, onClose, onChanged }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo')
  const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTitle(task?.title ?? '')
    setStatus(task?.status ?? 'todo')
    setPriority(task?.priority ?? 'medium')
    setDueDate(task?.dueDate ?? '')
    setError(null)
  }, [task])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      setError('제목을 입력해 주세요.')
      return
    }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError('마감일 형식을 확인해 주세요.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = task
        ? await api.taskUpdate({
            projectId,
            taskId: task.id,
            title: normalizedTitle,
            status,
            priority,
            dueDate: dueDate || undefined,
          })
        : await api.taskCreate({
            projectId,
            title: normalizedTitle,
            status,
            priority,
            dueDate: dueDate || undefined,
          })
      if (!result.ok || !result.task) {
        setError(reasonText(result.reason))
        return
      }
      onChanged?.(result.task, task ? 'updated' : 'created')
      onClose()
    } catch {
      setError('Task를 저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!task || !window.confirm(`“${task.title}” Task를 삭제할까요?`)) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.taskDelete({ projectId, taskId: task.id })
      if (!result.ok || !result.task) {
        setError(reasonText(result.reason))
        return
      }
      onChanged?.(result.task, 'deleted')
      onClose()
    } catch {
      setError('Task를 삭제하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pm-task-editor" role="dialog" aria-modal="true" aria-label={task ? 'Task 편집' : '새 Task'}>
      <form className="pm-task-editor__panel" onSubmit={submit}>
        <header className="pm-task-editor__header">
          <h2>{task ? 'Task 편집' : '새 Task'}</h2>
          <button type="button" aria-label="Task 편집기 닫기" onClick={onClose} disabled={busy}>×</button>
        </header>

        <label>
          제목
          <input
            autoFocus
            aria-label="Task 제목"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
        </label>
        <div className="pm-task-editor__fields">
          <label>
            상태
            <select aria-label="Task 상태" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)} disabled={busy}>
              {STATUS_OPTIONS
                .filter((option) => !fileManaged || !['review', 'rejected'].includes(option.value))
                .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            우선순위
            <select aria-label="Task 우선순위" value={priority} onChange={(event) => setPriority(event.target.value as Task['priority'])} disabled={busy}>
              {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            마감일
            <input type="date" aria-label="Task 마감일" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={busy} />
          </label>
        </div>

        {error && <p className="pm-task-editor__error" role="alert">{error}</p>}
        <footer className="pm-task-editor__actions">
          {task && <button type="button" className="pm-task-editor__delete" onClick={remove} disabled={busy}>삭제</button>}
          <span />
          <button type="button" onClick={onClose} disabled={busy}>취소</button>
          <button type="submit" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
        </footer>
      </form>
    </div>
  )
}
