import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  // #38 — stale-lock recovery so a crashed run can't block a project forever.
  test('a live, fresh lock still blocks (owner alive, within TTL)', () => {
    new RunLock(dir, 'p1', { now: () => 1000, pid: 4242, isAlive: () => true }).acquire('RUN-1')
    const b = new RunLock(dir, 'p1', { now: () => 1000 + 60_000, ttlMs: 30 * 60_000, isAlive: () => true })
    expect(() => b.acquire('RUN-2')).toThrow(/already in progress/)
  })

  test('a lock older than the TTL is reclaimed', () => {
    new RunLock(dir, 'p1', { now: () => 0, pid: 4242, isAlive: () => true }).acquire('RUN-1')
    const b = new RunLock(dir, 'p1', { now: () => 31 * 60_000, ttlMs: 30 * 60_000, isAlive: () => true })
    expect(() => b.acquire('RUN-2')).not.toThrow()
  })

  test('a lock whose owner pid is dead is reclaimed even within the TTL', () => {
    new RunLock(dir, 'p1', { now: () => 1000, pid: 4242, isAlive: () => true }).acquire('RUN-1')
    const b = new RunLock(dir, 'p1', { now: () => 1000, ttlMs: 30 * 60_000, isAlive: () => false })  // owner crashed
    expect(() => b.acquire('RUN-2')).not.toThrow()
  })

  test('a legacy/garbage lockfile (no pid/timestamp) is reclaimable', () => {
    writeFileSync(join(dir, 'p1.lock'), 'RUN-OLD')  // pre-#38 format
    expect(() => new RunLock(dir, 'p1').acquire('RUN-2')).not.toThrow()
  })
})
