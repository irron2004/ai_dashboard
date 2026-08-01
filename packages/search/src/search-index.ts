import type { DatabaseSync } from 'node:sqlite'
import type { NormalizedSession } from '@apc/shared'

const SESSION_URI_PATTERN = /^apc:\/\/session\/([^#]+)#turn-(\d+)$/

type LegacyRow = {
  session_id: string
  project_id: string
  role: string
  body: string
}

type V2Row = LegacyRow & {
  turn_id: string
  turn_ordinal: number | string
  timestamp: string
  raw_locator: string
}

type SearchRow = V2Row & {
  snip: string
  rank_value: number
}

export type SearchHit = {
  sessionId: string
  projectId: string
  turnId: string
  turnOrdinal: number
  role: string
  timestamp?: string
  uri: string
  snippet: string
  rawScore: number
}

export type SearchOptions = {
  projectId?: string
  projectIds?: string[]
  limit?: number
}

export type SessionTurnSource = {
  sessionId: string
  projectId: string
  turnId: string
  turnOrdinal: number
  role: string
  timestamp?: string
  rawLocator: string
  body: string
}

export type SessionTurnContext = {
  sessionId: string
  projectId: string
  selected: SessionTurnSource
  before: SessionTurnSource[]
  after: SessionTurnSource[]
}

export function buildSessionTurnUri(sessionId: string, turnOrdinal: number): string {
  if (!sessionId.trim()) throw new TypeError('sessionId must not be blank')
  if (!Number.isInteger(turnOrdinal) || turnOrdinal < 0) {
    throw new RangeError('turnOrdinal must be a non-negative integer')
  }
  return `apc://session/${encodeURIComponent(sessionId)}#turn-${turnOrdinal}`
}

export function parseSessionTurnUri(uri: string): { sessionId: string; turnOrdinal: number } | undefined {
  const match = SESSION_URI_PATTERN.exec(uri)
  if (!match) return undefined
  try {
    return { sessionId: decodeURIComponent(match[1]), turnOrdinal: Number(match[2]) }
  } catch {
    return undefined
  }
}

/** Convert a user-entered plain-text query into a literal FTS5 AND expression. */
export function buildPlainTextFtsQuery(input: string): string | undefined {
  const tokens = input.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? []
  const uniqueTokens = [...new Set(tokens)]
  if (uniqueTokens.length === 0) return undefined
  return uniqueTokens.map((token) => `"${token}"`).join(' AND ')
}

function sameLegacyContent(legacy: LegacyRow[], v2: V2Row[]): boolean {
  if (legacy.length !== v2.length) return false
  return legacy.every((row, index) => {
    const other = v2[index]
    return row.session_id === other.session_id
      && row.project_id === other.project_id
      && row.role === other.role
      && row.body === other.body
  })
}

export class SearchIndex {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts
        USING fts5(session_id, project_id, role, body);

      CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts_v2 USING fts5(
        session_id UNINDEXED,
        project_id UNINDEXED,
        turn_id UNINDEXED,
        turn_ordinal UNINDEXED,
        role UNINDEXED,
        timestamp UNINDEXED,
        raw_locator UNINDEXED,
        body
      );

      CREATE TABLE IF NOT EXISTS search_index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    this.migrateLegacyIndex()
  }

  private transaction<T>(operation: () => T): T {
    let begun = false
    try {
      this.db.exec('BEGIN IMMEDIATE')
      begun = true
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      if (begun) this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** One-time, version-gated v1 backfill. Future writes keep both indexes atomic. */
  private migrateLegacyIndex(): void {
    const completed = this.db.prepare(
      `SELECT value FROM search_index_meta WHERE key = 'turn_fts_v2_backfill'`,
    ).get() as { value: string } | undefined
    if (completed?.value === 'complete') return

    this.transaction(() => {
      const rechecked = this.db.prepare(
        `SELECT value FROM search_index_meta WHERE key = 'turn_fts_v2_backfill'`,
      ).get() as { value: string } | undefined
      if (rechecked?.value === 'complete') return

      const legacyRows = this.db.prepare(
        'SELECT session_id, project_id, role, body FROM turn_fts ORDER BY session_id, rowid',
      ).all() as LegacyRow[]
      const v2Rows = this.db.prepare(
        `SELECT session_id, project_id, turn_id, turn_ordinal, role, timestamp, raw_locator, body
         FROM turn_fts_v2 ORDER BY session_id, CAST(turn_ordinal AS INTEGER), rowid`,
      ).all() as V2Row[]

      const legacyBySession = new Map<string, LegacyRow[]>()
      const v2BySession = new Map<string, V2Row[]>()
      for (const row of legacyRows) {
        const rows = legacyBySession.get(row.session_id) ?? []
        rows.push(row)
        legacyBySession.set(row.session_id, rows)
      }
      for (const row of v2Rows) {
        const rows = v2BySession.get(row.session_id) ?? []
        rows.push(row)
        v2BySession.set(row.session_id, rows)
      }

      const sessionIds = new Set([...legacyBySession.keys(), ...v2BySession.keys()])
      const insertLegacy = this.db.prepare(
        'INSERT INTO turn_fts (session_id, project_id, role, body) VALUES (?, ?, ?, ?)',
      )
      const insertV2 = this.db.prepare(
        `INSERT INTO turn_fts_v2
         (session_id, project_id, turn_id, turn_ordinal, role, timestamp, raw_locator, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )

      for (const sessionId of [...sessionIds].sort()) {
        const legacy = legacyBySession.get(sessionId) ?? []
        const v2 = v2BySession.get(sessionId) ?? []
        if (legacy.length === 0 && v2.length > 0) {
          for (const row of v2) insertLegacy.run(row.session_id, row.project_id, row.role, row.body)
          continue
        }
        if (legacy.length > 0 && !sameLegacyContent(legacy, v2)) {
          this.db.prepare('DELETE FROM turn_fts_v2 WHERE session_id = ?').run(sessionId)
          legacy.forEach((row, ordinal) => {
            insertV2.run(
              row.session_id,
              row.project_id,
              `legacy:${ordinal}`,
              ordinal,
              row.role,
              '',
              '',
              row.body,
            )
          })
        }
      }

      this.db.prepare(
        `INSERT INTO search_index_meta (key, value) VALUES ('turn_fts_v2_backfill', 'complete')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run()
    })
  }

  /** Atomically dual-write v1 compatibility rows and metadata-rich v2 rows. */
  indexSession(session: NormalizedSession): void {
    const projectId = session.projectId ?? ''
    const rawLocator = session.sourceMeta.rawLocator
    this.transaction(() => {
      this.db.prepare('DELETE FROM turn_fts WHERE session_id = ?').run(session.id)
      this.db.prepare('DELETE FROM turn_fts_v2 WHERE session_id = ?').run(session.id)
      const insertLegacy = this.db.prepare(
        'INSERT INTO turn_fts (session_id, project_id, role, body) VALUES (?, ?, ?, ?)',
      )
      const insertV2 = this.db.prepare(
        `INSERT INTO turn_fts_v2
         (session_id, project_id, turn_id, turn_ordinal, role, timestamp, raw_locator, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      session.turns.forEach((turn, ordinal) => {
        if (!turn.text.trim()) return
        insertLegacy.run(session.id, projectId, turn.role, turn.text)
        insertV2.run(
          session.id,
          projectId,
          turn.uuid?.trim() || `${session.id}:${ordinal}`,
          ordinal,
          turn.role,
          turn.timestamp ?? '',
          rawLocator,
          turn.text,
        )
      })
    })
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    if (opts.projectId && opts.projectIds) {
      throw new TypeError('provide projectId or projectIds, not both')
    }
    if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 1000)) {
      throw new RangeError('search limit must be an integer between 1 and 1000')
    }
    const matchQuery = buildPlainTextFtsQuery(query)
    if (!matchQuery) return []
    const projectIds = opts.projectIds ?? (opts.projectId ? [opts.projectId] : undefined)
    if (projectIds?.length === 0) return []

    const predicates = ['turn_fts_v2 MATCH ?']
    const params: Array<string | number> = [matchQuery]
    if (projectIds) {
      predicates.push(`project_id IN (${projectIds.map(() => '?').join(', ')})`)
      params.push(...projectIds)
    }
    const limitSql = opts.limit === undefined ? '' : ' LIMIT ?'
    if (opts.limit !== undefined) params.push(opts.limit)
    const rows = this.db.prepare(`
      SELECT session_id, project_id, turn_id, turn_ordinal, role, timestamp, raw_locator, body,
             snippet(turn_fts_v2, 7, '[', ']', '…', 10) AS snip,
             bm25(turn_fts_v2) AS rank_value
      FROM turn_fts_v2
      WHERE ${predicates.join(' AND ')}
      ORDER BY rank_value, session_id, CAST(turn_ordinal AS INTEGER), rowid${limitSql}
    `).all(...params) as SearchRow[]

    return rows.map((row) => {
      const turnOrdinal = Number(row.turn_ordinal)
      return {
        sessionId: row.session_id,
        projectId: row.project_id,
        turnId: row.turn_id,
        turnOrdinal,
        role: row.role,
        timestamp: row.timestamp || undefined,
        uri: buildSessionTurnUri(row.session_id, turnOrdinal),
        snippet: row.snip,
        rawScore: -row.rank_value,
      }
    })
  }

  resolveTurnUri(uri: string): SessionTurnSource | undefined {
    const parsed = parseSessionTurnUri(uri)
    if (!parsed) return undefined
    const row = this.db.prepare(`
      SELECT session_id, project_id, turn_id, turn_ordinal, role, timestamp, raw_locator, body
      FROM turn_fts_v2
      WHERE session_id = ? AND CAST(turn_ordinal AS INTEGER) = ?
      ORDER BY rowid
      LIMIT 1
    `).get(parsed.sessionId, parsed.turnOrdinal) as V2Row | undefined
    if (!row) return undefined
    return {
      sessionId: row.session_id,
      projectId: row.project_id,
      turnId: row.turn_id,
      turnOrdinal: Number(row.turn_ordinal),
      role: row.role,
      timestamp: row.timestamp || undefined,
      rawLocator: row.raw_locator,
      body: row.body,
    }
  }

  resolveTurnContext(
    uri: string,
    before: number,
    after: number,
  ): SessionTurnContext | undefined {
    for (const [name, value] of [['before', before], ['after', after]] as const) {
      if (!Number.isInteger(value) || value < 0 || value > 20) {
        throw new RangeError(`${name} must be an integer between 0 and 20`)
      }
    }
    const parsed = parseSessionTurnUri(uri)
    if (!parsed) return undefined
    const rows = this.db.prepare(`
      SELECT session_id, project_id, turn_id, turn_ordinal, role, timestamp, raw_locator, body
      FROM turn_fts_v2
      WHERE session_id = ? AND CAST(turn_ordinal AS INTEGER) BETWEEN ? AND ?
      ORDER BY CAST(turn_ordinal AS INTEGER), rowid
    `).all(
      parsed.sessionId,
      Math.max(0, parsed.turnOrdinal - before),
      parsed.turnOrdinal + after,
    ) as V2Row[]
    const turns = rows.map((row): SessionTurnSource => ({
      sessionId: row.session_id,
      projectId: row.project_id,
      turnId: row.turn_id,
      turnOrdinal: Number(row.turn_ordinal),
      role: row.role,
      timestamp: row.timestamp || undefined,
      rawLocator: row.raw_locator,
      body: row.body,
    }))
    const selected = turns.find((turn) => turn.turnOrdinal === parsed.turnOrdinal)
    if (!selected) return undefined
    return {
      sessionId: selected.sessionId,
      projectId: selected.projectId,
      selected,
      before: turns.filter((turn) => turn.turnOrdinal < selected.turnOrdinal),
      after: turns.filter((turn) => turn.turnOrdinal > selected.turnOrdinal),
    }
  }
}
