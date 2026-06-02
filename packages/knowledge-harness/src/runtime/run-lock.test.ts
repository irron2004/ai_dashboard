import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunLock } from './run-lock.js'

describe('RunLock', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-lock-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('acquire then a second acquire for the same project throws', () => {
    const a = new RunLock(dir, 'p1')
    a.acquire('RUN-1')
    const b = new RunLock(dir, 'p1')
    expect(() => b.acquire('RUN-2')).toThrow(/already in progress/)
  })

  test('release frees the lock so a new run can acquire', () => {
    const a = new RunLock(dir, 'p1')
    a.acquire('RUN-1')
    a.release()
    const b = new RunLock(dir, 'p1')
    expect(() => b.acquire('RUN-2')).not.toThrow()
  })

  test('different projects do not contend', () => {
    new RunLock(dir, 'p1').acquire('RUN-1')
    expect(() => new RunLock(dir, 'p2').acquire('RUN-2')).not.toThrow()
  })
})
