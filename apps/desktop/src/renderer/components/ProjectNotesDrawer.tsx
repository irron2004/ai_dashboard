import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { nextNoteLifecycle, type NextNote, type NextNoteLifecycle, type Task } from '@apc/shared'
import { api } from '../api.js'

type Props = {
  projectId: string
  initialNotes?: NextNote[]
  focusInput?: boolean
  onClose: () => void
  onChanged?: () => void
  onOpenTask?: (task: Task) => void
}

const FILTERS: Array<{ value: NextNoteLifecycle; label: string }> = [
  { value: 'active', label: '진행 중' },
  { value: 'completed', label: '완료' },
  { value: 'archived', label: '보관됨' },
]

function sortNotes(notes: NextNote[]): NextNote[] {
  const unique = new Map(notes.map((note) => [note.id, note]))
  return [...unique.values()].sort((left, right) => {
    const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    if (pinned !== 0) return pinned
    return (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt)
  })
}

function reasonText(reason: string | undefined): string {
  if (reason === 'empty-text') return '메모 내용을 입력해 주세요.'
  if (reason === 'note-not-found') return '메모를 찾을 수 없습니다.'
  if (reason === 'project-mismatch') return '다른 프로젝트의 메모는 변경할 수 없습니다.'
  if (reason === 'already-converted-task-deleted') return '이미 Task로 전환된 메모이며, 해당 Task는 삭제되었습니다.'
  return reason ? `요청이 거부되었습니다: ${reason}` : '요청을 처리하지 못했습니다.'
}

export function ProjectNotesDrawer({ projectId, initialNotes = [], focusInput = false, onClose, onChanged, onOpenTask }: Props) {
  const [notes, setNotes] = useState<NextNote[]>(() => sortNotes(initialNotes))
  const [filter, setFilter] = useState<NextNoteLifecycle>('active')
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [convertedTask, setConvertedTask] = useState<Task | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.nextNotesList({ projectId, includeCompleted: true, includeArchived: true })
      if (!result.ok) {
        setError(reasonText(result.reason))
        return
      }
      setNotes(sortNotes(result.notes ?? []))
    } catch {
      setError('메모를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (focusInput) inputRef.current?.focus() }, [focusInput])

  const counts = useMemo(() => ({
    active: notes.filter((note) => nextNoteLifecycle(note) === 'active').length,
    completed: notes.filter((note) => nextNoteLifecycle(note) === 'completed').length,
    archived: notes.filter((note) => nextNoteLifecycle(note) === 'archived').length,
  }), [notes])
  const visibleNotes = useMemo(
    () => notes.filter((note) => nextNoteLifecycle(note) === filter),
    [filter, notes],
  )

  const replaceNote = (note: NextNote) => setNotes((current) => sortNotes([note, ...current.filter((item) => item.id !== note.id)]))
  const changed = () => onChanged?.()

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) {
      setError('메모 내용을 입력해 주세요.')
      return
    }
    setAdding(true)
    setError(null)
    try {
      const result = await api.nextNoteAdd({ projectId, text })
      if (!result.ok || !result.note) {
        setError(reasonText(result.reason))
        return
      }
      replaceNote(result.note)
      setDraft('')
      setFilter('active')
      changed()
      inputRef.current?.focus()
    } catch {
      setError('메모를 추가하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.')
    } finally {
      setAdding(false)
    }
  }

  const edit = async (note: NextNote) => {
    const text = editingText.trim()
    if (!text) {
      setError('메모 내용을 입력해 주세요.')
      return
    }
    setBusyId(note.id)
    setError(null)
    try {
      const result = await api.nextNoteUpdate({ projectId, noteId: note.id, text })
      if (!result.ok || !result.note) {
        setError(reasonText(result.reason))
        return
      }
      replaceNote(result.note)
      setEditingId(null)
      changed()
    } catch {
      setError('메모를 수정하지 못했습니다. 입력값을 유지한 채 다시 시도할 수 있습니다.')
    } finally {
      setBusyId(null)
    }
  }

  const setPinned = async (note: NextNote) => {
    setBusyId(note.id)
    setError(null)
    try {
      const result = await api.nextNoteSetPinned({ projectId, noteId: note.id, pinned: !note.pinned })
      if (!result.ok || !result.note) {
        setError(reasonText(result.reason))
        return
      }
      replaceNote(result.note)
      changed()
    } catch {
      setError('메모 고정 상태를 바꾸지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  const setLifecycle = async (note: NextNote, lifecycle: NextNoteLifecycle) => {
    setBusyId(note.id)
    setError(null)
    try {
      const result = await api.nextNoteSetLifecycle({ projectId, noteId: note.id, lifecycle })
      if (!result.ok || !result.note) {
        setError(reasonText(result.reason))
        return
      }
      replaceNote(result.note)
      changed()
    } catch {
      setError('메모 상태를 바꾸지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (note: NextNote) => {
    if (!window.confirm(`“${note.text}” 메모를 삭제할까요?`)) return
    setBusyId(note.id)
    setError(null)
    try {
      const result = await api.nextNoteDelete({ projectId, id: note.id })
      if (!result.ok) {
        setError(reasonText(result.reason))
        return
      }
      setNotes((current) => current.filter((item) => item.id !== note.id))
      changed()
    } catch {
      setError('메모를 삭제하지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  const convert = async (note: NextNote) => {
    setBusyId(note.id)
    setError(null)
    setConvertedTask(null)
    try {
      const result = await api.nextNoteConvertToTask({ projectId, noteId: note.id })
      if (!result.ok || !result.note || !result.task) {
        setError(reasonText(result.reason))
        return
      }
      replaceNote(result.note)
      setConvertedTask(result.task)
      changed()
    } catch {
      setError('메모를 Task로 전환하지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <aside className="project-notes" role="dialog" aria-modal="true" aria-label="프로젝트 메모">
      <header className="project-notes__header">
        <div>
          <h2>프로젝트 메모</h2>
          <p>Task와 구분되는 짧은 기록입니다.</p>
        </div>
        <button type="button" aria-label="프로젝트 메모 닫기" onClick={onClose}>×</button>
      </header>

      <form className="project-notes__add" onSubmit={add}>
        <input
          ref={inputRef}
          aria-label="새 프로젝트 메모"
          placeholder="메모를 입력하세요"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={adding}
        />
        <button type="submit" disabled={adding}>{adding ? '추가 중…' : '추가'}</button>
      </form>

      <nav className="project-notes__filters" aria-label="메모 상태 필터">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >{item.label} {counts[item.value]}</button>
        ))}
      </nav>

      {error && <p className="project-notes__error" role="alert">{error}</p>}
      {convertedTask && (
        <div className="project-notes__converted" role="status">
          <span>“{convertedTask.title}” Task를 만들었습니다.</span>
          {onOpenTask && <button type="button" onClick={() => onOpenTask(convertedTask)}>Task 열기</button>}
        </div>
      )}

      <div className="project-notes__list" aria-busy={loading}>
        {loading && notes.length === 0 ? (
          <p className="project-notes__empty">메모 불러오는 중…</p>
        ) : visibleNotes.length === 0 ? (
          <p className="project-notes__empty">이 상태의 메모가 없습니다.</p>
        ) : (
          <ul>
            {visibleNotes.map((note) => {
              const lifecycle = nextNoteLifecycle(note)
              const busy = busyId === note.id
              return (
                <li key={note.id} className={note.pinned ? 'project-notes__item project-notes__item--pinned' : 'project-notes__item'}>
                  {editingId === note.id ? (
                    <form className="project-notes__edit" onSubmit={(event) => { event.preventDefault(); void edit(note) }}>
                      <input aria-label={`${note.text} 메모 편집`} value={editingText} onChange={(event) => setEditingText(event.target.value)} disabled={busy} />
                      <button type="submit" disabled={busy}>저장</button>
                      <button type="button" onClick={() => setEditingId(null)} disabled={busy}>취소</button>
                    </form>
                  ) : (
                    <p className="project-notes__text">{note.pinned && <span aria-label="고정됨">📌</span>} {note.text}</p>
                  )}
                  <div className="project-notes__actions">
                    <button type="button" onClick={() => void setPinned(note)} disabled={busy}>{note.pinned ? '고정 해제' : '고정'}</button>
                    {editingId !== note.id && <button type="button" onClick={() => { setEditingId(note.id); setEditingText(note.text); setError(null) }} disabled={busy}>편집</button>}
                    {lifecycle === 'active' && <button type="button" onClick={() => void setLifecycle(note, 'completed')} disabled={busy}>완료</button>}
                    {lifecycle === 'completed' && <button type="button" onClick={() => void setLifecycle(note, 'active')} disabled={busy}>다시 진행</button>}
                    {lifecycle !== 'archived' && <button type="button" onClick={() => void setLifecycle(note, 'archived')} disabled={busy}>보관</button>}
                    {lifecycle === 'archived' && <button type="button" onClick={() => void setLifecycle(note, note.done ? 'completed' : 'active')} disabled={busy}>복원</button>}
                    {lifecycle === 'active' && <button type="button" onClick={() => void convert(note)} disabled={busy || Boolean(note.convertedTaskId)}>{note.convertedTaskId ? '전환됨' : 'Task로 전환'}</button>}
                    <button type="button" className="project-notes__delete" onClick={() => void remove(note)} disabled={busy}>삭제</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
