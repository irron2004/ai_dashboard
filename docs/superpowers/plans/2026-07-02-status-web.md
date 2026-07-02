# Implementation Plan — P4: 원격 읽기전용 웹 대시보드 (status web)

## Goal

Expose the cross-project workspace overview over HTTP so the user can check status from a phone / another PC — **READ-ONLY**, token-authenticated. Write actions (approve/run) are an explicit later phase and are **out of scope**.

Deliverables:

1. A new leaf package **`packages/status-web`** (`@apc/status-web`) with a small `node:http` server (no express), a read-only sqlite open helper, a tiny TTL+stale overview cache, CLI config parsing, and an entry (`cli.ts`).
2. A single static **`src/public/index.html`** — vanilla-JS mobile status page (no build step, no React) that polls `GET /api/overview` every 10s.
3. A launcher **`scripts/status-web.mjs`** (mirrors `scripts/graph-web.mjs` style) + a root `status-web` npm script.
4. A short **`docs/`** usage note + a README section pointer.

Endpoints (only these; everything else 404, non-GET on them → 405):
- `GET /` → the HTML page (no auth)
- `GET /healthz` → `{ ok: true }` (no auth)
- `GET /api/overview` → `WorkspaceOverview` JSON (**bearer token required**)

## FIXED SEAM (given by P3 — do NOT implement, only consume)

P3 lands first and adds to `packages/dashboard-api` (`@apc/dashboard-api`):

```ts
export type ProjectOverview = { project: Project; activeTaskCount: number; runningRuns: AgentRun[]; reviewQueueCount: number; nextUp: Task[] }
export type WorkspaceOverview = { generatedAt: string; projects: ProjectOverview[] }
export function buildWorkspaceOverview(deps: { registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }): WorkspaceOverview
```

**Stacking assumption (state this to yourself before starting):** this plan is executed on a branch where **P3 has already landed** (stacked). `cli.ts` and one wiring test import `buildWorkspaceOverview` / `WorkspaceOverview` from `@apc/dashboard-api`. All other modules (server, auth, cache, config, read-only-db) depend only on the *type* `WorkspaceOverview` and are exercised with **injected fakes**, so they do not require P3 at runtime. If `@apc/dashboard-api` does not yet export these, stop and rebase onto P3 first — do not stub the seam.

## Architecture (data flow this plan adds)

```
scripts/status-web.mjs                     launcher → spawns vite-node on packages/status-web/src/cli.ts
  └─ packages/status-web/src/cli.ts        parse config → openReadOnlyDb → stores → buildOverview closure → createStatusServer → listen
       ├─ config.ts        parseArgs/resolveConfig: --db --vault --token --host --port + APC_STATUS_TOKEN + default paths + token gen
       ├─ read-only-db.ts  openReadOnlyDb(file): DatabaseSync(file,{readOnly:true}) + PRAGMA busy_timeout
       ├─ overview-cache.ts OverviewCache: TTL (2s) + stale fallback (serve last-good on build throw)
       └─ server.ts        createStatusServer({buildOverview, token, htmlPath?, cacheTtlMs?})
                             GET /  GET /healthz  GET /api/overview(auth)  →  else 404 / non-GET 405
  └─ packages/status-web/src/public/index.html   vanilla-JS mobile page (localStorage token, poll 10s)

consumes (unchanged): @apc/core (ProjectRegistry, Db), @apc/pm (TaskStore, AgentRunStore),
                      @apc/dashboard-api (buildWorkspaceOverview, WorkspaceOverview — P3 seam)

plumbing:
  vitest.config.ts               + alias '@apc/status-web' → packages/status-web/src/index.ts   (append)
  tsconfig.typecheck.json        + path  '@apc/status-web'                                       (append)
  package.json (root)            + script "status-web": "node scripts/status-web.mjs"           (append)
  pnpm-workspace.yaml            no change (globs packages/*) — but run `pnpm install` to link the new pkg
```

## Tech stack / verified facts (all probed in this repo, Node v22.22.3)

- **Runtime = vite-node.** The codebase uses TS parameter properties (`constructor(private readonly db: Db)`) and Zod, so native `node file.ts` type-stripping fails. The launcher runs the TS entry through `vite-node --config vitest.config.ts`, reusing the repo's `@apc/*` aliases **and** the `nodeSqlitePlugin` shim. Verified: `node node_modules/vite-node/vite-node.mjs --config vitest.config.ts <entry.ts>` runs and resolves `node:sqlite` flag-free on this box (only an `ExperimentalWarning`).
- **`vite-node/vite-node.mjs`** is resolvable via `require.resolve('vite-node/vite-node.mjs')` (vite-node 2.1.9, a transitive dep of vitest). Args after the entry file are forwarded to `process.argv.slice(2)` (verified).
- **Read-only open works:** `new DatabaseSync(file, { readOnly: true })` — reads succeed, writes throw `attempt to write a readonly database` (verified). `PRAGMA busy_timeout = 3000` is accepted on a read-only connection (per-connection, no disk write) and a read-only WAL connection sees committed rows while a writer is concurrently open (verified count went 1→2). So we do **not** call `PRAGMA journal_mode=WAL` (that is a write; the desktop already set WAL persistently on the file).
- **Tests:** Vitest ^2 workspace. `vitest.config.ts` `include` already globs `packages/**/*.test.{ts,tsx}`, so tests under `packages/status-web/src` are auto-discovered. Node http server on `listen(0,'127.0.0.1')` + `fetch` works in the test env (verified). No test binds `0.0.0.0`.
- **Auth:** `crypto.timingSafeEqual` with an explicit length guard (it throws on unequal-length buffers).

## Global constraints (read before every task)

- **TDD, strict order per task:** write the failing test → run it → watch it fail for the *expected* reason → write the minimal implementation → run it green → next test. Tests are colocated (`*.test.ts`).
- **Run a single test/file (from repo root):** `npx vitest run <path-or-substring>`. Full suite: `pnpm test` (~2.5 min, final task only). **Typecheck authority:** `pnpm typecheck` (`tsc -p tsconfig.typecheck.json && tsc -p apps/desktop/tsconfig.json --noEmit`). Ignore IDE-only noise: `@xterm/*`, `@apc/node:sqlite not found`, `@homebridge/node-pty-*`.
- **Commit after each task** — Conventional Commits + trailer. Template:
  ```
  git add -A && git commit -m "<type>(status-web): <summary>

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```
  Use scope `status-web` (new scope for this package); `docs` for the docs task.
- **READ-ONLY, no writes:** no endpoint mutates anything. Non-GET requests to the three known paths return **405**; the DB is opened `readOnly`. Do not add CORS (same-origin page). Do not add rate-limiting (MVP).
- **Security is non-negotiable:** bearer token required for `/api/*`; constant-time compare; bind `127.0.0.1` by default; `--host 0.0.0.0` is an explicit opt-in that prints a warning.
- **Task fixtures need `blockedBy: []`** (P1 made it output-required on `Task`). Any `Task` literal you create in a test must include it, alongside `acceptanceCriteria: []` and `linkedWikiPages: []`.
- **Append-style** additions in shared files (`vitest.config.ts`, `tsconfig.typecheck.json`, root `package.json`) — add one line/entry next to the existing ones; do not reformat the block.
- **Do NOT** switch git branches, touch anything outside this repo, or add values to `AgentKind`/`RunAgent`.

---

## Task 1 — Scaffold `@apc/status-web` + workspace plumbing + `openReadOnlyDb`

**Why first:** creates the package (so `pnpm install` links it) and delivers the riskiest seam — the read-only DB open — with a real test.

### Files
- `packages/status-web/package.json` (new)
- `packages/status-web/src/index.ts` (new — barrel)
- `packages/status-web/src/read-only-db.ts` (new — impl)
- `packages/status-web/src/read-only-db.test.ts` (new — test)
- `vitest.config.ts` (append one alias line)
- `tsconfig.typecheck.json` (append one path line)

### Steps

1. **Create the package manifest** — `packages/status-web/package.json` (mirrors `packages/dashboard-api/package.json`; no per-package tsconfig, like dashboard-api):
   ```json
   {
     "name": "@apc/status-web",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "main": "./src/index.ts",
     "dependencies": {
       "@apc/shared": "workspace:*",
       "@apc/core": "workspace:*",
       "@apc/pm": "workspace:*",
       "@apc/dashboard-api": "workspace:*"
     }
   }
   ```

2. **Link the new workspace package:**
   ```
   pnpm install
   ```
   Expected: pnpm reports `@apc/status-web` added; `node_modules/@apc/status-web` symlink now exists.

3. **Failing test** — `packages/status-web/src/read-only-db.test.ts`:
   ```ts
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
   ```
   Run: `npx vitest run packages/status-web/src/read-only-db.test.ts` → **fails** (`openReadOnlyDb` not found).

4. **Implement** — `packages/status-web/src/read-only-db.ts`:
   ```ts
   import { DatabaseSync } from 'node:sqlite'
   import type { Db } from '@apc/core'

   /**
    * Open the desktop's sqlite file for READ-ONLY access from a standalone node
    * process (not Electron). The desktop writes concurrently; SQLite WAL allows
    * concurrent readers, so we do NOT set journal_mode here (that is a write and
    * the file is already WAL). busy_timeout lets a read wait for an in-flight
    * write instead of failing immediately with SQLITE_BUSY; the OverviewCache
    * absorbs any remaining busy errors by serving the last good snapshot.
    */
   export function openReadOnlyDb(file: string): Db {
     const db = new DatabaseSync(file, { readOnly: true })
     db.exec('PRAGMA busy_timeout = 3000')
     return db
   }
   ```
   Run: `npx vitest run packages/status-web/src/read-only-db.test.ts` → **passes**.

5. **Barrel** — `packages/status-web/src/index.ts`:
   ```ts
   export * from './read-only-db.js'
   ```

6. **Register the alias** (so `@apc/status-web` resolves in tests, mirroring the other pkgs) — in `vitest.config.ts`, append one line to the `resolve.alias` object after the `@apc/graph-view/node` entry:
   ```ts
       '@apc/graph-view/node': `${root}packages/graph-view/src/node/index.ts`,
       '@apc/status-web': `${root}packages/status-web/src/index.ts`,
   ```

7. **Register the typecheck path** — in `tsconfig.typecheck.json`, append one entry to `compilerOptions.paths` after `@apc/knowledge`:
   ```json
       "@apc/knowledge": ["./packages/knowledge/src/index.ts"],
       "@apc/status-web": ["./packages/status-web/src/index.ts"]
   ```
   (`include` already globs `packages/*/src/**/*.ts`, so no `include` change is needed.)

8. **Typecheck:** `pnpm typecheck` → clean.

9. **Commit:**
   ```
   git add -A && git commit -m "feat(status-web): scaffold package + read-only sqlite open helper

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 2 — `OverviewCache` (TTL + stale fallback)

**Why:** the phone polls every 10s; the server rebuilds the overview per request (cheap: a few sqlite reads). A 2s TTL absorbs bursts, and on a transient DB-busy build failure we serve the last good snapshot (marked stale) instead of erroring.

### Files
- `packages/status-web/src/overview-cache.ts` (new — impl)
- `packages/status-web/src/overview-cache.test.ts` (new — test)
- `packages/status-web/src/index.ts` (append export)

### Interface
```ts
export type CachedOverview = { overview: WorkspaceOverview; stale: boolean }
export class OverviewCache {
  constructor(build: () => WorkspaceOverview, ttlMs?: number, now?: () => number)
  get(): CachedOverview   // fresh within TTL; rebuild after; on build throw serve last-good (stale) or rethrow
}
```

### Steps

1. **Failing test** — `packages/status-web/src/overview-cache.test.ts`:
   ```ts
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
   ```
   Run: `npx vitest run packages/status-web/src/overview-cache.test.ts` → **fails** (module not found).

2. **Implement** — `packages/status-web/src/overview-cache.ts`:
   ```ts
   import type { WorkspaceOverview } from '@apc/dashboard-api'

   export type CachedOverview = { overview: WorkspaceOverview; stale: boolean }

   /**
    * Rebuilds the workspace overview on demand with a short TTL, and — because the
    * desktop writes the same sqlite file concurrently — falls back to the last good
    * snapshot (flagged `stale`) if a rebuild throws (e.g. transient SQLITE_BUSY).
    */
   export class OverviewCache {
     private last?: { overview: WorkspaceOverview; at: number }
     constructor(
       private readonly build: () => WorkspaceOverview,
       private readonly ttlMs = 2000,
       private readonly now: () => number = Date.now,
     ) {}

     get(): CachedOverview {
       const t = this.now()
       if (this.last && t - this.last.at < this.ttlMs) return { overview: this.last.overview, stale: false }
       try {
         const overview = this.build()
         this.last = { overview, at: t }
         return { overview, stale: false }
       } catch (err) {
         if (this.last) return { overview: this.last.overview, stale: true }
         throw err
       }
     }
   }
   ```
   Run: `npx vitest run packages/status-web/src/overview-cache.test.ts` → **passes**.

3. **Barrel** — append to `packages/status-web/src/index.ts`:
   ```ts
   export * from './overview-cache.js'
   ```

4. **Typecheck:** `pnpm typecheck` → clean.

5. **Commit:**
   ```
   git add -A && git commit -m "feat(status-web): overview cache with TTL and stale fallback

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 3 — `createStatusServer` (auth, routing, read-only)

**Why:** the HTTP surface. Pure `node:http` + manual routing for three endpoints, bearer auth on `/api/*`, cache-backed overview, and strict read-only semantics (405 on non-GET, 404 on unknown). HTML path is injectable so this task's `/` test uses a temp fixture — the real page arrives in Task 5.

### Files
- `packages/status-web/src/server.ts` (new — impl)
- `packages/status-web/src/server.test.ts` (new — test)
- `packages/status-web/src/index.ts` (append export)

### Interface
```ts
export type StatusServerOptions = {
  buildOverview: () => WorkspaceOverview
  token: string
  htmlPath?: string    // defaults to ./public/index.html next to this module
  cacheTtlMs?: number  // defaults to 2000
}
export function createStatusServer(opts: StatusServerOptions): http.Server
```

### Steps

1. **Failing test** — `packages/status-web/src/server.test.ts`:
   ```ts
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
   ```
   Run: `npx vitest run packages/status-web/src/server.test.ts` → **fails** (module not found).

2. **Implement** — `packages/status-web/src/server.ts`:
   ```ts
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
   ```
   Run: `npx vitest run packages/status-web/src/server.test.ts` → **passes**.

3. **Barrel** — append to `packages/status-web/src/index.ts`:
   ```ts
   export * from './server.js'
   ```

4. **Typecheck:** `pnpm typecheck` → clean.

5. **Commit:**
   ```
   git add -A && git commit -m "feat(status-web): read-only http server with bearer auth

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 4 — CLI config (`config.ts`): args, env, defaults, token generation

**Why:** the status server is a standalone node process (not Electron). It cannot call `app.getPath('userData')`, so it resolves the desktop's sqlite path via the platform Electron convention as a best-effort default, and treats `--db` as the reliable override. It also owns token resolution (`--token` / `APC_STATUS_TOKEN` / generate-and-print).

### Files
- `packages/status-web/src/config.ts` (new — impl)
- `packages/status-web/src/config.test.ts` (new — test)
- `packages/status-web/src/index.ts` (append export)

### Design notes (embed as comments in `config.ts`)
- The desktop resolves `dbFile = join(app.getPath('userData'), 'apc.db')` and `vaultRoot = join(userData, 'vault')` (see `apps/desktop/src/main/index.ts`). Electron's `userData = join(appData, appName)`, `appName = package.json "name" = "@apc/desktop"` → path segments `['@apc','desktop']`.
- `appData` by platform: win32 `%APPDATA%`; darwin `~/Library/Application Support`; else `$XDG_CONFIG_HOME || ~/.config`.
- The scoped app name makes the exact folder Electron-version-dependent, so **`--db` is the reliable path**. `cli.ts` (Task 6) prints a helpful error if the resolved file is missing.
- Defaults: `host=127.0.0.1`, `port=4319`.
- `--vault` is parsed and defaulted for forward-compatibility (future vault-backed endpoints); no current endpoint reads it — documented, not dead-guessed.

### Steps

1. **Failing test** — `packages/status-web/src/config.test.ts`:
   ```ts
   import { describe, expect, test } from 'vitest'
   import { parseArgs, resolveConfig, defaultDbPath } from './config.js'

   describe('parseArgs', () => {
     test('parses --key value pairs', () => {
       expect(parseArgs(['--db', '/a/apc.db', '--host', '0.0.0.0', '--port', '5000', '--token', 'abc']))
         .toEqual({ db: '/a/apc.db', host: '0.0.0.0', port: '5000', token: 'abc' })
     })
     test('ignores unknown/danging flags gracefully', () => {
       expect(parseArgs(['--db'])).toEqual({}) // no value → dropped
       expect(parseArgs([])).toEqual({})
     })
   })

   describe('resolveConfig', () => {
     test('applies defaults when nothing is passed', () => {
       const c = resolveConfig([], {})
       expect(c.host).toBe('127.0.0.1')
       expect(c.port).toBe(4319)
       expect(c.db).toBe(defaultDbPath())
       expect(c.token.length).toBeGreaterThan(16)
       expect(c.tokenGenerated).toBe(true)
     })
     test('--token overrides APC_STATUS_TOKEN and marks tokenGenerated false', () => {
       const c = resolveConfig(['--token', 'cli-token'], { APC_STATUS_TOKEN: 'env-token' })
       expect(c.token).toBe('cli-token')
       expect(c.tokenGenerated).toBe(false)
     })
     test('APC_STATUS_TOKEN is used when --token is absent', () => {
       const c = resolveConfig([], { APC_STATUS_TOKEN: 'env-token' })
       expect(c.token).toBe('env-token')
       expect(c.tokenGenerated).toBe(false)
     })
     test('--db/--host/--port override the defaults', () => {
       const c = resolveConfig(['--db', '/x/apc.db', '--host', '0.0.0.0', '--port', '5000'], {})
       expect(c.db).toBe('/x/apc.db')
       expect(c.host).toBe('0.0.0.0')
       expect(c.port).toBe(5000)
     })
   })
   ```
   Run: `npx vitest run packages/status-web/src/config.test.ts` → **fails** (module not found).

2. **Implement** — `packages/status-web/src/config.ts`:
   ```ts
   import { homedir } from 'node:os'
   import { join } from 'node:path'
   import { randomBytes } from 'node:crypto'

   export type StatusConfig = {
     db: string
     vault: string
     token: string
     tokenGenerated: boolean
     host: string
     port: number
   }

   /** Electron `appData` root per platform (userData = appData + appName). */
   function appData(): string {
     if (process.platform === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
     if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
     return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
   }

   // Electron app.getName() === apps/desktop package.json "name" === "@apc/desktop".
   const APP_NAME_SEGMENTS = ['@apc', 'desktop']
   function userData(): string { return join(appData(), ...APP_NAME_SEGMENTS) }

   /** Best-effort default mirroring apps/desktop/src/main/index.ts. --db overrides; cli.ts errors if missing. */
   export function defaultDbPath(): string { return join(userData(), 'apc.db') }
   export function defaultVaultPath(): string { return join(userData(), 'vault') }

   /** Parse `--key value` pairs; a `--key` with no following value is dropped. */
   export function parseArgs(argv: string[]): Record<string, string> {
     const out: Record<string, string> = {}
     for (let i = 0; i < argv.length; i++) {
       const a = argv[i]
       if (!a.startsWith('--')) continue
       const key = a.slice(2)
       const next = argv[i + 1]
       if (next === undefined || next.startsWith('--')) continue
       out[key] = next
       i++
     }
     return out
   }

   export function resolveConfig(argv: string[], env: NodeJS.ProcessEnv): StatusConfig {
     const a = parseArgs(argv)
     const explicitToken = a.token ?? env.APC_STATUS_TOKEN
     const token = explicitToken ?? randomBytes(24).toString('base64url')
     return {
       db: a.db ?? defaultDbPath(),
       vault: a.vault ?? defaultVaultPath(), // reserved for future vault-backed endpoints; unused today
       token,
       tokenGenerated: explicitToken === undefined,
       host: a.host ?? '127.0.0.1',
       port: a.port ? Number(a.port) : 4319,
     }
   }
   ```
   Run: `npx vitest run packages/status-web/src/config.test.ts` → **passes**.

3. **Barrel** — append to `packages/status-web/src/index.ts`:
   ```ts
   export * from './config.js'
   ```

4. **Typecheck:** `pnpm typecheck` → clean.

5. **Commit:**
   ```
   git add -A && git commit -m "feat(status-web): CLI config (args, env, defaults, token gen)

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 5 — The static mobile page (`public/index.html`)

**Why:** the phone/remote UI. Single-column cards readable at 390px, prompts for the token once (localStorage), sends `Authorization: Bearer <token>`, polls every 10s, has a manual refresh, and shows `generatedAt` + a stale indicator. No build step, no framework. UI itself is not unit-tested (static file); we assert the **default** server serves it.

### Files
- `packages/status-web/src/public/index.html` (new)
- `packages/status-web/src/public.test.ts` (new — asserts default server serves the real page)

### Steps

1. **Failing test** — `packages/status-web/src/public.test.ts` (no `htmlPath` → uses the module-relative default `./public/index.html`):
   ```ts
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
   ```
   Run: `npx vitest run packages/status-web/src/public.test.ts` → **fails** (default `./public/index.html` does not exist → `/` returns 500).

2. **Implement** — `packages/status-web/src/public/index.html`:
   ```html
   <!doctype html>
   <html lang="ko">
   <head>
     <meta charset="utf-8" />
     <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
     <title>APC Status</title>
     <style>
       :root { color-scheme: light dark; --gap: 12px; }
       * { box-sizing: border-box; }
       body { margin: 0; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
       header { position: sticky; top: 0; display: flex; align-items: center; gap: var(--gap);
                padding: 12px 16px; background: Canvas; border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
       header h1 { font-size: 16px; margin: 0; flex: 1; }
       button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
                background: Canvas; color: CanvasText; }
       button:active { opacity: .6; }
       main { max-width: 640px; margin: 0 auto; padding: var(--gap); display: flex; flex-direction: column; gap: var(--gap); }
       .meta { font-size: 13px; opacity: .75; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
       .stale { color: #b26a00; font-weight: 600; }
       .card { border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; padding: 14px 16px; }
       .card h2 { font-size: 15px; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
       .badges { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
       .badge { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, CanvasText 10%, transparent); }
       .badge.run { background: color-mix(in srgb, #2e7d32 25%, transparent); }
       .badge.review { background: color-mix(in srgb, #b26a00 30%, transparent); }
       ul { margin: 6px 0 0; padding-left: 18px; } li { margin: 2px 0; }
       .empty { opacity: .6; font-style: italic; }
       .error { color: #c62828; }
     </style>
   </head>
   <body>
     <header>
       <h1>APC Status</h1>
       <button id="refresh" type="button">새로고침</button>
     </header>
     <main>
       <div class="meta" id="meta">불러오는 중…</div>
       <div id="content"></div>
     </main>
     <script>
       const API = '/api/overview';
       const KEY = 'apc.status.token';

       function getToken() {
         let t = localStorage.getItem(KEY);
         if (!t) { t = (prompt('상태 대시보드 접근 토큰을 입력하세요') || '').trim(); if (t) localStorage.setItem(KEY, t); }
         return t;
       }
       function ago(iso) {
         const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
         if (s < 60) return s + '초 전';
         if (s < 3600) return Math.round(s / 60) + '분 전';
         return Math.round(s / 3600) + '시간 전';
       }
       function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

       function renderProject(p) {
         const runs = p.runningRuns || [];
         const nextUp = p.nextUp || [];
         return `<section class="card">
           <h2>${esc(p.project.name)}</h2>
           <div class="badges">
             <span class="badge">진행중 ${p.activeTaskCount}</span>
             <span class="badge run">실행중 ${runs.length}</span>
             <span class="badge review">리뷰 대기 ${p.reviewQueueCount}</span>
           </div>
           <div>다음 할 일</div>
           ${nextUp.length
             ? '<ul>' + nextUp.map((t) => `<li>${esc(t.title)} <small>(${esc(t.priority)})</small></li>`).join('') + '</ul>'
             : '<div class="empty">없음</div>'}
         </section>`;
       }

       async function load() {
         const meta = document.getElementById('meta');
         const content = document.getElementById('content');
         const token = getToken();
         if (!token) { meta.innerHTML = '<span class="error">토큰이 필요합니다.</span>'; return; }
         try {
           const res = await fetch(API, { headers: { authorization: 'Bearer ' + token } });
           if (res.status === 401) { localStorage.removeItem(KEY); meta.innerHTML = '<span class="error">토큰이 올바르지 않습니다. 새로고침하세요.</span>'; return; }
           if (!res.ok) { meta.innerHTML = '<span class="error">오류 ' + res.status + '</span>'; return; }
           const data = await res.json();
           const staleHeader = res.headers.get('x-status-stale') === '1';
           const stale = staleHeader || (Date.now() - new Date(data.generatedAt).getTime() > 25000);
           meta.innerHTML = '생성 ' + esc(ago(data.generatedAt)) + (stale ? ' <span class="stale">· 오래됨(stale)</span>' : '');
           content.innerHTML = (data.projects || []).length
             ? data.projects.map(renderProject).join('')
             : '<div class="empty">프로젝트가 없습니다.</div>';
         } catch (e) {
           meta.innerHTML = '<span class="error">연결 실패</span>';
         }
       }

       document.getElementById('refresh').addEventListener('click', load);
       load();
       setInterval(load, 10000);
     </script>
   </body>
   </html>
   ```
   Run: `npx vitest run packages/status-web/src/public.test.ts` → **passes**.

3. **Regression:** `npx vitest run packages/status-web` → all status-web tests pass.

4. **Typecheck:** `pnpm typecheck` → clean (HTML is not compiled; no type impact).

5. **Commit:**
   ```
   git add -A && git commit -m "feat(status-web): mobile read-only status page

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 6 — Entry (`cli.ts`) + launcher (`scripts/status-web.mjs`) + root script

**Why:** wire the read-only DB → P3's `buildWorkspaceOverview` → server, and give the user a one-command launch mirroring `pnpm graph-web`. This is the only place the P3 seam is invoked at runtime; the wiring is covered by a test that uses an in-memory DB + the real `buildWorkspaceOverview`.

### Files
- `packages/status-web/src/cli.ts` (new — entry; also exports the testable `makeBuildOverview` + `describeMissingDb`)
- `packages/status-web/src/cli.test.ts` (new — wiring test through the real seam + missing-db message)
- `packages/status-web/src/index.ts` (append export)
- `scripts/status-web.mjs` (new — launcher)
- `package.json` (root — append script)

### Steps

1. **Failing test** — `packages/status-web/src/cli.test.ts` (uses the `openDb(':memory:')` + `migrate` + `migratePm` pattern from `project-dashboard.test.ts`; note every Task fixture carries `blockedBy: []`):
   ```ts
   import { afterEach, describe, expect, test } from 'vitest'
   import type { AddressInfo } from 'node:net'
   import type { Server } from 'node:http'
   import { openDb, migrate, ProjectRegistry } from '@apc/core'
   import { migratePm, TaskStore, AgentRunStore } from '@apc/pm'
   import { createStatusServer } from './server.js'
   import { makeBuildOverview, describeMissingDb } from './cli.js'

   describe('makeBuildOverview (P3 seam wiring)', () => {
     let server: Server
     afterEach(() => new Promise<void>((res) => (server ? server.close(() => res()) : res())))

     test('serves real workspace data through /api/overview', async () => {
       const db = openDb(':memory:'); migrate(db); migratePm(db)
       const registry = new ProjectRegistry(db); const tasks = new TaskStore(db); const runs = new AgentRunStore(db)
       registry.register({ id: 'p1', name: 'Proj One', status: 'active', projectType: 'git', repoPaths: ['/p1'], vaultPaths: [], sourcePaths: [], domain: 'project-docs' })
       tasks.create({ id: 'T1', projectId: 'p1', title: 'active', status: 'in_progress', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })

       const build = makeBuildOverview({ registry, tasks, runs })
       server = createStatusServer({ buildOverview: build, token: 't' })
       const base = await new Promise<string>((res) =>
         server.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))

       const r = await fetch(`${base}/api/overview`, { headers: { authorization: 'Bearer t' } })
       expect(r.status).toBe(200)
       const body = await r.json()
       expect(typeof body.generatedAt).toBe('string')
       expect(body.projects.map((p: { project: { name: string } }) => p.project.name)).toContain('Proj One')
     })
   })

   describe('describeMissingDb', () => {
     test('names the missing path and how to fix it', () => {
       const msg = describeMissingDb('/nope/apc.db')
       expect(msg).toContain('/nope/apc.db')
       expect(msg).toMatch(/--db/)
     })
   })
   ```
   Run: `npx vitest run packages/status-web/src/cli.test.ts` → **fails** (module not found).

2. **Implement** — `packages/status-web/src/cli.ts`:
   ```ts
   import { existsSync } from 'node:fs'
   import { ProjectRegistry } from '@apc/core'
   import { TaskStore, AgentRunStore } from '@apc/pm'
   import { buildWorkspaceOverview, type WorkspaceOverview } from '@apc/dashboard-api'
   import { resolveConfig, type StatusConfig } from './config.js'
   import { openReadOnlyDb } from './read-only-db.js'
   import { createStatusServer } from './server.js'

   type Stores = { registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }

   /** Closure the server calls per (uncached) request. Isolated so it can be unit-tested with an in-memory DB. */
   export function makeBuildOverview(stores: Stores): () => WorkspaceOverview {
     return () => buildWorkspaceOverview(stores)
   }

   export function describeMissingDb(dbPath: string): string {
     return [
       `[status-web] sqlite file not found: ${dbPath}`,
       `The status server reads the desktop's DB read-only but cannot resolve Electron's userData path itself.`,
       `Find the desktop's apc.db (it sits next to the desktop 'vault' folder under the app's userData dir) and pass it:`,
       `  pnpm status-web --db /absolute/path/to/apc.db`,
     ].join('\n')
   }

   function printStartup(cfg: StatusConfig): void {
     const url = `http://${cfg.host}:${cfg.port}`
     console.log(`[status-web] serving read-only overview at ${url}`)
     console.log(`[status-web] db: ${cfg.db}`)
     if (cfg.tokenGenerated) console.log(`[status-web] generated token (pass via ?/prompt): ${cfg.token}`)
     else console.log(`[status-web] token: (from --token / APC_STATUS_TOKEN)`)
     if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
       console.log(`[status-web] WARNING: bound to ${cfg.host} — reachable on the LAN. Token auth is the only guard.`)
     }
     console.log(`[status-web] open ${url}/ on your phone (same network) and paste the token when prompted.`)
   }

   export function main(argv: string[], env: NodeJS.ProcessEnv): void {
     const cfg = resolveConfig(argv, env)
     if (!existsSync(cfg.db)) { console.error(describeMissingDb(cfg.db)); process.exit(1) }
     const db = openReadOnlyDb(cfg.db)
     const stores: Stores = { registry: new ProjectRegistry(db), tasks: new TaskStore(db), runs: new AgentRunStore(db) }
     const server = createStatusServer({ buildOverview: makeBuildOverview(stores), token: cfg.token })
     server.listen(cfg.port, cfg.host, () => printStartup(cfg))
   }

   // Run when invoked as the entry (vite-node runs this file directly).
   main(process.argv.slice(2), process.env)
   ```
   > Note: `main(...)` runs on import. That is intentional for the entry, and the test imports only `makeBuildOverview` / `describeMissingDb` — but importing the module still triggers `main`. To keep the test hermetic, guard the auto-run: only call `main` when this file is the process entry. Replace the last line with:
   ```ts
   import { fileURLToPath } from 'node:url'
   // Only auto-start when executed directly (not when imported by a test).
   if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
     main(process.argv.slice(2), process.env)
   }
   ```
   (Under vite-node the entry file's real path is `process.argv[1]`, so this guard runs `main` on launch but stays inert under vitest.)

   Run: `npx vitest run packages/status-web/src/cli.test.ts` → **passes**.

3. **Barrel** — append to `packages/status-web/src/index.ts`:
   ```ts
   export { makeBuildOverview, describeMissingDb, main } from './cli.js'
   ```

4. **Launcher** — `scripts/status-web.mjs` (mirrors `scripts/graph-web.mjs`; runs the TS entry through vite-node with the repo config so `@apc/*` aliases + the `node:sqlite` shim apply):
   ```js
   #!/usr/bin/env node
   /**
    * status-web.mjs
    * Usage: node scripts/status-web.mjs [--db <path>] [--vault <path>] [--token <t>] [--host <h>] [--port <n>]
    * Runs packages/status-web/src/cli.ts via vite-node (repo config: @apc/* aliases + node:sqlite shim).
    * Read-only remote status dashboard. Default bind 127.0.0.1; --host 0.0.0.0 to expose on the LAN.
    */
   import { spawn } from 'node:child_process'
   import { createRequire } from 'node:module'
   import { fileURLToPath } from 'node:url'
   import { dirname, resolve } from 'node:path'

   const require = createRequire(import.meta.url)
   const here = dirname(fileURLToPath(import.meta.url))
   const config = resolve(here, '../vitest.config.ts')
   const entry = resolve(here, '../packages/status-web/src/cli.ts')
   const viteNode = require.resolve('vite-node/vite-node.mjs')

   const args = [viteNode, '--config', config, entry, '--', ...process.argv.slice(2)]
   const child = spawn(process.execPath, args, { stdio: 'inherit' })
   child.on('exit', (code) => process.exit(code ?? 0))
   ```
   > Runtime note: on this repo's Node (v22.22.3) `node:sqlite` loads flag-free (only an `ExperimentalWarning`), verified. On the Node 24 target it is stable. If a future host predates unflagged `node:sqlite`, run with `NODE_OPTIONS=--experimental-sqlite pnpm status-web ...`.

5. **Root script** — in `package.json`, append to `scripts` after `graph-web`:
   ```json
       "graph-web": "node scripts/graph-web.mjs",
       "status-web": "node scripts/status-web.mjs"
   ```

6. **Manual smoke (not a test — do it once):**
   ```
   pnpm status-web --db ":memory:"    # will error: :memory: is not a file → shows describeMissingDb guidance
   ```
   Then, if the desktop has been run at least once, point at the real file it prints and confirm the token line + `http://127.0.0.1:4319`. Ctrl-C to stop. (This confirms the launcher path; the wiring itself is covered by `cli.test.ts`.)

7. **Typecheck:** `pnpm typecheck` → clean.

8. **Commit:**
   ```
   git add -A && git commit -m "feat(status-web): cli entry + launcher + root status-web script

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 7 — Docs: usage note + README pointer

**Why:** the roadmap flags documentation as the cheapest high-leverage investment. Explain how to start the server, the token, and phone access.

### Files
- `docs/status-web.md` (new — usage note)
- `README.md` (append a subsection under the existing `## 시작하기` block, right after `### 브라우저 그래프 뷰어`)

### Steps

1. **Create `docs/status-web.md`:**
   ```md
   # 원격 읽기전용 상태 대시보드 (status-web)

   Electron 데스크톱 앱과 **같은 sqlite 파일**(`apc.db`)을 읽어, 전 프로젝트 상태를 HTTP로 노출하는
   독립 실행 node 서버입니다. **읽기 전용** — 승인/실행 같은 쓰기 액션은 다음 phase입니다.

   ## 실행

   ```bash
   # 기본값: 127.0.0.1:4319, DB는 데스크톱 userData 경로 추정, 토큰 자동 생성 후 출력
   pnpm status-web

   # DB 경로를 명시(권장 — Electron userData 경로는 자동 추정이 어렵습니다)
   pnpm status-web --db /absolute/path/to/apc.db

   # 폰/다른 PC에서 접속하려면 LAN 바인드(명시적 opt-in)
   pnpm status-web --host 0.0.0.0 --token my-secret-token
   ```

   시작 시 로그에 접속 URL과 토큰이 찍힙니다. DB 파일을 찾지 못하면 경로 안내 메시지를 출력하고 종료합니다.

   ## 인증 / 토큰

   - `/api/*` 는 `Authorization: Bearer <token>` 필수 (상수시간 비교).
   - 토큰 우선순위: `--token` > `APC_STATUS_TOKEN` 환경변수 > (없으면) 시작 시 랜덤 생성 후 출력.
   - 웹 페이지는 최초 1회 토큰을 물어보고 `localStorage`에 저장, 이후 자동 전송합니다.
     토큰이 틀리면(401) 저장분을 지우고 다시 물어봅니다.

   ## 폰에서 보기

   1. 데스크톱을 돌린 적 있는 PC에서 `pnpm status-web --host 0.0.0.0 --token <원하는토큰>` 실행.
   2. 폰을 **같은 네트워크**에 두고 브라우저로 `http://<PC의 LAN IP>:4319/` 접속.
   3. 프롬프트에 토큰 입력. 이후 10초마다 자동 갱신, 상단 "새로고침" 버튼으로 수동 갱신.
   4. `생성 N초 전 · 오래됨(stale)` 표시는 데스크톱 쓰기와 충돌해 최신 스냅샷을 못 만들 때
      마지막 정상 스냅샷을 보여주는 상태입니다.

   ## 보안 기본값

   - 기본 바인드는 `127.0.0.1`(로컬 전용). `--host 0.0.0.0` 은 LAN 노출 opt-in이며 경고를 출력합니다.
   - DB는 `readOnly`로 열려 어떤 요청도 파일을 수정할 수 없습니다. 쓰기 엔드포인트는 없습니다.

   ## 엔드포인트

   | Method | Path | Auth | 설명 |
   |---|---|---|---|
   | GET | `/` | 없음 | 모바일 상태 페이지(HTML) |
   | GET | `/healthz` | 없음 | `{ "ok": true }` |
   | GET | `/api/overview` | Bearer | `WorkspaceOverview` JSON (P3 집계) |

   그 외 경로는 404, 위 경로의 비-GET 요청은 405(읽기 전용).
   ```

2. **README pointer** — in `README.md`, append immediately after the `scripts/graph-web.mjs`로 … 시작합니다.` line (end of the `### 브라우저 그래프 뷰어` subsection, before its `---`):
   ```md
   ### 원격 읽기전용 상태 대시보드

   ```bash
   pnpm status-web --db /path/to/apc.db          # 127.0.0.1:4319, 토큰 자동 생성
   pnpm status-web --host 0.0.0.0 --token <t>    # 폰/원격 접속(LAN opt-in)
   ```

   Electron과 같은 `apc.db`를 읽어 전 프로젝트 상태를 웹으로 노출(읽기 전용, 토큰 인증).
   자세한 내용은 `docs/status-web.md` 참고.
   ```
   Also add one row to the `## 패키지 맵 (packages/)` table (append after the `dashboard-api` row):
   ```md
   | `status-web` | 읽기전용 상태 웹 서버 — node:http + 토큰 인증, dashboard-api 집계를 HTTP로 노출, 모바일 페이지 |
   ```

3. **Full regression** — last task, run the whole suite + typecheck:
   ```
   pnpm typecheck
   pnpm test
   ```
   Expected: `pnpm typecheck` clean; `pnpm test` all suites pass (the new `packages/status-web/src/*.test.ts` included, ~2.5 min total).

4. **Commit:**
   ```
   git add -A && git commit -m "docs(status-web): usage note + README pointer

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Self-review

### Spec coverage (handoff §4 P4 — READ-ONLY only)
- **HTTP exposure of dashboard-api, read-only** → Task 3 (`GET /api/overview`; non-GET → 405; DB opened `readOnly` in Task 1). No write endpoints anywhere.
- **Token auth** → Task 3 (bearer, `crypto.timingSafeEqual` + length guard) + Task 4 (token from `--token`/`APC_STATUS_TOKEN`/generated-and-printed).
- **Web UI, phone-usable** → Task 5 (single-column cards, 390px-readable, prompt→localStorage token, 10s poll + manual refresh, `generatedAt` + stale indicator).
- **Phone / other-PC access** → Task 4/6 (`--host 0.0.0.0` explicit opt-in, default `127.0.0.1`, startup warning) + Task 7 (docs).
- **Standalone process reading the desktop's DB** → Task 1 (`openReadOnlyDb`) + Task 4 (`--db` + Electron-convention default) + Task 6 (`--db` required-in-practice with a helpful missing-file error).
- **Concurrent access** → Task 1 (`busy_timeout`, no `journal_mode` write) + Task 2 (stale-cache fallback on build throw) + Task 3 (`X-Status-Stale` header, 503 only when no snapshot exists).
- **Write actions deferred** → none implemented; documented in Task 7.

### FIXED SEAM handling
- `buildWorkspaceOverview` / `WorkspaceOverview` are consumed, never defined. Only `cli.ts` and `cli.test.ts` touch the runtime function; server/cache/config/read-only-db depend on the `WorkspaceOverview` *type* + injected fakes, so they're green independent of P3. Stacking assumption stated at the top. `makeBuildOverview` isolates the seam call for the in-memory wiring test.

### Placeholder scan
No `TODO`/`TBD`/`FIXME`/`...` elisions. Every test, module, HTML page, launcher, run command, and commit message is literal and runnable. The one prose "Note" in Task 6 is immediately followed by the concrete guarded replacement line.

### Type / build consistency
- New package has `main: ./src/index.ts` and no per-package tsconfig — mirrors `@apc/dashboard-api`; root `tsconfig.typecheck.json` `include` (`packages/*/src/**/*.ts`) already covers it. Alias added to `vitest.config.ts`; path added to `tsconfig.typecheck.json` — both append-style.
- Runtime is vite-node (not native `node file.ts`), chosen because the codebase uses TS parameter properties that native type-stripping rejects — verified in-repo. vite-node arg forwarding, `node:sqlite` flag-free load, read-only open, `busy_timeout`, concurrent WAL read, and http-on-port-0 + `fetch` were all probed successfully on Node v22.22.3.
- `Task` fixtures in `cli.test.ts` include `blockedBy: []` (+ `acceptanceCriteria`/`linkedWikiPages`), satisfying P1's output-required field.

### Known MVP limitations (documented, not bugs)
- `--vault` is parsed/defaulted but unused (reserved for future vault-backed endpoints) — noted in `config.ts` and here, not silently dead.
- The DB-path default is best-effort (Electron's scoped app-name folder is version-dependent); `--db` is the reliable path and `cli.ts` errors loudly with guidance when the default is absent — the sanctioned fallback from the brief.
- No CORS (same-origin page), no rate-limiting (MVP) — both intentional per the brief.
- The launcher itself isn't unit-tested (it spawns a process); its logic is covered by `config.test.ts` + `cli.test.ts`, and a one-time manual smoke is listed in Task 6.
