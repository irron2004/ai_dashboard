import { describe, expect, test } from 'vitest'
import { runPool } from './make-drivers.js'

describe('runPool', () => {
  test('returns results in INPUT order regardless of completion order', async () => {
    // later items resolve sooner → completion order is reversed, but results stay in input order
    const out = await runPool([30, 20, 10], 3, (ms, i) =>
      new Promise<number>((r) => setTimeout(() => r(i), ms)))
    expect(out).toEqual([0, 1, 2])
  })

  test('processes every item exactly once', async () => {
    const out = await runPool([...Array(50).keys()], 5, async (n) => n * 2)
    expect(out).toEqual([...Array(50).keys()].map((n) => n * 2))
  })

  test('respects the concurrency limit (never more than `limit` in flight)', async () => {
    let inFlight = 0
    let peak = 0
    await runPool([...Array(20).keys()], 4, async () => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1) // actually parallelized
  })

  test('limit <= 1 runs strictly sequentially (one at a time)', async () => {
    let inFlight = 0
    let peak = 0
    await runPool([1, 2, 3], 1, async () => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
    })
    expect(peak).toBe(1)
  })

  test('empty input → empty output, no calls', async () => {
    let calls = 0
    expect(await runPool([], 4, async () => { calls++; return 1 })).toEqual([])
    expect(calls).toBe(0)
  })
})
