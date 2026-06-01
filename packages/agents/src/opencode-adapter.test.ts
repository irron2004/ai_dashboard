import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenCodeAdapter } from './opencode-adapter.js'

describe('OpenCodeAdapter', () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-oc-'))
    dbPath = join(dir, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
    `)
    db.prepare('INSERT INTO project VALUES (?,?)').run('p1', '/mnt/c/work/apc')
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?)').run('oc1', 'p1', 'build', 'openai/gpt-5.5', 1000, 2000)
    db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m1', 'oc1', 'user', '{}')
    db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m2', 'oc1', 'assistant', '{}')
    db.prepare('INSERT INTO part VALUES (?,?,?)').run('pt1', 'm1', JSON.stringify({ type: 'text', text: 'please build' }))
    db.prepare('INSERT INTO part VALUES (?,?,?)').run('pt2', 'm2', JSON.stringify({ type: 'text', text: 'building now' }))
    db.close()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('discovers sessions newer than the cursor', async () => {
    const a = new OpenCodeAdapter(dbPath)
    expect(await a.discoverSources(() => undefined)).toHaveLength(1)
    const seen = { sourceId: 'opencode:oc1', position: JSON.stringify({ timeUpdated: 2000 }), updatedAt: 'x' }
    expect(await a.discoverSources((id) => (id === 'opencode:oc1' ? seen : undefined))).toHaveLength(0)
  })

  test('parseSource joins message+part into turns and resolves repoPath', async () => {
    const a = new OpenCodeAdapter(dbPath)
    const [src] = await a.discoverSources(() => undefined)
    const { session, position } = await a.parseSource(src)
    expect(session.id).toBe('oc1')
    expect(session.repoPath).toBe('/mnt/c/work/apc')
    expect(session.turns.map((t) => t.text)).toEqual(['please build', 'building now'])
    expect(JSON.parse(position).timeUpdated).toBe(2000)
  })
})
