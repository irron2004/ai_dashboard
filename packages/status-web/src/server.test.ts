import { afterEach, describe, expect, test } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceOverview } from '@apc/dashboard-api'
import { createStatusServer } from './server.js'

const TOKEN = 'test-secret-token'
const ov: WorkspaceOverview = { generatedAt: '2026-07-02T00:00:00Z', projects: [] }

function htmlFixture(body = '<!doctype html><title>APC Status</title>'): string {
  const dir = mkdtempSync(join(tmpdir(), 'apc-status-html-'))
  const p = join(dir, 'index.html')
  writeFileSync(p, body)
  return p
}

describe('createStatusServer', () => {
  let server: Server
  const listen = (s: Server) => new Promise<string>((res) => {
    s.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(s.address() as AddressInfo).port}`))
  })
  afterEach(() => new Promise<void>((res) => (server ? server.close(() => res()) : res())))

  test('GET /healthz returns 200 {ok:true} without auth', async () => {
    server = createStatusServer({ buildOverview: () => ov, token: TOKEN, htmlPath: htmlFixture() })
    const base = await listen(server)
    const r = await fetch(`${base}/healthz`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  test('GET / serves the HTML page without auth', async () => {
    server = createStatusServer({ buildOverview: () => ov, token: TOKEN, htmlPath: htmlFixture() })
    const base = await listen(server)
    const r = await fetch(`${base}/`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/text\/html/)
    expect(await r.text()).toContain('APC Status')
  })

  test('GET /api/overview requires a bearer token', async () => {
    server = createStatusServer({ buildOverview: () => ov, token: TOKEN, htmlPath: htmlFixture() })
    const base = await listen(server)
    expect((await fetch(`${base}/api/overview`)).status).toBe(401)
    expect((await fetch(`${base}/api/overview`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
  })

  test('GET /api/overview with the right token returns WorkspaceOverview JSON', async () => {
    server = createStatusServer({ buildOverview: () => ov, token: TOKEN, htmlPath: htmlFixture() })
    const base = await listen(server)
    const r = await fetch(`${base}/api/overview`, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.generatedAt).toBe('2026-07-02T00:00:00Z')
    expect(Array.isArray(body.projects)).toBe(true)
  })

  test('POST /api/overview is rejected 405 (read-only)', async () => {
    server = createStatusServer({ buildOverview: () => ov, token: TOKEN, htmlPath: htmlFixture() })
    const base = await listen(server)
    const r = await fetch(`${base}/api/overview`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })
    expect(r.status).toBe(405)
  })

  test('unknown paths return 404', async () => {
    server = createStatusServer({ buildOverview: () => ov, token: TOKEN, htmlPath: htmlFixture() })
    const base = await listen(server)
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
    expect((await fetch(`${base}/whatever`)).status).toBe(404)
  })

  test('serves the stale snapshot with X-Status-Stale when a rebuild throws', async () => {
    let mode: 'ok' | 'throw' = 'ok'
    const build = () => { if (mode === 'throw') throw new Error('SQLITE_BUSY'); return ov }
    server = createStatusServer({ buildOverview: build, token: TOKEN, htmlPath: htmlFixture(), cacheTtlMs: 0 })
    const base = await listen(server)
    const first = await fetch(`${base}/api/overview`, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(first.status).toBe(200)
    expect(first.headers.get('x-status-stale')).toBeNull()
    mode = 'throw'
    const second = await fetch(`${base}/api/overview`, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(second.status).toBe(200)
    expect(second.headers.get('x-status-stale')).toBe('1')
    expect((await second.json()).generatedAt).toBe('2026-07-02T00:00:00Z')
  })
})
