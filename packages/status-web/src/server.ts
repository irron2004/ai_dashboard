import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import type { WorkspaceOverview } from '@apc/dashboard-api'
import { OverviewCache } from './overview-cache.js'

export type StatusServerOptions = {
  buildOverview: () => WorkspaceOverview
  token: string
  htmlPath?: string
  cacheTtlMs?: number
}

const DEFAULT_HTML = fileURLToPath(new URL('./public/index.html', import.meta.url))

/** Constant-time bearer check with an explicit length guard (timingSafeEqual throws on length mismatch). */
function tokenMatches(expected: string, req: IncomingMessage): boolean {
  const header = req.headers.authorization
  if (!header) return false
  const m = /^Bearer (.+)$/.exec(header)
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(json)
}

export function createStatusServer(opts: StatusServerOptions): http.Server {
  const htmlPath = opts.htmlPath ?? DEFAULT_HTML
  const cache = new OverviewCache(opts.buildOverview, opts.cacheTtlMs ?? 2000)

  return http.createServer((req, res) => {
    const method = req.method ?? 'GET'
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

    if (pathname === '/healthz') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      return sendJson(res, 200, { ok: true })
    }

    if (pathname === '/') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      let html: Buffer
      try { html = readFileSync(htmlPath) } catch { return sendJson(res, 500, { error: 'page unavailable' }) }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(html)
    }

    if (pathname === '/api/overview') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })  // read-only
      if (!tokenMatches(opts.token, req)) return sendJson(res, 401, { error: 'unauthorized' })
      try {
        const { overview, stale } = cache.get()
        return sendJson(res, 200, overview, stale ? { 'x-status-stale': '1' } : {})
      } catch {
        return sendJson(res, 503, { error: 'overview unavailable' })
      }
    }

    return sendJson(res, 404, { error: 'not found' })
  })
}
