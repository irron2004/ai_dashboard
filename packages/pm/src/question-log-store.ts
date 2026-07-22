import type { Db } from '@apc/core'
import { isHumanQuestionText, type NormalizedSession, type QuestionLogEntry } from '@apc/shared'

type Row = { session_id: string; project_id: string; ts: string; agent: string; text: string }

/** Chronological log of user prompts, derived at ingest. `turn_fts` (search-index) ranks but can't
 *  order by time, so this sidecar powers the "질문 히스토리" timeline. */
export class QuestionLogStore {
  constructor(private readonly db: Db) {}

  /** Idempotent per session: DELETE this session's rows then re-insert its user turns. Mirrors
   *  SearchIndex.indexSession — safe to re-run on every re-ingest (derived data, no user-owned fields). */
  record(session: NormalizedSession): void {
    this.db.prepare('DELETE FROM question_log WHERE session_id = ?').run(session.id)
    const projectId = session.projectId ?? ''
    if (!projectId) return
    const ins = this.db.prepare(
      'INSERT INTO question_log (session_id, project_id, ts, agent, text) VALUES (?, ?, ?, ?, ?)',
    )
    for (const t of session.turns) {
      if (t.role !== 'user' || !isHumanQuestionText(t.text)) continue
      const ts = t.timestamp ?? session.startedAt ?? session.endedAt ?? ''
      ins.run(session.id, projectId, ts, session.agentType, t.text)
    }
  }

  listRecent(opts: { projectId?: string; limit?: number } = {}): QuestionLogEntry[] {
    const limit = Math.max(0, opts.limit ?? 50)
    const scanLimit = limit * 4
    const rows = (opts.projectId
      ? this.db.prepare('SELECT * FROM question_log WHERE project_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?').all(opts.projectId, scanLimit)
      : this.db.prepare('SELECT * FROM question_log ORDER BY ts DESC, rowid DESC LIMIT ?').all(scanLimit)) as Row[]
    return rows.map((r) => ({
      projectId: r.project_id, sessionId: r.session_id, ts: r.ts,
      agent: r.agent as QuestionLogEntry['agent'], text: r.text,
    })).filter((r) => isHumanQuestionText(r.text)).slice(0, limit)
  }

  latestForSession(sessionId: string): QuestionLogEntry | undefined {
    return this.latestWhere('session_id = ?', sessionId)
  }

  latestByProject(projectId: string): QuestionLogEntry | undefined {
    return this.latestWhere('project_id = ?', projectId)
  }

  private latestWhere(clause: string, value: string): QuestionLogEntry | undefined {
    const rows = this.db.prepare(
      `SELECT * FROM question_log WHERE ${clause} ORDER BY ts DESC, rowid DESC LIMIT 64`,
    ).all(value) as Row[]
    const row = rows.find((candidate) => isHumanQuestionText(candidate.text))
    return row ? {
      projectId: row.project_id,
      sessionId: row.session_id,
      ts: row.ts,
      agent: row.agent as QuestionLogEntry['agent'],
      text: row.text,
    } : undefined
  }
}
