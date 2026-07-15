import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenCodeAdapter } from './opencode-adapter.js'

function createOpenCodeDb(path: string, sessionId: string, timeUpdated: number, worktree = '/mnt/c/work/apc', directory = worktree): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
  `)
  db.prepare('INSERT INTO project VALUES (?,?)').run('p1', worktree)
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?)').run(sessionId, 'p1', directory, 'build', 'openai/gpt-5.5', timeUpdated - 100, timeUpdated)
  db.prepare('INSERT INTO message VALUES (?,?,?,?)').run(`m-${sessionId}-1`, sessionId, 'user', '{}')
  db.prepare('INSERT INTO part VALUES (?,?,?)').run(`pt-${sessionId}-1`, `m-${sessionId}-1`, JSON.stringify({ type: 'text', text: `hello ${sessionId}` }))
  db.close()
}

describe('OpenCodeAdapter', () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-oc-'))
    const nested = join(dir, 'nested', 'opencode-home')
    mkdirSync(nested, { recursive: true })
    dbPath = join(nested, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
    `)
    db.prepare('INSERT INTO project VALUES (?,?)').run('p1', '/mnt/c/work/apc')
    // session ran in a SUBDIR of the worktree — repoPath should resolve to this directory, not the worktree.
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?)').run('oc1', 'p1', '/mnt/c/work/apc/papers', 'build', 'openai/gpt-5.5', 1000, 2000)
    db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m1', 'oc1', 'user', '{}')
    db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m2', 'oc1', 'assistant', '{}')
    db.prepare('INSERT INTO part VALUES (?,?,?)').run('pt1', 'm1', JSON.stringify({ type: 'text', text: 'please build' }))
    db.prepare('INSERT INTO part VALUES (?,?,?)').run('pt2', 'm2', JSON.stringify({ type: 'text', text: 'building now' }))
    db.close()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('discovers sessions newer than the cursor', async () => {
    const a = new OpenCodeAdapter(dir)
    expect(await a.discoverSources(() => undefined)).toHaveLength(1)
    const sourceId = `opencode:${dbPath}#session:oc1`
    const seen = { sourceId, position: JSON.stringify({ timeUpdated: 2000 }), updatedAt: 'x' }
    expect(await a.discoverSources((id) => (id === sourceId ? seen : undefined))).toHaveLength(0)
  })

  test('skips sessions when the cursor is newer than the source', async () => {
    const a = new OpenCodeAdapter(dir)
    const sourceId = `opencode:${dbPath}#session:oc1`
    const newer = { sourceId, position: JSON.stringify({ timeUpdated: 3000 }), updatedAt: 'x' }
    expect(await a.discoverSources((id) => (id === sourceId ? newer : undefined))).toHaveLength(0)
  })

  test('source ids include db path and mtimeMs comes from session update time', async () => {
    const a = new OpenCodeAdapter(dir)
    const [src] = await a.discoverSources(() => undefined)
    expect(src.id).toBe(`opencode:${dbPath}#session:oc1`)
    expect(src.mtimeMs).toBe(2_000_000)
  })

  test('same session id in different discovered db files does not collide', async () => {
    const otherDb = join(dir, 'other-root', 'opencode.db')
    createOpenCodeDb(otherDb, 'oc1', 3000, '/mnt/c/work/other')
    const a = new OpenCodeAdapter(dir)
    const sources = await a.discoverSources(() => undefined)
    expect(sources).toHaveLength(2)
    expect(new Set(sources.map((source) => source.id)).size).toBe(2)
    expect(sources.map((source) => source.id)).toEqual(expect.arrayContaining([
      `opencode:${dbPath}#session:oc1`,
      `opencode:${otherDb}#session:oc1`,
    ]))
  })

  test('returns no sources when the db file cannot be opened as sqlite', async () => {
    const invalidDb = join(dir, 'invalid.db')
    writeFileSync(invalidDb, 'not sqlite')
    await expect(new OpenCodeAdapter(invalidDb).discoverSources(() => undefined)).resolves.toEqual([])
  })

  test('parseSource joins message+part into turns and resolves repoPath', async () => {
    const a = new OpenCodeAdapter(dir)
    const [src] = await a.discoverSources(() => undefined)
    const { session, position } = await a.parseSource(src)
    expect(session.id).toBe('oc1')
    expect(session.repoPath).toBe('/mnt/c/work/apc/papers')  // session.directory preferred over project.worktree
    expect(session.sourceDirPath).toContain('opencode-home')
    expect(session.sourceMeta.provider).toBe('opencode')
    expect(session.sourceMeta.sourceKind).toBe('sqlite-session')
    expect(session.sourceMeta.sessionHeader.sessionId).toBe('oc1')
    expect(session.turns.map((t) => t.text)).toEqual(['please build', 'building now'])
    expect(JSON.parse(position).timeUpdated).toBe(2000)
  })

  test('parses current OpenCode databases where role and time live in message.data', async () => {
    const modernDir = join(dir, 'modern')
    const modernDb = join(modernDir, 'opencode.db')
    mkdirSync(modernDir, { recursive: true })
    const db = new DatabaseSync(modernDb)
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL);
    `)
    db.prepare('INSERT INTO project VALUES (?,?)').run('modern-project', '/mnt/c/work/apc')
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?)').run('modern-session', 'modern-project', '/mnt/c/work/apc/apps/desktop', 'build', 'openai/gpt-5.5', 1000, 2000)
    db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('modern-user', 'modern-session', 1100, 1100, JSON.stringify({ role: 'user', time: { created: 1100 } }))
    db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('modern-assistant', 'modern-session', 1200, 1200, JSON.stringify({ role: 'assistant', time: { created: 1200 } }))
    db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)').run('modern-user-text', 'modern-user', 'modern-session', 1100, 1100, JSON.stringify({ type: 'text', text: '현재 형식 질문' }))
    db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)').run('modern-assistant-text', 'modern-assistant', 'modern-session', 1200, 1200, JSON.stringify({ type: 'text', text: '현재 형식 답변' }))
    db.close()

    const adapter = new OpenCodeAdapter(modernDb)
    const [source] = await adapter.discoverSources(() => undefined)
    const { session } = await adapter.parseSource(source)

    expect(session.repoPath).toBe('/mnt/c/work/apc/apps/desktop')
    expect(session.turns).toEqual([
      expect.objectContaining({ role: 'user', text: '현재 형식 질문' }),
      expect.objectContaining({ role: 'assistant', text: '현재 형식 답변' }),
    ])
  })
})
