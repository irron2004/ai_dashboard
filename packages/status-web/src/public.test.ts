import { afterEach, describe, expect, test } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { WorkspaceOverview } from '@apc/dashboard-api'
import { createStatusServer } from './server.js'

const ov: WorkspaceOverview = { generatedAt: '2026-07-02T00:00:00Z', projects: [] }

describe('default HTML page', () => {
  let server: Server
  afterEach(() => new Promise<void>((res) => (server ? server.close(() => res()) : res())))

  test('GET / serves the packaged mobile page', async () => {
    server = createStatusServer({ buildOverview: () => ov, token: 't' }) // no htmlPath → default
    const base = await new Promise<string>((res) =>
      server.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
    const r = await fetch(`${base}/`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/text\/html/)
    const html = await r.text()
    expect(html).toContain('APC Status')
    expect(html).toContain('/api/overview')
  })
})
