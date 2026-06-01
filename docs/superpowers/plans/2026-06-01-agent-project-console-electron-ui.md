# Agent Project Console — Electron Shell + UI + Integration Implementation Plan (Plan 6 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Compose the engine packages (Plans 1–5) into the running product: integration services that drive the PM loop end-to-end, an Electron shell with a typed IPC surface, the PM Control Tower React UI (project sidebar, PM Home, Harness panel, model picker, review actions), and the Agent Work Execution Panel (terminal via `node-pty`/`xterm.js`).

**Architecture:** `@apc/app-services` holds the end-to-end orchestrations (`IngestService`, `RunService`, `CurrentPromotionService`) that wire adapters → registry → search → wiki → vault → PM stores; these are pure and fully unit-tested. `apps/desktop` is an Electron app: `main` exposes a typed IPC "BFF" (queries + commands) over the services and `@apc/dashboard-api`; `preload` bridges it via `contextBridge`; `renderer` is the React + Zustand PM Control Tower. The terminal surface runs `node-pty` in `main`, streamed to `xterm.js` in the renderer.

**Tech Stack:** TypeScript (ESM), Vitest (+ jsdom, @testing-library/react for renderer), Electron, electron-vite, React 18, Zustand, `xterm`/`@xterm/addon-fit`, a prebuilt PTY (`@homebridge/node-pty-prebuilt-multiarch`), `node:sqlite`, Node 24.

> Builds on Plans 1–5 (all green: `@apc/shared, core, vault, workflow, agents, search, llm-wiki, pm, dashboard-api, harness`). Spec: §2 (lifecycle), §4 (BFF thin, jobs in worker), §8 (terminal surface), §9 (model picker), §9.5 (Harness panel), §10/§11 (conflict + canonical-safe promotion), §13 (PM Control Tower).

> ## ⚠️ Environment reality (2026-06-01, this WSL2 dev box)
> - **`node-pty` is a native addon** → needs a C compiler (this box has none, same as `better-sqlite3`) and an Electron-ABI rebuild. Use the **prebuilt** `@homebridge/node-pty-prebuilt-multiarch` and run `electron-rebuild` on the **target dev machine**. The terminal tasks (Part D) cannot be auto-tested here.
> - **Electron needs a display** → the shell can't launch headless here (use a dev machine, or `xvfb-run` on Linux).
> - **Therefore:** Part A (integration services) and Part C (React components, via jsdom) are TDD'd **here**; Part B (IPC contract) is unit-tested where pure; Part D (Electron shell + PTY) is specified concretely and verified **manually on a dev machine** (each Part D task lists exact manual verification steps).

---

## File Structure

```
packages/app-services/
  package.json
  src/index.ts
  src/ingest-service.ts        # adapters → registry map → search → cursor
  src/ingest-service.test.ts
  src/run-service.ts           # session → WikiEngine → vault → PM stores → task=review
  src/run-service.test.ts
  src/current-promotion-service.ts  # proposal → canonical (ConflictManager-gated)
  src/current-promotion-service.test.ts

apps/desktop/
  package.json
  electron.vite.config.ts
  tsconfig.json
  src/main/index.ts            # Electron main: app lifecycle + BrowserWindow
  src/main/ipc.ts              # typed IPC handlers (BFF) over services
  src/main/container.ts        # build deps (db, stores, services) once
  src/main/pty-manager.ts      # node-pty sessions (Part D)
  src/shared/ipc-contract.ts   # channel names + request/response types (shared main↔renderer)
  src/preload/index.ts         # contextBridge: window.apc
  src/renderer/index.html
  src/renderer/main.tsx
  src/renderer/store.ts        # Zustand store
  src/renderer/api.ts          # typed wrapper over window.apc
  src/renderer/components/ProjectSidebar.tsx
  src/renderer/components/PmHome.tsx
  src/renderer/components/PmHome.test.tsx
  src/renderer/components/ModelPicker.tsx
  src/renderer/components/ModelPicker.test.tsx
  src/renderer/components/HarnessPanel.tsx
  src/renderer/components/ReviewActions.tsx
  src/renderer/components/ReviewActions.test.tsx
  src/renderer/components/AgentTerminal.tsx   # xterm (Part D)
  vitest.config.ts             # jsdom env for renderer component tests
```

Add `@apc/app-services` to the root `vitest.config.ts` alias map.

---

# Part A — Integration services (`@apc/app-services`) — TDD here

### Task A1: scaffold + `IngestService`

**Files:** Create `packages/app-services/package.json`, `src/index.ts`, `src/ingest-service.ts`; test `ingest-service.test.ts`; add root alias.

`packages/app-services/package.json`:
```json
{
  "name": "@apc/app-services",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@apc/shared": "workspace:*", "@apc/core": "workspace:*", "@apc/agents": "workspace:*",
    "@apc/search": "workspace:*", "@apc/vault": "workspace:*", "@apc/llm-wiki": "workspace:*", "@apc/pm": "workspace:*"
  }
}
```

`src/index.ts`:
```ts
export * from './ingest-service.js'
export * from './run-service.js'
export * from './current-promotion-service.js'
```
(Export incrementally as files are added.)

**Behavior:** `IngestService.ingestAll(adapters)` walks each `AgentIngestAdapter`: `discoverSources(cursorStore.get)` → for each source `parseSource` → resolve `projectId` from `registry.findByRepoPath(session.repoPath)` (fallback: leave unset) → set on session → `searchIndex.indexSession(session)` → `cursorStore.set(source.id, position)`. Returns `{ sources, sessions }` counts.

- [ ] **Step 1: Failing test (with an in-memory FakeAdapter)**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, ProjectRegistry, IngestCursorStore, type Db } from '@apc/core'
import { SearchIndex } from '@apc/search'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'
import { IngestService } from './ingest-service.js'

class FakeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'claude' as const
  calls = 0
  constructor(private readonly session: NormalizedSession) {}
  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    this.calls++
    if (cursorFor('claude:s1')) return []          // already ingested → nothing new
    return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/s1.jsonl', repoPath: this.session.repoPath }]
  }
  async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
    return { session: this.session, position: JSON.stringify({ sizeBytes: 1, mtimeMs: 1 }) }
  }
}

describe('IngestService', () => {
  let db: Db; let registry: ProjectRegistry; let cursors: IngestCursorStore; let index: SearchIndex
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db)
    registry = new ProjectRegistry(db); cursors = new IngestCursorStore(db); index = new SearchIndex(new DatabaseSync(':memory:'))
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
  })

  test('ingests new sources: resolves projectId, indexes turns, saves cursor', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc',
      turns: [{ role: 'user', text: 'design the ingest service', toolCalls: [] }], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    const result = await svc.ingestAll([new FakeAdapter(session)])
    expect(result).toEqual({ sources: 1, sessions: 1 })
    expect(index.search('ingest service', { projectId: 'p1' })).toHaveLength(1)  // indexed under resolved project
    expect(cursors.get('claude:s1')).toBeDefined()                               // cursor saved
  })

  test('a second run finds nothing new (cursor honored)', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', turns: [], filesTouched: [] }
    const svc = new IngestService({ registry, cursors, index })
    const adapter = new FakeAdapter(session)
    await svc.ingestAll([adapter])
    const second = await svc.ingestAll([adapter])
    expect(second.sources).toBe(0)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { ProjectRegistry, IngestCursorStore } from '@apc/core'
import type { SearchIndex } from '@apc/search'
import type { AgentIngestAdapter } from '@apc/agents'

export type IngestDeps = { registry: ProjectRegistry; cursors: IngestCursorStore; index: SearchIndex }
export type IngestResult = { sources: number; sessions: number }

export class IngestService {
  constructor(private readonly deps: IngestDeps) {}

  async ingestAll(adapters: AgentIngestAdapter[]): Promise<IngestResult> {
    let sources = 0, sessions = 0
    for (const adapter of adapters) {
      const found = await adapter.discoverSources((id) => this.deps.cursors.get(id))
      sources += found.length
      for (const source of found) {
        const { session, position } = await adapter.parseSource(source)
        const repoPath = session.repoPath ?? source.repoPath
        const project = repoPath ? this.deps.registry.findByRepoPath(repoPath) : undefined
        const withProject = { ...session, projectId: project?.id ?? session.projectId }
        this.deps.index.indexSession(withProject)
        this.deps.cursors.set(source.id, position)
        sessions++
      }
    }
    return { sources, sessions }
  }
}
```

- [ ] **Step 4: Run → PASS (2). Commit** — `feat(app-services): IngestService (adapters → project map → search → cursor)`

---

### Task A2: `RunService`

**Files:** Create `src/run-service.ts`; test `run-service.test.ts`.

**Behavior:** `completeRun({ run, session, engine, currentCanonical })`:
1. `WikiEngine.generate(session, { engine, currentCanonical })` → `WikiGeneration`.
2. `VaultWriter.writeRunSummary(projectId, { runId, taskId, agent, summary, filesTouched, openProblems })` → summaryPath.
3. `VaultWriter.writeCurrentProposal(projectId, generation.currentProposalMarkdown)` → proposalPath (only if non-empty).
4. `AgentRunStore.complete(run.id, { endedAt, summaryPath })`.
5. `TaskStore.updateStatus(run.taskId, 'review', 'pending')`.
Returns `{ generation, summaryPath, proposalPath }`. The PM then reviews (Plan 4 `ReviewService`).

- [ ] **Step 1: Failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore, VaultWriter } from '@apc/pm'
import { VaultAdapter } from '@apc/vault'
import { WikiEngine, FakeAgentRunner } from '@apc/llm-wiki'
import type { AgentRun, NormalizedSession } from '@apc/shared'
import { RunService } from './run-service.js'

describe('RunService.completeRun', () => {
  let db: Db; let dir: string; let tasks: TaskStore; let runs: AgentRunStore; let svc: RunService
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    dir = mkdtempSync(join(tmpdir(), 'apc-run-'))
    tasks = new TaskStore(db); runs = new AgentRunStore(db)
    tasks.create({ id: 'T1', projectId: 'p1', title: 't', status: 'in_progress', assigneeType: 'agent', priority: 'high', reviewStatus: 'none' })
    runs.create({ id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'running' })
    const wiki = new WikiEngine(new FakeAgentRunner([JSON.stringify({
      workSummary: 'did the thing', filesTouched: ['a.ts'], openProblems: [],
      nextTasks: [{ title: 'next', rationale: 'r' }], currentProposalMarkdown: '## Current\n- did it\n',
    })]))
    svc = new RunService({ wiki, vaultWriter: new VaultWriter(new VaultAdapter(dir)), tasks, runs })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('generates summary+proposal, completes run, flips task to review/pending', async () => {
    const run: AgentRun = runs.get('R1')!
    const session: NormalizedSession = { id: 's1', agentType: 'codex', projectId: 'p1', repoPath: '/p1', turns: [{ role: 'user', text: 'go', toolCalls: [] }], filesTouched: [] }
    const out = await svc.completeRun({ run, session, projectId: 'p1', engine: 'codex', currentCanonical: '', endedAt: '2026-06-01T10:30:00Z' })

    expect(out.generation.workSummary).toBe('did the thing')
    expect(out.summaryPath).toBe('projects/p1/agent-runs/R1-summary.md')
    expect(out.proposalPath).toBe('projects/p1/current.proposal.md')
    expect(runs.get('R1')!.status).toBe('completed')
    expect(runs.get('R1')!.summaryPath).toBe(out.summaryPath)
    expect(tasks.get('T1')!.status).toBe('review')
    expect(tasks.get('T1')!.reviewStatus).toBe('pending')
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { AgentRun, AgentType, NormalizedSession, WikiGeneration } from '@apc/shared'
import type { WikiEngine } from '@apc/llm-wiki'
import type { TaskStore, AgentRunStore, VaultWriter } from '@apc/pm'

export type RunServiceDeps = { wiki: WikiEngine; vaultWriter: VaultWriter; tasks: TaskStore; runs: AgentRunStore }

export type CompleteRunInput = {
  run: AgentRun; session: NormalizedSession; projectId: string
  engine: AgentType; currentCanonical: string; endedAt: string
}
export type CompleteRunResult = { generation: WikiGeneration; summaryPath: string; proposalPath?: string }

export class RunService {
  constructor(private readonly deps: RunServiceDeps) {}

  async completeRun(input: CompleteRunInput): Promise<CompleteRunResult> {
    const generation = await this.deps.wiki.generate(input.session, {
      engine: input.engine, currentCanonical: input.currentCanonical,
    })
    const summaryPath = this.deps.vaultWriter.writeRunSummary(input.projectId, {
      runId: input.run.id, taskId: input.run.taskId, agent: input.run.agent,
      summary: generation.workSummary, filesTouched: generation.filesTouched, openProblems: generation.openProblems,
    })
    let proposalPath: string | undefined
    if (generation.currentProposalMarkdown.trim()) {
      proposalPath = this.deps.vaultWriter.writeCurrentProposal(input.projectId, generation.currentProposalMarkdown)
    }
    this.deps.runs.complete(input.run.id, { endedAt: input.endedAt, summaryPath })
    this.deps.tasks.updateStatus(input.run.taskId, 'review', 'pending')
    return { generation, summaryPath, proposalPath }
  }
}
```

- [ ] **Step 4: Run → PASS. Commit** — `feat(app-services): RunService (session → wiki → vault → run/task update)`

---

### Task A3: `CurrentPromotionService` (proposal → canonical, conflict-gated)

**Files:** Create `src/current-promotion-service.ts`; test `current-promotion-service.test.ts`.

**Behavior:** `promote({ projectId, lastReadHash })`:
- Read `projects/<id>/current.proposal.md` (throws if missing).
- If `projects/<id>/current.md` exists: if `conflict.detectConflict(lastReadHash, canonicalBody)` → write `projects/<id>/conflicts/<runStamp>-current-conflict.md` via `conflict.buildConflictDoc(...)` and return `{ status: 'conflict', conflictPath }`. (`runStamp` is an injected string so the path is deterministic in tests.)
- Else write the proposal body to `current.md` and return `{ status: 'promoted', canonicalPath, newHash }`.
- `lastReadHash` is what the app last read of `current.md` (the UI tracks it; on first promotion there is no canonical so no conflict).

- [ ] **Step 1: Failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultAdapter } from '@apc/vault'
import { ConflictManager } from '@apc/core'
import { CurrentPromotionService } from './current-promotion-service.js'

describe('CurrentPromotionService.promote', () => {
  let dir: string; let vault: VaultAdapter; let conflict: ConflictManager; let svc: CurrentPromotionService
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-prom-'))
    vault = new VaultAdapter(dir); conflict = new ConflictManager()
    svc = new CurrentPromotionService({ vault, conflict, stamp: '2026-06-01' })
    vault.writeDoc('projects/p1/current.proposal.md', { frontmatter: { type: 'current-proposal' }, body: '## Current\n- proposed\n' })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('first promotion writes canonical current.md (no conflict)', () => {
    const res = svc.promote({ projectId: 'p1', lastReadHash: '' })
    expect(res.status).toBe('promoted')
    expect(vault.readDoc('projects/p1/current.md').body).toContain('proposed')
  })

  test('stale lastReadHash against an edited canonical creates a conflict doc, does not overwrite', () => {
    // canonical exists and was edited in Obsidian after the app last read it
    vault.writeDoc('projects/p1/current.md', { frontmatter: {}, body: '## Current\n- edited in obsidian\n' })
    const res = svc.promote({ projectId: 'p1', lastReadHash: 'STALE' })
    expect(res.status).toBe('conflict')
    expect(res.conflictPath).toBe('projects/p1/conflicts/2026-06-01-current-conflict.md')
    expect(vault.readDoc('projects/p1/current.md').body).toContain('edited in obsidian')  // untouched
    expect(vault.readDoc(res.conflictPath!).body).toContain('edited in obsidian')
  })

  test('matching lastReadHash promotes over the existing canonical', () => {
    vault.writeDoc('projects/p1/current.md', { frontmatter: {}, body: '## Current\n- old\n' })
    const currentBody = vault.readDoc('projects/p1/current.md').body
    const res = svc.promote({ projectId: 'p1', lastReadHash: conflict.hash(currentBody) })
    expect(res.status).toBe('promoted')
    expect(vault.readDoc('projects/p1/current.md').body).toContain('proposed')
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { VaultAdapter } from '@apc/vault'
import type { ConflictManager } from '@apc/core'

export type PromotionDeps = { vault: VaultAdapter; conflict: ConflictManager; stamp: string }
export type PromotionResult =
  | { status: 'promoted'; canonicalPath: string; newHash: string }
  | { status: 'conflict'; conflictPath: string }

export class CurrentPromotionService {
  constructor(private readonly deps: PromotionDeps) {}

  promote(input: { projectId: string; lastReadHash: string }): PromotionResult {
    const base = `projects/${input.projectId}`
    const proposalRel = `${base}/current.proposal.md`
    const canonicalRel = `${base}/current.md`
    const proposed = this.deps.vault.readDoc(proposalRel).body   // throws if missing

    let canonicalBody: string | undefined
    try { canonicalBody = this.deps.vault.readDoc(canonicalRel).body } catch { canonicalBody = undefined }

    if (canonicalBody !== undefined && this.deps.conflict.detectConflict(input.lastReadHash, canonicalBody)) {
      const conflictPath = `${base}/conflicts/${this.deps.stamp}-current-conflict.md`
      this.deps.vault.writeDoc(conflictPath, {
        frontmatter: { type: 'conflict', target: canonicalRel },
        body: this.deps.conflict.buildConflictDoc({
          targetPath: canonicalRel, previousVersion: '(app last-read hash did not match)',
          currentVersion: canonicalBody, proposedChange: proposed,
        }),
      })
      return { status: 'conflict', conflictPath }
    }

    this.deps.vault.writeDoc(canonicalRel, { frontmatter: { type: 'current', project_id: input.projectId }, body: proposed })
    return { status: 'promoted', canonicalPath: canonicalRel, newHash: this.deps.conflict.hash(proposed) }
  }
}
```

- [ ] **Step 4: Run → PASS (3). Run full `pnpm test`. Commit** — `feat(app-services): CurrentPromotionService (canonical promotion, ConflictManager-gated)`

---

# Part B — Electron app scaffold + typed IPC contract

> Part B sets up the Electron app and the BFF surface. The IPC **contract module** and the **container/handlers** are plain TS; the launch itself is Part D.

### Task B1: `apps/desktop` scaffold (electron-vite + React)

**Files:** Create `apps/desktop/package.json`, `electron.vite.config.ts`, `tsconfig.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`.

`apps/desktop/package.json`:
```json
{
  "name": "@apc/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "out/main/index.js",
  "scripts": { "dev": "electron-vite dev", "build": "electron-vite build", "start": "electron-vite preview" },
  "dependencies": {
    "@apc/shared": "workspace:*", "@apc/core": "workspace:*", "@apc/pm": "workspace:*",
    "@apc/dashboard-api": "workspace:*", "@apc/app-services": "workspace:*", "@apc/agents": "workspace:*",
    "@apc/search": "workspace:*", "@apc/vault": "workspace:*", "@apc/llm-wiki": "workspace:*", "@apc/harness": "workspace:*",
    "react": "^18.3.1", "react-dom": "^18.3.1", "zustand": "^4.5.0",
    "@xterm/xterm": "^5.5.0", "@xterm/addon-fit": "^0.10.0",
    "@homebridge/node-pty-prebuilt-multiarch": "^0.12.0"
  },
  "devDependencies": {
    "electron": "^31.0.0", "electron-vite": "^2.3.0", "@vitejs/plugin-react": "^4.3.0",
    "@testing-library/react": "^16.0.0", "jsdom": "^24.0.0"
  }
}
```

`electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['node:sqlite', '@homebridge/node-pty-prebuilt-multiarch'] } } },
  preload: {},
  renderer: { plugins: [react()] },
})
```

`src/main/index.ts` (minimal, wired further in Part D):
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js'), sandbox: false },
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('apc', {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),
  onPtyData: (cb: (id: string, data: string) => void) =>
    ipcRenderer.on('pty:data', (_e, id: string, data: string) => cb(id, data)),
})
```

`src/renderer/index.html`:
```html
<!doctype html><html><head><meta charset="utf-8"><title>Agent Project Console</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

`src/renderer/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
createRoot(document.getElementById('root')!).render(<App />)
```
(Create a stub `src/renderer/App.tsx` exporting `export function App() { return <div>Agent Project Console</div> }`; replaced in Part C.)

- [ ] **Step 1:** Create the files above; run `pnpm install`.
- [ ] **Step 2: Manual verification (dev machine):** `pnpm --filter @apc/desktop dev` opens a window showing "Agent Project Console". (Skipped on this headless box — see Environment reality.)
- [ ] **Step 3: Commit** — `feat(desktop): electron-vite + React app scaffold`

### Task B2: Typed IPC contract + container + handlers

**Files:** Create `src/shared/ipc-contract.ts`, `src/main/container.ts`, `src/main/ipc.ts`; test `src/main/ipc.test.ts` (handlers are plain async functions — testable without Electron).

**Behavior:** define channel names + request/response types once (shared by main+preload+renderer). `buildContainer(opts)` constructs the db (one `openDb` + all migrates), stores, registry, search, services. `registerIpc(ipcMain, container)` wires `ipcMain.handle(channel, …)`. Export a pure `handlers(container)` map so tests can call handlers directly without Electron.

`src/shared/ipc-contract.ts`:
```ts
import type { Project, Task, AgentRun, AgentProfile, Review, AgentType } from '@apc/shared'

export const CH = {
  listProjects: 'q:listProjects',
  projectDashboard: 'q:projectDashboard',
  search: 'q:search',
  listProfiles: 'q:listProfiles',
  ingestAll: 'c:ingestAll',
  submitReview: 'c:submitReview',
  promoteCurrent: 'c:promoteCurrent',
  selectProfile: 'c:selectProfile',
} as const

export type ProjectDashboardReq = { projectId: string }
export type ProjectDashboardRes = { project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[] }
export type SearchReq = { query: string; projectId?: string }
export type ListProfilesReq = { projectPath: string }
export type SubmitReviewReq = { review: Review }
export type PromoteCurrentReq = { projectId: string; lastReadHash: string }
export type SelectProfileReq = { taskId: string; profileId: string }
```

`handlers(container)` returns `Record<channel, (payload) => Promise<unknown>>`, e.g. `[CH.projectDashboard]: async (p: ProjectDashboardReq) => getProjectDashboard(container, p.projectId)`.

- [ ] **Step 1: Failing test** — build a container against `:memory:` dbs + a temp vault, register a project/task, call `handlers(container)[CH.projectDashboard]({ projectId })`, assert it returns the dashboard shape; call `[CH.submitReview]` and assert the task transitions. (Reuses the Plan 4 service behavior through the handler.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3:** Implement `ipc-contract.ts`, `container.ts` (wire stores+services from Plans 1–5 + Part A), `ipc.ts` (`handlers` map + `registerIpc` calling `ipcMain.handle`). Keep `registerIpc` a thin loop over `handlers`.
- [ ] **Step 4: Run → PASS. Commit** — `feat(desktop): typed IPC contract + container + handler map (BFF)`

---

# Part C — Renderer (React + Zustand) — component tests via jsdom

> `apps/desktop/vitest.config.ts` uses `environment: 'jsdom'`, `globals: true`, `plugins: [react()]`, and the `nodeSqlitePlugin` is NOT needed here (renderer never imports node:sqlite). Components receive data via props / a Zustand store fed by `window.apc`, so they test without Electron.

`apps/desktop/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', globals: true, include: ['src/renderer/**/*.test.tsx'] } })
```

### Task C1: `PmHome` component + test

**Behavior:** `PmHome` takes `{ dashboard: ProjectDashboardRes }` props and renders: project goal, Active Tasks list, Review Queue list, Recent Runs list. Pure presentational (data comes from the store).

- [ ] **Step 1: Failing test** (`src/renderer/components/PmHome.test.tsx`):

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { PmHome } from './PmHome.js'

const dashboard = {
  project: { id: 'p1', name: 'APC', status: 'active' as const, goal: 'ship MVP', projectType: 'git' as const, repoPaths: [], vaultPaths: [], sourcePaths: [] },
  activeTasks: [{ id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress' as const, assigneeType: 'agent' as const, priority: 'high' as const, reviewStatus: 'none' as const }],
  reviewQueue: [{ id: 'T2', projectId: 'p1', title: 'needs review', status: 'review' as const, assigneeType: 'agent' as const, priority: 'medium' as const, reviewStatus: 'pending' as const }],
  recentRuns: [{ id: 'R1', taskId: 'T1', agent: 'codex' as const, repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' as const }],
}

describe('PmHome', () => {
  test('renders goal, active tasks, review queue, recent runs', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.getByText('do work')).toBeDefined()
    expect(screen.getByText('needs review')).toBeDefined()
    expect(screen.getByText(/R1/)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @apc/desktop exec vitest run src/renderer/components/PmHome.test.tsx`).
- [ ] **Step 3: Implement** `PmHome.tsx` — sections with headings "Current Goal", "Active Tasks", "Review Queue", "Recent Runs"; map arrays to `<li>`.
- [ ] **Step 4: Run → PASS. Commit** — `feat(desktop): PmHome component`

### Task C2: `ModelPicker` component + test

**Behavior:** modal listing `['claude','codex','opencode']`; calls `onPick(engine)` when one is chosen; highlights `defaultEngine`. (Spec §9 model picker.)

- [ ] **Step 1: Failing test** — render `<ModelPicker defaultEngine="codex" onPick={spy} />`; click "claude"; assert `spy` called with `'claude'`; assert codex marked default.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `ModelPicker.tsx`.
- [ ] **Step 4: PASS. Commit** — `feat(desktop): ModelPicker (engine selection)`

### Task C3: `ReviewActions` component + test

**Behavior:** three buttons (Approve / Needs changes / Reject); each calls `onReview(status)`; an optional summary textarea whose value is passed along. (Drives Plan 4 `ReviewService` via IPC.)

- [ ] **Step 1: Failing test** — render with spy; type a summary; click "Approve"; assert `onReview` called with `{ status: 'approved', summary: '<typed>' }`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `ReviewActions.tsx`.
- [ ] **Step 4: PASS. Commit** — `feat(desktop): ReviewActions (approve/needs_changes/reject)`

### Task C4: store + `App` shell + `ProjectSidebar` + `HarnessPanel` (wiring)

**Behavior:** `store.ts` (Zustand) holds `{ projects, selectedProjectId, dashboard, profiles }` and async actions calling `api.ts` (typed wrapper over `window.apc.invoke`). `App.tsx` lays out the PM Control Tower: left `ProjectSidebar` (groups by status), center `PmHome`, right `HarnessPanel` (lists `AgentProfile`s read-only with a "use for task" select → `selectProfile`), bottom slot for the terminal (Part D). `ProjectSidebar`/`HarnessPanel` are presentational; test `HarnessPanel` renders profiles + fires `onSelect(profileId)`.

- [ ] **Step 1: Failing test** for `HarnessPanel` (renders profile names + scope + fires `onSelect`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `store.ts`, `api.ts`, `App.tsx`, `ProjectSidebar.tsx`, `HarnessPanel.tsx`.
- [ ] **Step 4: PASS (HarnessPanel test). Run full `pnpm test`. Commit** — `feat(desktop): PM Control Tower shell (store, sidebar, harness panel, layout)`

---

# Part D — Electron shell wiring + terminal (verified on a dev machine)

> ⚠️ Not runnable on this headless/compiler-less box. Each step is concrete; verification is manual on a dev machine with build tools + display (or `xvfb-run`). Run `pnpm --filter @apc/desktop exec electron-rebuild` after install so the prebuilt PTY matches the Electron ABI.

### Task D1: `pty-manager.ts` + terminal IPC

**Behavior:** `PtyManager` spawns a shell or an agent command via `@homebridge/node-pty-prebuilt-multiarch`, keyed by a session id; streams `data` to the renderer over `win.webContents.send('pty:data', id, data)`; accepts input via an IPC channel `pty:input`; `pty:start` takes `{ id, command, args, cwd }` (the command can be the chosen agent CLI for a task — wiring the Harness-selected profile). On exit, sends `pty:exit`.

```ts
import * as pty from '@homebridge/node-pty-prebuilt-multiarch'
import type { WebContents } from 'electron'

export class PtyManager {
  private readonly sessions = new Map<string, pty.IPty>()
  constructor(private readonly send: WebContents['send']) {}

  start(id: string, command: string, args: string[], cwd: string): void {
    const p = pty.spawn(command, args, { name: 'xterm-color', cols: 120, rows: 30, cwd, env: process.env as Record<string, string> })
    this.sessions.set(id, p)
    p.onData((data) => this.send('pty:data', id, data))
    p.onExit(({ exitCode }) => { this.send('pty:exit', id, exitCode); this.sessions.delete(id) })
  }
  write(id: string, data: string): void { this.sessions.get(id)?.write(data) }
  kill(id: string): void { this.sessions.get(id)?.kill(); this.sessions.delete(id) }
}
```

Wire in `main/index.ts`: construct `PtyManager(win.webContents.send.bind(win.webContents))`; `ipcMain.on('pty:start'|'pty:input'|'pty:kill', …)`.

- [ ] **Step 1:** Implement `pty-manager.ts` + main wiring + preload `pty:*` bridges.
- [ ] **Step 2: Manual verification (dev machine):** launch app, open a terminal tab, confirm a shell runs and echoes input, and that `xterm` displays streamed output.
- [ ] **Step 3: Commit** — `feat(desktop): node-pty terminal manager + IPC streaming`

### Task D2: `AgentTerminal.tsx` (xterm) + Agent Work Execution Panel

**Behavior:** mount an `xterm` `Terminal` with `FitAddon`; on mount call `window.apc.invoke('pty:start', {...})`; subscribe via `window.apc.onPtyData`; send keystrokes through `pty:input`. Tabs for Claude/Codex/OpenCode + the active task's run.

- [ ] **Step 1:** Implement `AgentTerminal.tsx`; place it in `App.tsx`'s bottom panel with tabs.
- [ ] **Step 2: Manual verification (dev machine):** start an agent CLI for a task from the UI; confirm I/O; on exit, trigger `RunService.completeRun` (transcript parsed by the matching adapter) and confirm the task flips to **review** with a generated summary + `current.proposal.md`.
- [ ] **Step 3: Commit** — `feat(desktop): AgentTerminal (xterm) + Agent Work Execution Panel`

### Task D3: end-to-end PM loop wiring

**Behavior:** connect the buttons: "Ingest now" → `ingestAll`; selecting a task shows its runs + summary; "Generate" → model picker → `RunService.completeRun`; review buttons → `submitReview` (Plan 4) → next-tasks appear; "Promote current" → `CurrentPromotionService.promote` (conflict-gated), showing a conflict notice + opening the conflict doc when returned.

- [ ] **Step 1:** Wire store actions → IPC for each.
- [ ] **Step 2: Manual verification (dev machine):** run the full loop on a real project (create task → run agent in terminal → generate summary → review → promote current), and confirm vault files appear and Obsidian can open them.
- [ ] **Step 3: Commit** — `feat(desktop): end-to-end PM loop wiring (ingest/generate/review/promote)`

---

## Definition of Done (Plan 6)

- [ ] `pnpm test` green incl. `@apc/app-services` (Part A) and `@apc/desktop` renderer component tests (Part C).
- [ ] `IngestService` / `RunService` / `CurrentPromotionService` compose Plans 1–5 with full unit coverage (Part A).
- [ ] Typed IPC contract + container + handler map exist and are unit-tested without Electron (Part B).
- [ ] PM Control Tower renders (PmHome / ModelPicker / ReviewActions / HarnessPanel) with passing jsdom tests (Part C).
- [ ] Electron shell + `node-pty` terminal are implemented to spec and pass the **manual** dev-machine verifications (Part D), using the prebuilt PTY + `electron-rebuild`.

## Environment caveats recap

- `node-pty` (native) and Electron (display) cannot run on this headless WSL2 box; Part D is verified on a dev machine. Everything else (Parts A–C) is auto-tested here.
- Keep using `node:sqlite` in `main` (mark it `external` in the electron-vite main build, as shown).
