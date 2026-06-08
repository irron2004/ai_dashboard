import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  AgentSourceSchema,
  NormalizedSessionSchema,
  SourceMetaSchema,
  type AgentSource,
  type NormalizedSession,
  type NormalizedTurn,
  type SourceCursor,
} from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'
import { folderPathFor } from './source-discovery.js'

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
  return new Date(timestampToMillis(value) ?? 0).toISOString()
}

function timestampToMillis(value: number | null): number | undefined {
  if (value === null) return undefined
  return Math.floor(value < 10_000_000_000 ? value * 1000 : value)
}

function sourceSessionId(source: AgentSource): string {
  const marker = '#session:'
  const index = source.locator.lastIndexOf(marker)
  return index === -1 ? source.id.replace(/^opencode:/, '') : source.locator.slice(index + marker.length)
}

export class OpenCodeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'opencode' as const

  constructor(private readonly roots: string | readonly string[] = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')) {}

  private resolveDbPaths(): string[] {
    const roots = Array.isArray(this.roots) ? this.roots : [this.roots]
    const out = new Set<string>()

    const walk = (root: string): void => {
      const abs = resolve(root)
      let st: import('node:fs').Stats
      try {
        st = statSync(abs)
      } catch {
        return
      }
      if (st.isFile()) {
        if (abs.endsWith('opencode.db')) out.add(abs)
        return
      }
      let entries: import('node:fs').Dirent[]
      try {
        entries = readdirSync(abs, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const child = join(abs, entry.name)
        if (entry.isDirectory()) walk(child)
        else if (entry.isFile() && entry.name === 'opencode.db') out.add(child)
      }
    }

    for (const root of roots) walk(root)
    return [...out].sort()
  }

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    const sources: AgentSource[] = []
    const discoveredAt = new Date().toISOString()
    for (const dbPath of this.resolveDbPaths()) {
      let db: DatabaseSync
      try {
        db = new DatabaseSync(dbPath, { readOnly: true })
      } catch {
        continue
      }
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

        for (const row of rows) {
          const sourceId = `opencode:${dbPath}#session:${row.id}`
          const timeUpdated = row.time_updated ?? 0
          const cursor = cursorFor(sourceId)
          if (cursor) {
            const position = parseJsonObject(cursor.position)
            if ((numberValue(position?.timeUpdated) ?? -1) >= timeUpdated) continue
          }

          sources.push(
            AgentSourceSchema.parse({
              id: sourceId,
              agentKind: 'opencode',
              kind: 'sqlite-session',
              locator: `${dbPath}#session:${row.id}`,
              sourceDirPath: folderPathFor(dbPath),
              discoveredAt,
              repoPath: row.worktree ?? undefined,
              mtimeMs: timestampToMillis(row.time_updated ?? row.time_created),
            }),
          )
        }
      } catch {
        continue
      } finally {
        db.close()
      }
    }
    return sources
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const sessionId = sourceSessionId(source)
    const dbPath = source.locator.split('#session:')[0]
    const db = new DatabaseSync(dbPath, { readOnly: true })
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
        sourceDirPath: source.sourceDirPath ?? dirname(dbPath),
        sourceMeta: SourceMetaSchema.parse({
          provider: 'opencode',
          sourceKind: 'sqlite-session',
          rawLocator: source.locator,
          sourceDirPath: source.sourceDirPath ?? dirname(dbPath),
          discoveredAt: source.discoveredAt,
          sessionHeader: {
            sessionId: sessionRow.id,
            agent: sessionRow.agent,
            model: sessionRow.model,
            timeCreated: sessionRow.time_created,
            timeUpdated: sessionRow.time_updated,
            dbPath,
            transcriptPath: source.locator,
          },
        }),
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
