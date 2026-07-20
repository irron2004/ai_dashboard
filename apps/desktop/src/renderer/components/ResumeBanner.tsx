import { useState } from 'react'
import type { ResumeCard } from '@apc/dashboard-api'
import type { AgentType } from '@apc/shared'
import type { Task } from '@apc/shared'
import { ProjectNotesDrawer } from './ProjectNotesDrawer.js'

type Props = {
  card: ResumeCard
  onDismiss: () => void
  onResume: (target: { agent: AgentType; sessionId: string }) => void
  onOpenHistory: () => void
  onAddNote: (text: string) => void
  onChanged?: () => void
  onOpenTask?: (task: Task) => void
}

export function ResumeBanner({ card, onDismiss, onResume, onOpenHistory, onAddNote, onChanged, onOpenTask }: Props) {
  const [draft, setDraft] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const submit = () => { const t = draft.trim(); if (t) { onAddNote(t); setDraft('') } }
  return (
    <div className="resume-banner" role="dialog" aria-label={`${card.project.name} 이어서`}>
      <div className="resume-banner__head">
        <span className="resume-banner__title">▶ {card.project.name} — 이어서</span>
        <button type="button" className="resume-banner__close" aria-label="닫기" onClick={onDismiss}>✕</button>
      </div>
      {card.lastSummary && <div className="resume-banner__row">지난번: {card.lastSummary}</div>}
      {card.lastQuestion && (
        <div className="resume-banner__row">마지막 Q <span className="resume-banner__agent">{card.lastQuestion.agent}</span>: “{card.lastQuestion.text}”</div>
      )}
      {card.nextNotes.length > 0 && (
        <div className="resume-banner__note-summary">
          <strong>프로젝트 메모</strong>
          <ul className="resume-banner__notes">
            {card.nextNotes.map((n) => <li key={n.id}>📌 {n.text}</li>)}
          </ul>
          <button type="button" onClick={() => setNotesOpen(true)}>프로젝트 메모 열기</button>
        </div>
      )}
      <div className="resume-banner__addnote">
        <input
          aria-label="프로젝트 메모 추가"
          placeholder="📌 프로젝트 메모…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        />
      </div>
      <div className="resume-banner__actions">
        {card.resumeTarget && (
          <button type="button" onClick={() => onResume(card.resumeTarget!)}>이어서 대화</button>
        )}
        <button type="button" onClick={onOpenHistory}>질문 히스토리</button>
      </div>
      {notesOpen && (
        <ProjectNotesDrawer
          projectId={card.project.id}
          initialNotes={card.nextNotes}
          onClose={() => setNotesOpen(false)}
          onChanged={onChanged}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  )
}
