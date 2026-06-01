import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  AgentSourceSchema,
  NormalizedSessionSchema,
  type AgentSource,
  type NormalizedSession,
  type NormalizedTurn,
  type SourceCursor,
} from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'

type SessionRow = {
  id: string
  worktree: string | null
  agent: string | null
  model: string | null
  time_created: number | null
  time_updated: number | null
}

type MessagePartRow = {
  message_id: string
  role: string
  message_data: string | null
  part_data: string | null
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function parseJsonObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    return objectValue(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function textFromPart(raw: string | null): string {
  const data = parseJsonObject(raw)
  if (!data) return ''
  const text = stringValue(data.text)
  if (text) return text
  const content = stringValue(data.content)
  return content ?? ''
}

function isoFromUnix(value: number | null): string | undefined {
  if (value === null) return undefined
  const millis = value < 10_000_000_000 ? value * 1000 : value
  return new Date(millis).toISOString()
}

function sourceSessionId(source: AgentSource): string {
  const marker = '#session:'
  const index = source.locator.lastIndexOf(marker)
  return index === -1 ? source.id.replace(/^opencode:/, '') : source.locator.slice(index + marker.length)
}

export class OpenCodeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'opencode' as const

  constructor(private readonly dbPath: string = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')) {}

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    if (!existsSync(this.dbPath)) return []

    const db = new DatabaseSync(this.dbPath, { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT session.id, project.worktree, session.agent, session.model,
                  session.time_created, session.time_updated
             FROM session
             LEFT JOIN project ON project.id = session.project_id
             ORDER BY session.time_updated, session.id`,
        )
        .all() as SessionRow[]

      const sources: AgentSource[] = []
      for (const row of rows) {
        const sourceId = `opencode:${row.id}`
        const timeUpdated = row.time_updated ?? 0
        const cursor = cursorFor(sourceId)
        if (cursor) {
          const position = parseJsonObject(cursor.position)
          if (numberValue(position?.timeUpdated) === timeUpdated) continue
        }

        sources.push(
          AgentSourceSchema.parse({
            id: sourceId,
            agentKind: 'opencode',
            kind: 'sqlite-session',
            locator: `${this.dbPath}#session:${row.id}`,
            repoPath: row.worktree ?? undefined,
          }),
        )
      }
      return sources
    } finally {
      db.close()
    }
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const sessionId = sourceSessionId(source)
    const db = new DatabaseSync(this.dbPath, { readOnly: true })
    try {
      const sessionRow = db
        .prepare(
          `SELECT session.id, project.worktree, session.agent, session.model,
                  session.time_created, session.time_updated
             FROM session
             LEFT JOIN project ON project.id = session.project_id
             WHERE session.id = ?`,
        )
        .get(sessionId) as SessionRow | undefined
      if (!sessionRow) throw new Error(`OpenCode session not found: ${sessionId}`)

      const rows = db
        .prepare(
          `SELECT message.id AS message_id, message.role, message.data AS message_data,
                  part.data AS part_data
             FROM message
             LEFT JOIN part ON part.message_id = message.id
             WHERE message.session_id = ?
             ORDER BY message.id, part.id`,
        )
        .all(sessionId) as MessagePartRow[]

      const turns = new Map<string, NormalizedTurn>()
      for (const row of rows) {
        const messageData = parseJsonObject(row.message_data)
        const timestamp = stringValue(messageData?.timestamp)
        const existing = turns.get(row.message_id)
        const turn = existing ?? {
          role: row.role === 'assistant' || row.role === 'system' || row.role === 'tool' ? row.role : 'user',
          text: '',
          timestamp,
          toolCalls: [],
        }
        const partText = textFromPart(row.part_data)
        if (partText) turn.text = turn.text ? `${turn.text}\n${redact(partText)}` : redact(partText)
        turns.set(row.message_id, turn)
      }

      const session = NormalizedSessionSchema.parse({
        id: sessionRow.id,
        agentType: 'opencode',
        repoPath: sessionRow.worktree ?? source.repoPath,
        startedAt: isoFromUnix(sessionRow.time_created),
        endedAt: isoFromUnix(sessionRow.time_updated),
        transcriptPath: source.locator,
        turns: [...turns.values()].filter((turn) => turn.text.length > 0),
        filesTouched: [],
      })
      return {
        session,
        position: JSON.stringify({ timeUpdated: sessionRow.time_updated ?? 0 }),
      }
    } finally {
      db.close()
    }
  }
}
