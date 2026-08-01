import { afterEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { NormalizedSession, NormalizedTurn } from '@apc/shared'
import {
  SearchIndex,
  buildPlainTextFtsQuery,
  buildSessionTurnUri,
  parseSessionTurnUri,
} from './search-index.js'

const temporaryDirectories: string[] = []

function session(
  id: string,
  projectId: string,
  turns: Array<Pick<NormalizedTurn, 'role' | 'text'> & Partial<NormalizedTurn>>,
  rawLocator = '/private/source/session.jsonl',
): NormalizedSession {
  return {
    id,
    agentType: 'claude',
    projectId,
    sourceMeta: {
      provider: 'claude',
      sourceKind: 'jsonl-file',
      rawLocator,
      sessionHeader: {},
    },
    turns: turns.map((turn) => ({ toolCalls: [], ...turn })),
    filesTouched: [],
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('plain-text FTS query', () => {
  test('quotes literal tokens and ignores FTS punctuation', () => {
    expect(buildPlainTextFtsQuery('foo-bar "quoted" (thing)')).toBe('"foo" AND "bar" AND "quoted" AND "thing"')
    expect(buildPlainTextFtsQuery('***')).toBeUndefined()
  })

  test('treats newline-separated task context clauses as alternatives', () => {
    expect(buildPlainTextFtsQuery('task title\npreserve evidence URI')).toBe(
      '("task" AND "title") OR ("preserve" AND "evidence" AND "URI")',
    )
  })

  test('round-trips encoded session IDs through the opaque URI', () => {
    const uri = buildSessionTurnUri('session/with # separators', 4)
    expect(uri).toBe('apc://session/session%2Fwith%20%23%20separators#turn-4')
    expect(parseSessionTurnUri(uri)).toEqual({ sessionId: 'session/with # separators', turnOrdinal: 4 })
  })
})

describe('SearchIndex', () => {
  test('indexes turns and returns stable metadata scoped by project', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [
      { role: 'user', text: 'design the agent session manager', uuid: 'turn-u1', timestamp: '2026-08-01T01:02:03Z' },
      { role: 'assistant', text: 'ok' },
    ]))
    idx.indexSession(session('s2', 'p2', [{ role: 'user', text: 'unrelated billing work' }]))

    const [hit] = idx.search('session manager')
    expect(hit).toMatchObject({
      sessionId: 's1',
      projectId: 'p1',
      turnId: 'turn-u1',
      turnOrdinal: 0,
      role: 'user',
      timestamp: '2026-08-01T01:02:03Z',
      uri: 'apc://session/s1#turn-0',
    })
    expect(idx.search('session manager', { projectId: 'p2' })).toHaveLength(0)
    expect(idx.search('session manager', { projectIds: ['p2', 'p1'] })).toHaveLength(1)
    expect(hit).not.toHaveProperty('rawLocator')
    expect(idx.resolveTurnUri(hit.uri)?.rawLocator).toBe('/private/source/session.jsonl')
  })

  test.each([
    ['hyphen', 'foo-bar', 'foo-bar exact token'],
    ['quotes', '"quoted phrase', 'quoted phrase survives'],
    ['parentheses', '(stage timeout)', 'stage timeout in chamber'],
    ['Korean', '냉각 스테이지', '냉각 스테이지 정렬 실패'],
  ])('searches %s input as safe plain text', (_label, query, body) => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [{ role: 'user', text: body }]))
    expect(() => idx.search(query)).not.toThrow()
    expect(idx.search(query)).toHaveLength(1)
  })

  test('punctuation-only input returns no results instead of an FTS syntax error', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [{ role: 'user', text: 'ordinary text' }]))
    expect(idx.search('"(()--')).toEqual([])
  })

  test('matches either newline-separated clause without weakening terms inside a clause', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [{ role: 'user', text: 'task title appears together' }]))
    idx.indexSession(session('s2', 'p1', [{ role: 'user', text: 'preserve evidence URI together' }]))
    idx.indexSession(session('s3', 'p1', [{ role: 'user', text: 'task appears alone' }]))
    expect(idx.search('task title\npreserve evidence URI').map((hit) => hit.sessionId).sort())
      .toEqual(['s1', 's2'])
  })

  test('re-indexing a session atomically replaces v1 and v2 rows', () => {
    const db = new DatabaseSync(':memory:')
    const idx = new SearchIndex(db)
    idx.indexSession(session('s1', 'p1', [{ role: 'user', text: 'first version text' }]))
    idx.indexSession(session('s1', 'p1', [{ role: 'user', text: 'second version text' }]))
    expect(idx.search('first')).toHaveLength(0)
    expect(idx.search('second')).toHaveLength(1)
    const legacy = db.prepare('SELECT count(*) AS count FROM turn_fts WHERE session_id = ?').get('s1') as { count: number }
    const v2 = db.prepare('SELECT count(*) AS count FROM turn_fts_v2 WHERE session_id = ?').get('s1') as { count: number }
    expect(legacy.count).toBe(v2.count)
  })

  test('v1-to-v2 backfill is idempotent and stable across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apc-search-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'search.db')
    const legacyDb = new DatabaseSync(databasePath)
    legacyDb.exec('CREATE VIRTUAL TABLE turn_fts USING fts5(session_id, project_id, role, body)')
    legacyDb.prepare('INSERT INTO turn_fts VALUES (?, ?, ?, ?)').run('legacy/id', 'p1', 'user', 'legacy first answer')
    legacyDb.prepare('INSERT INTO turn_fts VALUES (?, ?, ?, ?)').run('legacy/id', 'p1', 'assistant', 'legacy second answer')
    legacyDb.close()

    const firstDb = new DatabaseSync(databasePath)
    const first = new SearchIndex(firstDb)
    const firstHits = first.search('legacy')
    expect(firstHits.map((hit) => [hit.turnOrdinal, hit.uri])).toEqual([
      [0, 'apc://session/legacy%2Fid#turn-0'],
      [1, 'apc://session/legacy%2Fid#turn-1'],
    ])
    firstDb.close()

    const reopenedDb = new DatabaseSync(databasePath)
    const reopened = new SearchIndex(reopenedDb)
    expect(reopened.search('legacy').map((hit) => [hit.turnOrdinal, hit.uri])).toEqual(
      firstHits.map((hit) => [hit.turnOrdinal, hit.uri]),
    )
    const count = reopenedDb.prepare('SELECT count(*) AS count FROM turn_fts_v2').get() as { count: number }
    expect(count.count).toBe(2)
    reopenedDb.close()
  })

  test('a second construction uses the version marker and skips full-text backfill scans', () => {
    const db = new DatabaseSync(':memory:')
    const first = new SearchIndex(db)
    first.indexSession(session('s1', 'p1', [{ role: 'user', text: 'already migrated content' }]))

    const preparedSql: string[] = []
    const observedDb = new Proxy(db, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            preparedSql.push(sql)
            return target.prepare(sql)
          }
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const reopened = new SearchIndex(observedDb)
    expect(reopened.search('migrated')).toHaveLength(1)
    expect(preparedSql.some((sql) => sql.includes('FROM turn_fts ORDER BY'))).toBe(false)
    expect(preparedSql.some((sql) => sql.includes('FROM turn_fts_v2 ORDER BY'))).toBe(false)
  })
})
