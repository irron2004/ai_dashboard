import { createHash, randomUUID } from 'node:crypto'
import {
  GateEventSchema,
  RetroQuestionSchema,
  RetroSchema,
  RetroTargetSchema,
  type GateEvent,
  type Retro,
  type RetroQuestion,
  type RetroTarget,
} from '@apc/shared'
import type { Db } from '@apc/core'

type RetroRow = { id: string; date: string; started_at: string; completed_at: string | null }
type TargetRow = {
  id: string; retro_id: string; project_id: string; repo_path: string; branch: string | null
  prepared_head_sha: string; prepared_at: string; verification_evidence: string | null
  risk_notes: string | null; receipt_id: string | null
}
type QuestionRow = {
  id: string; retro_id: string; target_id: string | null; project_id: string | null; kind: string
  critical: number; text: string; answer: string | null; skipped: number; answered_at: string | null; seq: number
}
type EventRow = { id: string; repo_path: string; kind: string; reason: string; ts: string }

function toRetro(row: RetroRow): Retro {
  return RetroSchema.parse({ id: row.id, date: row.date, startedAt: row.started_at, completedAt: row.completed_at ?? undefined })
}

function toTarget(row: TargetRow): RetroTarget {
  return RetroTargetSchema.parse({
    id: row.id, retroId: row.retro_id, projectId: row.project_id, repoPath: row.repo_path,
    branch: row.branch ?? undefined, preparedHeadSha: row.prepared_head_sha, preparedAt: row.prepared_at,
    verificationEvidence: row.verification_evidence ?? undefined,
    riskNotes: row.risk_notes ?? undefined, receiptId: row.receipt_id ?? undefined,
  })
}

function toQuestion(row: QuestionRow): RetroQuestion {
  return RetroQuestionSchema.parse({
    id: row.id, retroId: row.retro_id, targetId: row.target_id ?? undefined,
    projectId: row.project_id ?? undefined, kind: row.kind, critical: row.critical === 1,
    text: row.text, answer: row.answer ?? undefined, skipped: row.skipped === 1,
    answeredAt: row.answered_at ?? undefined,
  })
}

function targetId(retroId: string, projectId: string, repoPath: string): string {
  const key = createHash('sha256').update(`${retroId}\0${projectId}\0${repoPath}`).digest('hex').slice(0, 20)
  return `rt:${key}`
}

export class RetroStore {
  constructor(private readonly db: Db) {}

  openForDate(date: string, now = new Date().toISOString()): Retro {
    const existing = this.getByDate(date)
    if (existing) return existing
    const retro = RetroSchema.parse({ id: `retro:${date}`, date, startedAt: now })
    this.db.prepare('INSERT INTO retros (id, date, started_at) VALUES (?, ?, ?)').run(retro.id, retro.date, retro.startedAt)
    return retro
  }

  getByDate(date: string): Retro | null {
    const row = this.db.prepare('SELECT * FROM retros WHERE date = ?').get(date) as RetroRow | undefined
    return row ? toRetro(row) : null
  }

  getById(id: string): Retro | null {
    const row = this.db.prepare('SELECT * FROM retros WHERE id = ?').get(id) as RetroRow | undefined
    return row ? toRetro(row) : null
  }

  prepareTarget(input: Omit<RetroTarget, 'id' | 'verificationEvidence' | 'riskNotes' | 'receiptId'>): { target: RetroTarget; reset: boolean } {
    const id = targetId(input.retroId, input.projectId, input.repoPath)
    const existing = this.getTarget(id)
    if (!existing) {
      const target = RetroTargetSchema.parse({ ...input, id })
      this.db.prepare(`
        INSERT INTO retro_targets (id, retro_id, project_id, repo_path, branch, prepared_head_sha, prepared_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(target.id, target.retroId, target.projectId, target.repoPath, target.branch ?? null, target.preparedHeadSha, target.preparedAt)
      this.db.prepare('UPDATE retros SET completed_at = NULL WHERE id = ?').run(target.retroId)
      return { target, reset: false }
    }

    const reset = existing.preparedHeadSha !== input.preparedHeadSha || existing.branch !== input.branch
    if (reset) {
      this.db.prepare(`
        UPDATE retro_targets
        SET branch = ?, prepared_head_sha = ?, prepared_at = ?, verification_evidence = NULL,
            risk_notes = NULL, receipt_id = NULL
        WHERE id = ?
      `).run(input.branch ?? null, input.preparedHeadSha, input.preparedAt, id)
      this.db.prepare(`
        UPDATE retro_questions SET answer = NULL, skipped = 0, answered_at = NULL WHERE target_id = ?
      `).run(id)
      this.db.prepare('UPDATE retros SET completed_at = NULL WHERE id = ?').run(input.retroId)
    }
    return { target: this.getTarget(id)!, reset }
  }

  getTarget(id: string): RetroTarget | null {
    const row = this.db.prepare('SELECT * FROM retro_targets WHERE id = ?').get(id) as TargetRow | undefined
    return row ? toTarget(row) : null
  }

  listTargets(retroId: string): RetroTarget[] {
    return (this.db.prepare('SELECT * FROM retro_targets WHERE retro_id = ? ORDER BY project_id, repo_path').all(retroId) as TargetRow[]).map(toTarget)
  }

  seedTargetQuestions(target: RetroTarget, questions: Array<{ text: string; critical: boolean }>): RetroQuestion[] {
    const existing = this.listQuestions(target.retroId).filter((question) => question.targetId === target.id)
    if (existing.length > 0) return existing
    const insert = this.db.prepare(`
      INSERT INTO retro_questions (id, retro_id, target_id, project_id, kind, critical, text, seq)
      VALUES (?, ?, ?, ?, 'template', ?, ?, ?)
    `)
    questions.forEach((question, seq) => {
      insert.run(`rq:${target.id}:${seq}`, target.retroId, target.id, target.projectId, question.critical ? 1 : 0, question.text, seq)
    })
    return this.listQuestions(target.retroId).filter((question) => question.targetId === target.id)
  }

  seedClosingQuestions(retroId: string, questions: Array<{ text: string; critical: boolean }>): RetroQuestion[] {
    const existing = this.listQuestions(retroId).filter((question) => !question.targetId)
    if (existing.length > 0) return existing
    const insert = this.db.prepare(`
      INSERT INTO retro_questions (id, retro_id, kind, critical, text, seq)
      VALUES (?, ?, 'closing', ?, ?, ?)
    `)
    questions.forEach((question, seq) => insert.run(`rq:${retroId}:closing:${seq}`, retroId, question.critical ? 1 : 0, question.text, seq))
    return this.listQuestions(retroId).filter((question) => !question.targetId)
  }

  listQuestions(retroId: string): RetroQuestion[] {
    return (this.db.prepare(`
      SELECT * FROM retro_questions WHERE retro_id = ?
      ORDER BY CASE WHEN target_id IS NULL THEN 1 ELSE 0 END, project_id, seq
    `).all(retroId) as QuestionRow[]).map(toQuestion)
  }

  answer(questionId: string, answer: string | null, skipped: boolean, now = new Date().toISOString()): boolean {
    const row = this.db.prepare(`
      SELECT q.critical, q.target_id, t.receipt_id
      FROM retro_questions q
      LEFT JOIN retro_targets t ON t.id = q.target_id
      WHERE q.id = ?
    `).get(questionId) as { critical: number; target_id: string | null; receipt_id: string | null } | undefined
    if (!row || (row.target_id && row.receipt_id)) return false
    const allowSkip = skipped && row.critical !== 1
    const text = allowSkip ? null : answer?.trim() || null
    this.db.prepare('UPDATE retro_questions SET answer = ?, skipped = ?, answered_at = ? WHERE id = ?')
      .run(text, allowSkip ? 1 : 0, text || allowSkip ? now : null, questionId)
    return true
  }

  unansweredCritical(targetId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM retro_questions
      WHERE target_id = ? AND critical = 1 AND (answer IS NULL OR answer = '')
    `).get(targetId) as { n: number }
    return row.n
  }

  closingComplete(retroId: string): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM retro_questions
      WHERE retro_id = ? AND target_id IS NULL AND (answer IS NULL OR answer = '') AND skipped = 0
    `).get(retroId) as { n: number }
    return row.n === 0
  }

  setTargetReviewNotes(targetIdValue: string, verificationEvidence: string, riskNotes: string): void {
    this.db.prepare('UPDATE retro_targets SET verification_evidence = ?, risk_notes = ? WHERE id = ?')
      .run(verificationEvidence.trim() || null, riskNotes.trim() || null, targetIdValue)
  }

  markTargetReceipted(targetIdValue: string, receiptId: string): void {
    this.db.prepare('UPDATE retro_targets SET receipt_id = ? WHERE id = ?').run(receiptId, targetIdValue)
  }

  markComplete(retroId: string, now = new Date().toISOString()): void {
    this.db.prepare('UPDATE retros SET completed_at = ? WHERE id = ?').run(now, retroId)
  }

  recordGateEvent(input: Omit<GateEvent, 'id'>): GateEvent {
    const event = GateEventSchema.parse({ ...input, id: `gate:${randomUUID()}` })
    this.db.prepare('INSERT INTO gate_events (id, repo_path, kind, reason, ts) VALUES (?, ?, ?, ?, ?)')
      .run(event.id, event.repoPath, event.kind, event.reason, event.ts)
    return event
  }

  listGateEvents(limit = 50): GateEvent[] {
    return (this.db.prepare('SELECT * FROM gate_events ORDER BY ts DESC LIMIT ?').all(limit) as EventRow[]).map((row) => GateEventSchema.parse({
      id: row.id, repoPath: row.repo_path, kind: row.kind, reason: row.reason, ts: row.ts,
    }))
  }
}
