import { afterEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openReadOnlyDb } from './read-only-db.js'

describe('openReadOnlyDb', () => {
  const files: string[] = []
  afterEach(() => { for (const f of files) { try { rmSync(f) } catch { /* ignore */ } } })

  function seedDb(): string {
    const f = join(tmpdir(), `apc-status-ro-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    files.push(f)
    const w = new DatabaseSync(f)
    w.exec('PRAGMA journal_mode = WAL')
    w.exec('CREATE TABLE t(id TEXT)')
    w.prepare('INSERT INTO t(id) VALUES (?)').run('hello')
    w.close()
    return f
  }

  test('reads rows from an existing db', () => {
    const db = openReadOnlyDb(seedDb())
    const row = db.prepare('SELECT id FROM t').get() as { id: string }
    expect(row.id).toBe('hello')
    db.close()
  })

  test('rejects writes (attempt to write a readonly database)', () => {
    const db = openReadOnlyDb(seedDb())
    expect(() => db.prepare("INSERT INTO t(id) VALUES ('x')").run()).toThrow(/readonly/i)
    db.close()
  })
})
