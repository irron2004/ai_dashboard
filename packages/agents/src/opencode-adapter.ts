import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSourceSchema, NormalizedSessionSchema, type AgentSource, type NormalizedSession, type NormalizedTurn, type SourceCursor } from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'

const DEFAULT_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

export class OpenCodeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'opencode' as const
  constructor(private readonly dbPath: string = DEFAULT_DB) {}

  private open(): DatabaseSync {
    return new DatabaseSync(this.dbPath, { readOnly: true })
  }

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    let db: DatabaseSync
    try { db = this.open() } catch { return [] }
    try {
      const rows = db.prepare('SELECT id, time_updated FROM session ORDER BY time_updated').all() as
        { id: string; time_updated: number }[]
      const out: AgentSource[] = []
      for (const r of rows) {
        const id = `opencode:${r.id}`
        const cur = cursorFor(id)
        if (cur && (JSON.parse(cur.position).timeUpdated ?? -1) >= r.time_updated) continue
        out.push(AgentSourceSchema.parse({
          id, agentKind: 'opencode', kind: 'sqlite-session', locator: `${this.dbPath}#${r.id}`,
        }))
      }
      return out
    } finally { db.close() }
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const sessionId = source.locator.split('#')[1]
    const db = this.open()
    try {
      const s = db.prepare('SELECT id, project_id, time_updated FROM session WHERE id = ?').get(sessionId) as
        { id: string; project_id: string; time_updated: number } | undefined
      if (!s) throw new Error(`OpenCode session not found: ${sessionId}`)
      const proj = db.prepare('SELECT worktree FROM project WHERE id = ?').get(s.project_id) as
        { worktree: string } | undefined

      const messages = db.prepare('SELECT id, role FROM message WHERE session_id = ? ORDER BY id').all(sessionId) as
        { id: string; role: string }[]
      const partStmt = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY id')
      const turns: NormalizedTurn[] = []
      for (const m of messages) {
        const parts = partStmt.all(m.id) as { data: string }[]
        const text = parts.map((p) => {
          try { const d = JSON.parse(p.data); return typeof d.text === 'string' ? d.text : '' } catch { return '' }
        }).filter(Boolean).join('\n')
        const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : 'system'
        turns.push({ role, text: redact(text), toolCalls: [] })
      }

      const session = NormalizedSessionSchema.parse({
        id: s.id, agentType: 'opencode',
        repoPath: proj?.worktree, worktreePath: proj?.worktree,
        turns, filesTouched: [],
      })
      return { session, position: JSON.stringify({ timeUpdated: s.time_updated }) }
    } finally { db.close() }
  }
}
