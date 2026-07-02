import { describe, expect, test, vi } from 'vitest'
import type { WorkspaceOverview } from '@apc/dashboard-api'
import { OverviewCache } from './overview-cache.js'

const ov = (generatedAt: string): WorkspaceOverview => ({ generatedAt, projects: [] })

describe('OverviewCache', () => {
  test('caches within the TTL (build called once)', () => {
    const build = vi.fn(() => ov('t1'))
    let t = 1000
    const cache = new OverviewCache(build, 2000, () => t)
    expect(cache.get()).toEqual({ overview: ov('t1'), stale: false })
    t = 2500 // still within 2000ms of the 1000 build time
    expect(cache.get().overview.generatedAt).toBe('t1')
    expect(build).toHaveBeenCalledTimes(1)
  })

  test('rebuilds after the TTL expires', () => {
    let n = 0
    const build = vi.fn(() => ov(`t${++n}`))
    let t = 1000
    const cache = new OverviewCache(build, 2000, () => t)
    expect(cache.get().overview.generatedAt).toBe('t1')
    t = 4000 // > 2000ms later
    expect(cache.get().overview.generatedAt).toBe('t2')
    expect(build).toHaveBeenCalledTimes(2)
  })

  test('serves the last good snapshot as stale when build throws', () => {
    let mode: 'ok' | 'throw' = 'ok'
    const build = vi.fn(() => { if (mode === 'throw') throw new Error('SQLITE_BUSY'); return ov('good') })
    let t = 1000
    const cache = new OverviewCache(build, 0, () => t) // ttl 0 → always rebuild
    expect(cache.get()).toEqual({ overview: ov('good'), stale: false })
    mode = 'throw'; t = 2000
    expect(cache.get()).toEqual({ overview: ov('good'), stale: true })
  })

  test('rethrows when build fails and there is no cached snapshot', () => {
    const cache = new OverviewCache(() => { throw new Error('boom') }, 0)
    expect(() => cache.get()).toThrow(/boom/)
  })
})
