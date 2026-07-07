import { useEffect, useState } from 'react'
import type { QuestionLogEntry } from '@apc/shared'

type Props = {
  open: boolean
  scope: string | null // projectId, or null for all projects
  fetchLog: (req: { projectId?: string; limit?: number }) => Promise<QuestionLogEntry[]>
  onClose: () => void
  onPick: (entry: QuestionLogEntry) => void
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function QuestionHistory({ open, scope, fetchLog, onClose, onPick }: Props) {
  const [rows, setRows] = useState<QuestionLogEntry[]>([])
  useEffect(() => {
    if (!open) return
    let alive = true
    void fetchLog(scope ? { projectId: scope } : {}).then((r) => { if (alive) setRows(r) })
    return () => { alive = false }
  }, [open, scope, fetchLog])

  if (!open) return null
  return (
    <div className="add-project-overlay" onClick={onClose}>
      <div className="add-project-dialog question-history" onClick={(e) => e.stopPropagation()}>
        <h2>질문 히스토리{scope ? ' (이 프로젝트)' : ' (전체)'}</h2>
        {rows.length === 0 ? <p className="question-history__empty">기록 없음</p> : (
          <ul className="question-history__list">
            {rows.map((r) => (
              <li key={`${r.sessionId}:${r.ts}:${r.text.slice(0, 12)}`}>
                <button type="button" onClick={() => onPick(r)}>
                  <span className="question-history__when">{hhmm(r.ts)}</span>
                  <span className="question-history__agent">[{r.agent}]</span>
                  <span className="question-history__text">{r.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="add-project-dialog__actions"><button type="button" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
