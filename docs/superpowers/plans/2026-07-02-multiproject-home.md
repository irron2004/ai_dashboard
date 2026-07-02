# Implementation Plan — P3: 멀티프로젝트 홈 (cross-project overview)

## Goal

Give the console one screen that answers "across **all** projects, what is in progress, what is running, and what is waiting for review?" — today every view is scoped to the single selected project (handoff `docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md` §4 P3).

Concretely:

1. **Aggregate API** — `packages/dashboard-api` gains `buildWorkspaceOverview()` returning per-project `{activeTaskCount, runningRuns, reviewQueueCount, nextUp}` (the FIXED SEAM below).
2. **Store plumbing** — `AgentRunStore.listRunning()` (all in-flight runs, one query) so the aggregate can attribute running runs to projects.
3. **Altitude fix** — the pure task-dependency helpers (`isBlocked` / `unresolvedBlockers` / `nextUp`) move from `apps/desktop/src/renderer/task-deps.ts` (a renderer file) down into `packages/dashboard-api/src/task-deps.ts` so the main-process aggregate can reuse `nextUp`; the renderer imports them from `@apc/dashboard-api`.
4. **IPC** — a `q:workspaceOverview` query channel wired through the 4-file pattern (contract → container → handler → api).
5. **UI** — a `🌐 전체` MainTab rendering a new `WorkspaceHome` (per-project cards: counts, running runs, top-3 next-up, click → open project), plus small running/review **badges** on each project button in `ProjectSidebar`, both fed by the same overview data (fetch-on-tab-open + refresh button; **no** websocket/polling).

### FIXED SEAM (a parallel P4 planner is given the identical contract — do NOT rename `buildWorkspaceOverview`, `WorkspaceOverview`, `ProjectOverview`):

```ts
export type ProjectOverview = {
  project: Project              // from @apc/shared
  activeTaskCount: number       // status todo|in_progress
  runningRuns: AgentRun[]       // status==='running', newest first
  reviewQueueCount: number      // status==='review'
  nextUp: Task[]                // top 3 unblocked actionable tasks (P1 semantics), priority then dueDate
}
export type WorkspaceOverview = { generatedAt: string; projects: ProjectOverview[] }
export function buildWorkspaceOverview(deps: { registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }): WorkspaceOverview
```

`{ registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }` is **structurally identical** to the existing `DashboardDeps` in `project-dashboard.ts`, so the implementation reuses `DashboardDeps` as the param type (the seam only fixes the three exported *names*, not the deps type name).

## Architecture (data flow this plan touches)

```
packages/pm/src/agent-run-store.ts        AgentRunStore.listRunning(): AgentRun[]  (SELECT status='running' ORDER BY started_at DESC)

packages/dashboard-api/src/task-deps.ts       isBlocked / unresolvedBlockers / nextUp  (MOVED here from renderer; pure)
packages/dashboard-api/src/workspace-overview.ts  buildWorkspaceOverview + WorkspaceOverview + ProjectOverview
  └─ reuses DashboardDeps (project-dashboard.ts), nextUp (task-deps.ts), runs.listRunning()
packages/dashboard-api/src/index.ts           re-export task-deps.js + workspace-overview.js

apps/desktop/src/shared/ipc-contract.ts       CH.workspaceOverview = 'q:workspaceOverview'   (append-only; P4 also edits this file)
  └─ apps/desktop/src/main/container.ts        workspaceOverview: () => buildWorkspaceOverview({registry,tasks,runs})
  └─ apps/desktop/src/main/ipc.ts              handler: container.workspaceOverview()
  └─ apps/desktop/src/renderer/api.ts          api.workspaceOverview(): Promise<WorkspaceOverview>
  (preload NOT changed — generic window.apc.invoke already carries every query channel)

apps/desktop/src/renderer/store.ts             workspaceOverview state + loadWorkspaceOverview()
apps/desktop/src/renderer/components/WorkspaceHome.tsx  (new, pure; props: overview / onRefresh / onOpenProject)
apps/desktop/src/renderer/components/MainPanel.tsx      '🌐 전체' tab → <WorkspaceHome/>
apps/desktop/src/renderer/components/ProjectSidebar.tsx optional `badges` prop → running/review counts on each button
apps/desktop/src/renderer/App.tsx              fetch on tab open + refresh, derive badges, onOpenProject = selectProject + go home
apps/desktop/src/renderer/app.css              .workspace-home / .workspace-card / .project-sidebar__badge styles

renderer runtime imports of @apc/dashboard-api need NO electron.vite.config change: the renderer already
imports @apc/graph-view and @apc/harness at runtime with no per-package alias (electron-vite resolves
workspace deps via node_modules + package.json main). vitest.config.ts already lists 'dashboard-api'.
```

## Tech stack

- TypeScript, Zod (`@apc/shared`), `node:sqlite` (`DatabaseSync`) via `@apc/core` / `@apc/pm`.
- Tests: Vitest workspace (`packages/*` + `apps/desktop`). Renderer component tests use `@testing-library/react` in jsdom (`.test.tsx` → jsdom via `environmentMatchGlobs`); pure `.ts` tests run in node.
- Electron IPC: single `CH` source in `apps/desktop/src/shared/ipc-contract.ts`; queries flow through the generic `window.apc.invoke` bridge (preload untouched).
- State: Zustand store (`apps/desktop/src/renderer/store.ts`).

## Global constraints (read before every task)

- **TDD, strict order per task**: write the failing test → run it → confirm it fails for the expected reason → write the minimal implementation → run it green → next test. Tests are colocated (`*.test.ts` / `*.test.tsx`).
- **Run a single test/file (from repo root)**: `npx vitest run <path-or-substring>`. **Full suite `pnpm test` (~2.5 min) is run ONLY in the final task.** **Typecheck authority**: `pnpm typecheck` (`tsc -p tsconfig.typecheck.json && tsc -p apps/desktop/tsconfig.json --noEmit`). IDE diagnostics are unreliable — ignore `@xterm/*`, `node:sqlite not found`, `node-pty-*` noise.
- **`pnpm typecheck` includes test files.** Any new `Task` fixture literal MUST include `blockedBy: []` (P1 made it output-required on `Task`); omitting it fails typecheck with `Property 'blockedBy' is missing`.
- **Commit after each task** (conventional commits + trailer). Template:
  ```
  git add -A && git commit -m "<type>(<scope>): <summary>

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```
  scopes in use: `shared`, `pm`, `desktop`, `dashboard-api`.
- **Do NOT** add values to `AgentKind` / `RunAgent`. **Do NOT** touch anything outside this repo. **Do NOT** switch git branches (stay on the checked-out branch).
- **Append-style additions in shared files.** `ipc-contract.ts`, `container.ts`, and `api.ts` are ALSO edited by a parallel **P4** (원격 대시보드). Add new lines; do not reorder/reflow existing blocks, so the two branches merge cleanly.
- **run→project attribution decision (locked):** `AgentRunStore.listRunning()` returns *all* running runs (single-table query, newest first). `buildWorkspaceOverview` groups them per project by intersecting with each project's own task-id set (the task list it already fetches for the counts). We do **not** add a JOIN method and do **not** attribute via `run.repoPath` — `repoPath` can be shared/ambiguous (esp. `ssh://`), whereas `run.taskId → task.projectId` is authoritative. This keeps the store method simple (matches the seam) and puts the pure mapping in the unit-testable assembler with zero extra DB round-trips.

---

## Task 1 — Move the pure task-deps helpers into `@apc/dashboard-api` (altitude fix)

**Why first:** `buildWorkspaceOverview` (Task 3) lives in the main-process package `@apc/dashboard-api` and needs `nextUp`. Today `nextUp`/`isBlocked`/`unresolvedBlockers` live in `apps/desktop/src/renderer/task-deps.ts` — a renderer file a main-process package must not import. `@apc/dashboard-api` already depends on `@apc/shared`, so it is the correct home. This task is a pure move + re-point of the two existing renderer importers; behavior is unchanged.

### Files
- NEW `packages/dashboard-api/src/task-deps.ts`
- NEW `packages/dashboard-api/src/task-deps.test.ts`
- EDIT `packages/dashboard-api/src/index.ts`
- EDIT `apps/desktop/src/renderer/components/PmHome.tsx` (import path)
- EDIT `apps/desktop/src/renderer/components/TaskBoard.tsx` (import path)
- DELETE `apps/desktop/src/renderer/task-deps.ts`
- DELETE `apps/desktop/src/renderer/task-deps.test.ts`

### Steps

1. **Confirm the only importers** (must print exactly the two components + the test being deleted):
   ```
   grep -rn "task-deps" apps/desktop/src/renderer
   ```
   Expected: `task-deps.test.ts`, `components/PmHome.tsx`, `components/TaskBoard.tsx`. If anything else appears, re-point it in step 5 too.

2. **Failing test** — create `packages/dashboard-api/src/task-deps.test.ts` (moved verbatim from the renderer test; import is `./task-deps.js`):
   ```ts
   import { describe, expect, test } from 'vitest'
   import type { Task } from '@apc/shared'
   import { unresolvedBlockers, isBlocked, nextUp } from './task-deps.js'

   const t = (id: string, status: Task['status'], extra: Partial<Task> = {}): Task => ({
     id, projectId: 'p1', title: id, status, assigneeType: 'agent', priority: 'medium',
     reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], ...extra,
   })

   describe('unresolvedBlockers / isBlocked', () => {
     test('a not-done blocker blocks the task', () => {
       const list = [t('A', 'todo', { blockedBy: ['B'] }), t('B', 'in_progress')]
       const byId = new Map(list.map((x) => [x.id, x]))
       expect(isBlocked(list[0], byId)).toBe(true)
       expect(unresolvedBlockers(list[0], byId).map((b) => b.id)).toEqual(['B'])
     })
     test('a done blocker and a missing blocker do not block', () => {
       const list = [t('A', 'todo', { blockedBy: ['B', 'ghost'] }), t('B', 'done')]
       const byId = new Map(list.map((x) => [x.id, x]))
       expect(isBlocked(list[0], byId)).toBe(false)
     })
   })

   describe('nextUp', () => {
     test('unblocked todo/in_progress, sorted by priority then dueDate', () => {
       const list = [
         t('done', 'done'),
         t('blocked', 'todo', { priority: 'high', blockedBy: ['open'] }),
         t('open', 'in_progress', { priority: 'low' }),
         t('p-high', 'todo', { priority: 'high', dueDate: '2026-07-10' }),
         t('p-high-sooner', 'todo', { priority: 'high', dueDate: '2026-07-01' }),
         t('p-med', 'todo', { priority: 'medium' }),
       ]
       expect(nextUp(list).map((x) => x.id)).toEqual(['p-high-sooner', 'p-high', 'p-med', 'open'])
     })
     test('respects the limit', () => {
       expect(nextUp([t('a', 'todo'), t('b', 'todo'), t('c', 'todo')], 2)).toHaveLength(2)
     })
   })
   ```
   Run: `npx vitest run packages/dashboard-api/src/task-deps.test.ts` → **fails** (`Cannot find module './task-deps.js'`).

3. **Implement** — create `packages/dashboard-api/src/task-deps.ts` (moved verbatim from the renderer file):
   ```ts
   import type { Task } from '@apc/shared'

   export const PRIORITY_ORDER: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 }

   /** Blocker tasks that still block this one: they exist in the map AND are not done. */
   export function unresolvedBlockers(task: Task, byId: Map<string, Task>): Task[] {
     return task.blockedBy
       .map((id) => byId.get(id))
       .filter((b): b is Task => b !== undefined && b.status !== 'done')
   }

   export function isBlocked(task: Task, byId: Map<string, Task>): boolean {
     return unresolvedBlockers(task, byId).length > 0
   }

   /** Actionable tasks: todo/in_progress and unblocked; sorted priority then dueDate; capped at `limit`. */
   export function nextUp(tasks: Task[], limit = 5): Task[] {
     const byId = new Map(tasks.map((t) => [t.id, t]))
     return tasks
       .filter((t) => (t.status === 'todo' || t.status === 'in_progress') && !isBlocked(t, byId))
       .sort((a, b) =>
         PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
         (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'))
       .slice(0, limit)
   }
   ```
   Run: `npx vitest run packages/dashboard-api/src/task-deps.test.ts` → **passes**.

4. **Re-export** — edit `packages/dashboard-api/src/index.ts` to:
   ```ts
   export * from './project-dashboard.js'
   export * from './task-deps.js'
   ```

5. **Re-point the renderer importers**, then delete the old files:
   - `apps/desktop/src/renderer/components/PmHome.tsx`: change `import { nextUp } from '../task-deps.js'` → `import { nextUp } from '@apc/dashboard-api'`.
   - `apps/desktop/src/renderer/components/TaskBoard.tsx`: change `import { unresolvedBlockers } from '../task-deps.js'` → `import { unresolvedBlockers } from '@apc/dashboard-api'`.
   - Delete both renderer files:
     ```
     rm apps/desktop/src/renderer/task-deps.ts apps/desktop/src/renderer/task-deps.test.ts
     ```

6. **Regression** — the two components must still pass with the new import:
   ```
   npx vitest run apps/desktop/src/renderer/components/PmHome apps/desktop/src/renderer/components/TaskBoard
   ```
   Expected: all passing (identical helpers, only the import path changed).

7. **Typecheck** (authoritative; proves both root and desktop resolve `@apc/dashboard-api`):
   ```
   pnpm typecheck
   ```
   Expected: clean. (No electron.vite.config change is needed — the renderer already imports `@apc/graph-view`/`@apc/harness` at runtime without per-package aliases; `vitest.config.ts` already lists `dashboard-api`.)

8. **Commit**:
   ```
   git add -A && git commit -m "refactor(dashboard-api): move pure task-deps helpers from renderer

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 2 — `AgentRunStore.listRunning()`

**Why:** `buildWorkspaceOverview` needs every in-flight run in one query so it can attribute them to projects. `AgentRunStore` currently only has `listByTask`.

### Files
- EDIT `packages/pm/src/agent-run-store.ts`
- EDIT `packages/pm/src/agent-run-store.test.ts`

### Steps

1. **Failing test** — add inside `describe('AgentRunStore', ...)` in `packages/pm/src/agent-run-store.test.ts` (the fixture `run` at the top is already `status: 'running'`, taskId `TASK-001`):
   ```ts
   test('listRunning returns only running runs across tasks, newest first', () => {
     store.create(run)                                                                     // RUN-1 running @10:00
     store.create({ ...run, id: 'RUN-2', taskId: 'TASK-002', startedAt: '2026-06-01T12:00:00Z' }) // running @12:00
     store.create({ ...run, id: 'RUN-3', startedAt: '2026-06-01T09:00:00Z', status: 'completed', endedAt: '2026-06-01T09:30:00Z' })
     expect(store.listRunning().map((r) => r.id)).toEqual(['RUN-2', 'RUN-1'])
   })
   ```
   Run: `npx vitest run packages/pm/src/agent-run-store.test.ts` → **fails** (`store.listRunning is not a function`).

2. **Implement** — add to `class AgentRunStore` in `packages/pm/src/agent-run-store.ts` (after `listByTask`):
   ```ts
   /** All in-flight runs across every task, newest first. Powers the cross-project workspace overview. */
   listRunning(): AgentRun[] {
     const rows = this.db.prepare(
       "SELECT * FROM agent_runs WHERE status = 'running' ORDER BY started_at DESC",
     ).all() as Row[]
     return rows.map(toRun)
   }
   ```
   Run: `npx vitest run packages/pm/src/agent-run-store.test.ts` → **passes**.

3. **Typecheck**: `pnpm typecheck` → clean.

4. **Commit**:
   ```
   git add -A && git commit -m "feat(pm): AgentRunStore.listRunning() for cross-project overview

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 3 — `buildWorkspaceOverview` + `WorkspaceOverview` / `ProjectOverview`

**Why:** the aggregate at the heart of P3 (the FIXED SEAM). Mirrors `getProjectDashboard`'s style and its in-memory-DB test.

### Files
- NEW `packages/dashboard-api/src/workspace-overview.ts`
- NEW `packages/dashboard-api/src/workspace-overview.test.ts`
- EDIT `packages/dashboard-api/src/index.ts`

### Interface
```ts
export type ProjectOverview = { project: Project; activeTaskCount: number; runningRuns: AgentRun[]; reviewQueueCount: number; nextUp: Task[] }
export type WorkspaceOverview = { generatedAt: string; projects: ProjectOverview[] }
export function buildWorkspaceOverview(deps: DashboardDeps): WorkspaceOverview
```

### Steps

1. **Failing test** — create `packages/dashboard-api/src/workspace-overview.test.ts` (mirrors `project-dashboard.test.ts`):
   ```ts
   import { beforeEach, describe, expect, test } from 'vitest'
   import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
   import { migratePm, TaskStore, AgentRunStore } from '@apc/pm'
   import { buildWorkspaceOverview } from './workspace-overview.js'

   describe('buildWorkspaceOverview', () => {
     let db: Db; let registry: ProjectRegistry; let tasks: TaskStore; let runs: AgentRunStore
     beforeEach(() => {
       db = openDb(':memory:'); migrate(db); migratePm(db)
       registry = new ProjectRegistry(db); tasks = new TaskStore(db); runs = new AgentRunStore(db)
       registry.register({ id: 'a', name: 'Alpha', status: 'active', projectType: 'git', repoPaths: ['/a'], vaultPaths: [], sourcePaths: [], domain: 'project-docs' })
       registry.register({ id: 'b', name: 'Beta', status: 'active', projectType: 'git', repoPaths: ['/b'], vaultPaths: [], sourcePaths: [], domain: 'paper' })
       // Alpha: 3 active (2 todo + 1 in_progress), 1 review; a-blocked is high but blocked by a-prog
       tasks.create({ id: 'a-todo', projectId: 'a', title: 'a todo', status: 'todo', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
       tasks.create({ id: 'a-prog', projectId: 'a', title: 'a prog', status: 'in_progress', assigneeType: 'agent', priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
       tasks.create({ id: 'a-rev', projectId: 'a', title: 'a review', status: 'review', assigneeType: 'agent', priority: 'low', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
       tasks.create({ id: 'a-blocked', projectId: 'a', title: 'blocked', status: 'todo', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: ['a-prog'] })
       // Beta: 1 active
       tasks.create({ id: 'b-todo', projectId: 'b', title: 'b todo', status: 'todo', assigneeType: 'agent', priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
       // runs: two running on Alpha tasks, one completed on a Beta task
       runs.create({ id: 'R-old', taskId: 'a-todo', agent: 'codex', repoPath: '/a', startedAt: '2026-06-01T10:00:00Z', status: 'running' })
       runs.create({ id: 'R-new', taskId: 'a-prog', agent: 'claude', repoPath: '/a', startedAt: '2026-06-01T12:00:00Z', status: 'running' })
       runs.create({ id: 'R-done', taskId: 'b-todo', agent: 'codex', repoPath: '/b', startedAt: '2026-06-01T11:00:00Z', status: 'completed', endedAt: '2026-06-01T11:30:00Z' })
     })

     test('aggregates counts, running runs (newest first, project-scoped) and nextUp per project', () => {
       const ov = buildWorkspaceOverview({ registry, tasks, runs })
       expect(ov.projects.map((p) => p.project.id)).toEqual(['a', 'b'])   // registry.list() ORDER BY id
       const a = ov.projects.find((p) => p.project.id === 'a')!
       expect(a.activeTaskCount).toBe(3)                                    // a-todo, a-prog, a-blocked
       expect(a.reviewQueueCount).toBe(1)
       expect(a.runningRuns.map((r) => r.id)).toEqual(['R-new', 'R-old'])  // newest first, only Alpha's
       expect(a.nextUp.map((t) => t.id)).toEqual(['a-todo', 'a-prog'])     // unblocked, high→medium; a-blocked excluded
       const b = ov.projects.find((p) => p.project.id === 'b')!
       expect(b.activeTaskCount).toBe(1)
       expect(b.runningRuns).toEqual([])                                    // its only run is completed
     })

     test('generatedAt is an ISO-8601 timestamp', () => {
       expect(buildWorkspaceOverview({ registry, tasks, runs }).generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
     })

     test('nextUp caps at 3 unblocked actionable tasks', () => {
       for (let i = 0; i < 5; i++) {
         tasks.create({ id: `a-x${i}`, projectId: 'a', title: `x${i}`, status: 'todo', assigneeType: 'agent', priority: 'low', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
       }
       const a = buildWorkspaceOverview({ registry, tasks, runs }).projects.find((p) => p.project.id === 'a')!
       expect(a.nextUp).toHaveLength(3)
     })
   })
   ```
   Run: `npx vitest run packages/dashboard-api/src/workspace-overview.test.ts` → **fails** (`Cannot find module './workspace-overview.js'`).

2. **Implement** — create `packages/dashboard-api/src/workspace-overview.ts`:
   ```ts
   import type { AgentRun, Project, Task } from '@apc/shared'
   import type { DashboardDeps } from './project-dashboard.js'
   import { nextUp } from './task-deps.js'

   export type ProjectOverview = {
     project: Project
     activeTaskCount: number   // status todo|in_progress
     runningRuns: AgentRun[]   // status==='running', newest first
     reviewQueueCount: number  // status==='review'
     nextUp: Task[]            // top 3 unblocked actionable tasks (P1 semantics), priority then dueDate
   }
   export type WorkspaceOverview = { generatedAt: string; projects: ProjectOverview[] }

   /**
    * Cross-project overview for the 멀티프로젝트 홈. Running runs are attributed to a project by
    * intersecting the global running set with each project's own task ids (run.taskId → task.projectId);
    * run.repoPath is intentionally NOT used for attribution (it can be shared/ambiguous, esp. ssh://).
    */
   export function buildWorkspaceOverview(deps: DashboardDeps): WorkspaceOverview {
     const running = deps.runs.listRunning()  // all in-flight, newest first
     const projects = deps.registry.list().map((project): ProjectOverview => {
       const tasks = deps.tasks.listByProject(project.id)
       const taskIds = new Set(tasks.map((t) => t.id))
       return {
         project,
         activeTaskCount: tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress').length,
         reviewQueueCount: tasks.filter((t) => t.status === 'review').length,
         runningRuns: running.filter((r) => taskIds.has(r.taskId)),  // preserves newest-first order
         nextUp: nextUp(tasks, 3),
       }
     })
     return { generatedAt: new Date().toISOString(), projects }
   }
   ```
   Run: `npx vitest run packages/dashboard-api/src/workspace-overview.test.ts` → **passes**.

3. **Re-export** — edit `packages/dashboard-api/src/index.ts` to:
   ```ts
   export * from './project-dashboard.js'
   export * from './task-deps.js'
   export * from './workspace-overview.js'
   ```

4. **Typecheck**: `pnpm typecheck` → clean.

5. **Commit**:
   ```
   git add -A && git commit -m "feat(dashboard-api): buildWorkspaceOverview cross-project aggregate

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 4 — IPC `q:workspaceOverview` (contract → container → handler → api) + handler test

**Why:** expose the aggregate to the renderer. Queries use the generic `invoke` bridge, so **preload is not touched**. Additions are append-only (P4 also edits these three files).

### Files
- EDIT `apps/desktop/src/shared/ipc-contract.ts`
- EDIT `apps/desktop/src/main/container.ts`
- EDIT `apps/desktop/src/main/ipc.ts`
- EDIT `apps/desktop/src/renderer/api.ts`
- EDIT `apps/desktop/src/main/ipc.test.ts`

### Steps

1. **Failing test** — add to `describe('IPC handlers (no Electron)', ...)` in `apps/desktop/src/main/ipc.test.ts` (the `beforeEach` already seeds project `p1` with task `T1` in_progress and run `R1` **running**):
   ```ts
   test('q:workspaceOverview aggregates active count + running runs across projects', async () => {
     const h = handlers(container)
     const res = await h[CH.workspaceOverview]({}) as import('@apc/dashboard-api').WorkspaceOverview
     const p1 = res.projects.find((p) => p.project.id === 'p1')!
     expect(p1.activeTaskCount).toBe(1)
     expect(p1.runningRuns.map((r) => r.id)).toEqual(['R1'])
     expect(typeof res.generatedAt).toBe('string')
   })
   ```
   Run: `npx vitest run apps/desktop/src/main/ipc.test.ts` → **fails** to compile (`CH.workspaceOverview` does not exist).

2. **Contract** — in `apps/desktop/src/shared/ipc-contract.ts`, in the `CH` object's `// queries` block add one line after `tasksList: 'q:tasksList',`:
   ```ts
   tasksList: 'q:tasksList',
   workspaceOverview: 'q:workspaceOverview',
   ```
   (No request/response types are added here — the response type `WorkspaceOverview` is imported from `@apc/dashboard-api` where it is consumed, mirroring how the renderer already consumes dashboard-api. This avoids duplicating the seam type inline and keeps `ipc-contract`'s imports limited to `@apc/shared`. The payload is an ignored `{}`.)

3. **Container** — in `apps/desktop/src/main/container.ts`:
   - Extend the existing dashboard-api import:
     ```ts
     import { getProjectDashboard, buildWorkspaceOverview, type WorkspaceOverview } from '@apc/dashboard-api'
     ```
   - In the `export type Container = { ... }` block, add next to `dashboard: typeof getProjectDashboard`:
     ```ts
     workspaceOverview: () => WorkspaceOverview
     ```
   - In the final `return { ... }` object, add next to `dashboard: getProjectDashboard,`:
     ```ts
     workspaceOverview: () => buildWorkspaceOverview({ registry, tasks, runs }),
     ```

4. **Handler** — in `apps/desktop/src/main/ipc.ts`, add after the `[CH.tasksList]` handler:
   ```ts
   [CH.workspaceOverview]: async (_payload: unknown) => {
     return container.workspaceOverview()
   },
   ```

5. **Renderer api** — in `apps/desktop/src/renderer/api.ts`:
   - Add an import (type-only; renderer already resolves `@apc/dashboard-api`):
     ```ts
     import type { WorkspaceOverview } from '@apc/dashboard-api'
     ```
   - Add a method to the `api` object, after `tasksList(...)`:
     ```ts
     workspaceOverview(): Promise<WorkspaceOverview> {
       return window.apc.invoke(CH.workspaceOverview) as Promise<WorkspaceOverview>
     },
     ```

6. **Green** — `npx vitest run apps/desktop/src/main/ipc.test.ts` → **passes** (the new test plus the pre-existing handler tests).

7. **Typecheck**: `pnpm typecheck` → clean.

8. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): q:workspaceOverview IPC channel

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 5 — `WorkspaceHome` component (pure) + test + CSS

**Why:** the screen itself. Kept **pure** (props only: `overview` / `onRefresh` / `onOpenProject`) so it tests like `PmHome` with plain fixtures — no store/api mocking. App owns the fetch (Task 8).

### Files
- NEW `apps/desktop/src/renderer/components/WorkspaceHome.tsx`
- NEW `apps/desktop/src/renderer/components/WorkspaceHome.test.tsx`
- EDIT `apps/desktop/src/renderer/app.css`

### Steps

1. **Failing test** — create `apps/desktop/src/renderer/components/WorkspaceHome.test.tsx`:
   ```tsx
   import { render, screen, fireEvent, within } from '@testing-library/react'
   import { describe, expect, test, vi } from 'vitest'
   import type { WorkspaceOverview } from '@apc/dashboard-api'
   import { WorkspaceHome } from './WorkspaceHome.js'

   const overview: WorkspaceOverview = {
     generatedAt: '2026-07-02T00:00:00.000Z',
     projects: [
       {
         project: { id: 'a', name: 'Alpha', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: [], vaultPaths: [], sourcePaths: [] },
         activeTaskCount: 2, reviewQueueCount: 1,
         runningRuns: [{ id: 'R1', taskId: 'T1', agent: 'claude', repoPath: '/a', startedAt: '2026-07-02T09:30:00Z', status: 'running' }],
         nextUp: [{ id: 'T1', projectId: 'a', title: 'first task', status: 'todo', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] }],
       },
     ],
   }

   describe('WorkspaceHome', () => {
     test('shows a loading state when overview is null', () => {
       render(<WorkspaceHome overview={null} onRefresh={() => {}} onOpenProject={() => {}} />)
       expect(screen.getByText('불러오는 중…')).toBeDefined()
     })

     test('renders a per-project card with counts, running runs, and nextUp', () => {
       render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={() => {}} />)
       const card = screen.getByTestId('workspace-card-a')
       expect(within(card).getByText('Alpha')).toBeDefined()
       expect(within(card).getByText('진행중 2')).toBeDefined()
       expect(within(card).getByText('실행중 1')).toBeDefined()
       expect(within(card).getByText('리뷰 1')).toBeDefined()
       expect(within(card).getByText('claude')).toBeDefined()      // run-status span (exact)
       expect(within(card).getByText('first task')).toBeDefined()
     })

     test('clicking the project title calls onOpenProject', () => {
       const onOpenProject = vi.fn()
       render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={onOpenProject} />)
       fireEvent.click(screen.getByText('Alpha'))
       expect(onOpenProject).toHaveBeenCalledWith('a')
     })

     test('clicking a nextUp task opens its project', () => {
       const onOpenProject = vi.fn()
       render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={onOpenProject} />)
       fireEvent.click(screen.getByText('first task'))
       expect(onOpenProject).toHaveBeenCalledWith('a')
     })

     test('the refresh button fires onRefresh', () => {
       const onRefresh = vi.fn()
       render(<WorkspaceHome overview={overview} onRefresh={onRefresh} onOpenProject={() => {}} />)
       fireEvent.click(screen.getByLabelText('전체 새로고침'))
       expect(onRefresh).toHaveBeenCalled()
     })
   })
   ```
   Run: `npx vitest run apps/desktop/src/renderer/components/WorkspaceHome.test.tsx` → **fails** (`Cannot find module './WorkspaceHome.js'`).

2. **Implement** — create `apps/desktop/src/renderer/components/WorkspaceHome.tsx`:
   ```tsx
   import type { WorkspaceOverview } from '@apc/dashboard-api'

   type Props = {
     overview: WorkspaceOverview | null
     onRefresh: () => void
     onOpenProject: (projectId: string) => void
   }

   /** hh:mm for a run's startedAt; falls back to the raw string if unparseable. */
   function runTime(iso: string): string {
     const d = new Date(iso)
     return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
   }

   export function WorkspaceHome({ overview, onRefresh, onOpenProject }: Props) {
     return (
       <div className="workspace-home">
         <header className="workspace-home__header">
           <h2>🌐 전체 프로젝트</h2>
           <button type="button" onClick={onRefresh} aria-label="전체 새로고침">⟳ 새로고침</button>
         </header>
         {!overview ? (
           <p className="workspace-home__empty">불러오는 중…</p>
         ) : overview.projects.length === 0 ? (
           <p className="workspace-home__empty">프로젝트 없음</p>
         ) : (
           <div className="workspace-home__grid">
             {overview.projects.map((p) => (
               <section key={p.project.id} className="workspace-card" data-testid={`workspace-card-${p.project.id}`}>
                 <header className="workspace-card__head">
                   <button type="button" className="workspace-card__title" onClick={() => onOpenProject(p.project.id)}>
                     {p.project.name}
                   </button>
                   <span className="workspace-card__domain">{p.project.domain}</span>
                 </header>
                 <div className="workspace-card__badges">
                   <span className="workspace-card__badge">진행중 {p.activeTaskCount}</span>
                   {p.runningRuns.length > 0 && (
                     <span className="workspace-card__badge workspace-card__badge--running">실행중 {p.runningRuns.length}</span>
                   )}
                   {p.reviewQueueCount > 0 && (
                     <span className="workspace-card__badge workspace-card__badge--review">리뷰 {p.reviewQueueCount}</span>
                   )}
                 </div>
                 {p.runningRuns.length > 0 && (
                   <ul className="workspace-card__runs">
                     {p.runningRuns.map((r) => (
                       <li key={r.id}><span className="run-status">{r.agent}</span> · {runTime(r.startedAt)}</li>
                     ))}
                   </ul>
                 )}
                 <div className="workspace-card__next">
                   <h3>다음 할 일</h3>
                   {p.nextUp.length === 0 ? (
                     <p className="workspace-home__empty">없음</p>
                   ) : (
                     <ol className="workspace-card__next-list">
                       {p.nextUp.map((t) => (
                         <li key={t.id}>
                           <button type="button" className="workspace-card__task" onClick={() => onOpenProject(p.project.id)}>
                             {t.title}
                           </button>
                         </li>
                       ))}
                     </ol>
                   )}
                 </div>
               </section>
             ))}
           </div>
         )}
       </div>
     )
   }
   ```
   Run: `npx vitest run apps/desktop/src/renderer/components/WorkspaceHome.test.tsx` → **passes**.

3. **CSS** — append to `apps/desktop/src/renderer/app.css` (styles consistent with `.pm-home`/`.panel` dark theme):
   ```css
   .workspace-home { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
   .workspace-home__header { display: flex; align-items: center; gap: 12px; }
   .workspace-home__header h2 { font-size: 0.9rem; margin: 0; }
   .workspace-home__header button { padding: 4px 11px; font-size: 0.8rem; }
   .workspace-home__empty { opacity: 0.5; font-size: 0.82rem; }
   .workspace-home__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
   .workspace-card { background: #232338; border: 1px solid #2c2c2c; border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
   .workspace-card__head { display: flex; align-items: baseline; gap: 8px; }
   .workspace-card__title { background: none; border: none; color: #cfcfff; font-size: 0.92rem; font-weight: 600; cursor: pointer; padding: 0; text-align: left; }
   .workspace-card__title:hover { text-decoration: underline; }
   .workspace-card__domain { font-size: 0.72rem; opacity: 0.55; margin-left: auto; }
   .workspace-card__badges { display: flex; flex-wrap: wrap; gap: 6px; }
   .workspace-card__badge { font-size: 0.72rem; padding: 2px 7px; border-radius: 10px; background: #2a2a40; color: #cfcfff; }
   .workspace-card__badge--running { background: #1f3a24; color: #8fe0a2; }
   .workspace-card__badge--review { background: #3a331f; color: #e6d17a; }
   .workspace-card__runs { margin: 0; padding-left: 16px; font-size: 0.78rem; opacity: 0.85; }
   .workspace-card__next h3 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; margin: 4px 0; }
   .workspace-card__next-list { margin: 0; padding-left: 16px; }
   .workspace-card__task { background: none; border: none; color: #ddd; cursor: pointer; padding: 2px 0; text-align: left; font-size: 0.82rem; }
   .workspace-card__task:hover { color: #fff; text-decoration: underline; }
   ```

4. **Typecheck**: `pnpm typecheck` → clean.

5. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): WorkspaceHome cross-project cards

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 6 — `🌐 전체` tab in `MainPanel`

**Why:** the entry point to `WorkspaceHome`. Extends the `MainTab` union and the `TABS` list; forwards the three `WorkspaceHome` props (optional so the existing `MainPanel` tests need no props).

### Files
- EDIT `apps/desktop/src/renderer/components/MainPanel.tsx`
- EDIT `apps/desktop/src/renderer/components/MainPanel.test.tsx`

### Steps

1. **Failing test** — in `apps/desktop/src/renderer/components/MainPanel.test.tsx`:
   - Add a mock alongside the existing ones (near the top):
     ```tsx
     vi.mock('./WorkspaceHome.js', () => ({ WorkspaceHome: () => <div>WORKSPACE-STUB</div> }))
     ```
   - Add two tests inside `describe('MainPanel', ...)`:
     ```tsx
     test('shows the 전체 (workspace) tab', () => {
       render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} />)
       expect(screen.getByRole('button', { name: /전체/ })).toBeDefined()
     })

     test('workspace tab renders WorkspaceHome', () => {
       render(<MainPanel tab="workspace" onTab={vi.fn()} dashboard={dashboard} />)
       expect(screen.getByText('WORKSPACE-STUB')).toBeDefined()
     })
     ```
   Run: `npx vitest run apps/desktop/src/renderer/components/MainPanel.test.tsx` → **fails** (no `전체` tab; `tab="workspace"` not assignable to `MainTab`).

2. **Implement** — edit `apps/desktop/src/renderer/components/MainPanel.tsx`:
   - Add the import:
     ```ts
     import { WorkspaceHome } from './WorkspaceHome.js'
     import type { WorkspaceOverview } from '@apc/dashboard-api'
     ```
   - Extend the union:
     ```ts
     export type MainTab = 'home' | 'knowledge' | 'wikigen' | 'workspace'
     ```
   - Extend `Props` (append, all optional so existing callers/tests are unaffected):
     ```ts
     type Props = {
       tab: MainTab
       onTab: (tab: MainTab) => void
       dashboard: ProjectDashboardRes
       actions?: ReactNode
       wikiGenRunning?: boolean
       overview?: WorkspaceOverview | null
       onRefreshWorkspace?: () => void
       onOpenProject?: (projectId: string) => void
     }
     ```
   - Add the tab to `TABS` (after `wikigen`):
     ```ts
     const TABS: { id: MainTab; label: string }[] = [
       { id: 'home', label: '🏠 Home' },
       { id: 'knowledge', label: '📖 Knowledge' },
       { id: 'wikigen', label: '⚙ Wiki Gen' },
       { id: 'workspace', label: '🌐 전체' },
     ]
     ```
   - Update the destructure and the content region:
     ```tsx
     export function MainPanel({ tab, onTab, dashboard, actions, wikiGenRunning, overview, onRefreshWorkspace, onOpenProject }: Props) {
     ```
     ```tsx
     <div className="main-panel__content">
       {tab === 'home' && <HomeView dashboard={dashboard} />}
       {tab === 'knowledge' && <KnowledgeView />}
       {tab === 'wikigen' && <WikiGenDashboard />}
       {tab === 'workspace' && (
         <WorkspaceHome
           overview={overview ?? null}
           onRefresh={onRefreshWorkspace ?? (() => {})}
           onOpenProject={onOpenProject ?? (() => {})}
         />
       )}
     </div>
     ```
   Run: `npx vitest run apps/desktop/src/renderer/components/MainPanel.test.tsx` → **passes** (new tests + the 6 pre-existing ones; the "three tabs" test asserts presence, not exclusivity, so a 4th tab is fine).

3. **Typecheck**: `pnpm typecheck` → clean.

4. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): 전체 workspace tab in MainPanel

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 7 — Running/review badges on `ProjectSidebar` buttons

**Why:** at-a-glance per-project status without opening the 전체 tab. Fed by the same overview data (Task 8 derives it). Added as an **optional** `badges` prop so all existing `ProjectSidebar` tests keep passing untouched. Badges render on the **expanded** project buttons (the collapsed rail is left unchanged for this MVP — its dots already convey selection; add rail badges as a follow-up if wanted).

### Files
- EDIT `apps/desktop/src/renderer/components/ProjectSidebar.tsx`
- NEW `apps/desktop/src/renderer/components/ProjectSidebar.badges.test.tsx`
- EDIT `apps/desktop/src/renderer/app.css`

### Steps

1. **Failing test** — create `apps/desktop/src/renderer/components/ProjectSidebar.badges.test.tsx`:
   ```tsx
   import { describe, expect, test } from 'vitest'
   import { render, screen, within } from '@testing-library/react'
   import type { Project } from '@apc/shared'
   import { ProjectSidebar } from './ProjectSidebar.js'

   const projects: Project[] = [
     { id: 'p1', name: 'Alpha', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: [], vaultPaths: [], sourcePaths: [] },
   ]

   describe('ProjectSidebar badges', () => {
     test('renders running/review counts from the badges prop', () => {
       render(
         <ProjectSidebar
           projects={projects} selectedProjectId={null} collapsed={false}
           onToggleCollapse={() => {}} onSelect={() => {}} onAdd={() => {}} onUpdate={() => {}} onDelete={() => {}}
           badges={{ p1: { running: 2, review: 1 } }}
         />,
       )
       const btn = screen.getByRole('button', { name: /Alpha/ })
       expect(within(btn).getByText('2')).toBeDefined()
       expect(within(btn).getByText('1')).toBeDefined()
     })

     test('renders no badge when counts are zero or missing', () => {
       render(
         <ProjectSidebar
           projects={projects} selectedProjectId={null} collapsed={false}
           onToggleCollapse={() => {}} onSelect={() => {}} onAdd={() => {}} onUpdate={() => {}} onDelete={() => {}}
         />,
       )
       const btn = screen.getByRole('button', { name: /Alpha/ })
       expect(within(btn).queryByText('2')).toBeNull()
     })
   })
   ```
   Run: `npx vitest run apps/desktop/src/renderer/components/ProjectSidebar.badges.test.tsx` → **fails** (`badges` prop not accepted / no badge rendered).

2. **Implement** — edit `apps/desktop/src/renderer/components/ProjectSidebar.tsx`:
   - Add `badges` to `Props` (append):
     ```ts
     type Props = {
       projects: Project[]
       selectedProjectId: string | null
       collapsed: boolean
       onToggleCollapse: () => void
       onSelect: (projectId: string) => void
       onAdd: (name: string, projectType: string, repoPath: string, domain: string) => void
       onUpdate: (id: string, name: string, projectType: string, repoPath: string, domain: string) => void
       onDelete: (id: string) => void
       badges?: Record<string, { running: number; review: number }>
     }
     ```
   - Add `badges = {}` to the destructure:
     ```ts
     export function ProjectSidebar({ projects, selectedProjectId, collapsed, onToggleCollapse, onSelect, onAdd, onUpdate, onDelete, badges = {} }: Props) {
     ```
   - In the **expanded** list, put the badges inside each project `<button>` (after `{p.name}`):
     ```tsx
     <button
       type="button"
       className={`project-sidebar__item${p.id === selectedProjectId ? ' project-sidebar__item--selected' : ''}`}
       onClick={() => onSelect(p.id)}
       onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }) }}
       title="우클릭: 편집 / 삭제"
     >
       {p.name}
       {(badges[p.id]?.running ?? 0) > 0 && (
         <span className="project-sidebar__badge project-sidebar__badge--running" title="실행중">{badges[p.id].running}</span>
       )}
       {(badges[p.id]?.review ?? 0) > 0 && (
         <span className="project-sidebar__badge project-sidebar__badge--review" title="리뷰 대기">{badges[p.id].review}</span>
       )}
     </button>
     ```
   Run: `npx vitest run apps/desktop/src/renderer/components/ProjectSidebar.badges.test.tsx` → **passes**.

3. **CSS** — append to `apps/desktop/src/renderer/app.css`:
   ```css
   .project-sidebar__badge { display: inline-block; margin-left: 6px; font-size: 0.68rem; line-height: 1; padding: 2px 6px; border-radius: 9px; vertical-align: middle; }
   .project-sidebar__badge--running { background: #1f3a24; color: #8fe0a2; }
   .project-sidebar__badge--review { background: #3a331f; color: #e6d17a; }
   ```

4. **Regression** — the pre-existing sidebar tests must stay green (optional prop, so unaffected):
   ```
   npx vitest run apps/desktop/src/renderer/components/ProjectSidebar
   ```
   Expected: `ProjectSidebar.domain.test.tsx` + `ProjectSidebar.badges.test.tsx` all pass.

5. **Typecheck**: `pnpm typecheck` → clean.

6. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): running/review badges on project sidebar buttons

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 8 — Wire the overview into `App` + store, then full suite

**Why:** connect everything — a store slice that fetches the overview, a fetch-on-tab-open effect + refresh button, sidebar badges derived from the overview, and `onOpenProject` = select the project and jump to Home. This is the last task, so it also runs the full `pnpm test`.

**Note (known MVP scope):** `MainPanel` (and thus the 전체 tab) only renders when a project is selected (App gates on `dashboard`). In practice there is essentially always a selected project once the app has been used; rendering the 전체 tab with *no* selection is a documented follow-up, not part of this MVP.

### Files
- EDIT `apps/desktop/src/renderer/store.ts`
- EDIT `apps/desktop/src/renderer/App.tsx`

### Steps

1. **Store slice** — edit `apps/desktop/src/renderer/store.ts`:
   - Add the type import (alongside the other ipc-contract/shared imports at the top):
     ```ts
     import type { WorkspaceOverview } from '@apc/dashboard-api'
     ```
   - In the `type ApcStore = { ... }` block, add the state field (near `dashboard: ProjectDashboardRes | null`) and the action (near `selectProject`):
     ```ts
     workspaceOverview: WorkspaceOverview | null
     loadWorkspaceOverview(): Promise<void>
     ```
   - In the `create<ApcStore>((set, get) => ({ ... }))` initial state (near `dashboard: null,`):
     ```ts
     workspaceOverview: null,
     ```
   - Add the action implementation (place it right after the `selectProject` action):
     ```ts
     async loadWorkspaceOverview() {
       try {
         const workspaceOverview = await api.workspaceOverview()
         set({ workspaceOverview })
       } catch (e) {
         set({ error: `Failed to load workspace overview: ${e}` })
       }
     },
     ```

2. **App wiring** — edit `apps/desktop/src/renderer/App.tsx`:
   - Add `useMemo` to the React import:
     ```ts
     import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
     ```
   - Pull the new store members in the `useStore()` destructure (append to the existing list):
     ```ts
     const {
       projects, selectedProjectId, dashboard, error, agentStatus, openPanes,
       harnessLoading, workspaceOverview,
       loadProjects, addProject, updateProject, deleteProject, selectProject, clearError, setAgentStatus, loadWorkspaceOverview,
     } = useStore()
     ```
   - Extend the persisted-tab restore to accept `workspace`:
     ```ts
     const [mainTab, setMainTab] = useState<MainTab>(() => {
       try {
         const saved = localStorage.getItem('apc:mainTab')
         if (saved === 'home' || saved === 'knowledge' || saved === 'wikigen' || saved === 'workspace') return saved
       } catch { /* ignore */ }
       return 'home'
     })
     ```
   - Add a fetch-on-tab-open effect (place near the other `useEffect`s, e.g. after the `loadProjects` effect):
     ```ts
     // Cross-project overview: fetch when the 전체 tab is opened (MVP — no polling/websocket; manual refresh in WorkspaceHome).
     useEffect(() => {
       if (mainTab === 'workspace') void loadWorkspaceOverview()
     }, [mainTab, loadWorkspaceOverview])
     ```
   - Derive the sidebar badge map (place near the top of the component body, after the other `useState`/derived values):
     ```ts
     const projectBadges = useMemo(() => {
       const m: Record<string, { running: number; review: number }> = {}
       for (const p of workspaceOverview?.projects ?? []) {
         m[p.project.id] = { running: p.runningRuns.length, review: p.reviewQueueCount }
       }
       return m
     }, [workspaceOverview])
     ```
   - Pass `badges` to `ProjectSidebar` (add the one prop to the existing element):
     ```tsx
     <ProjectSidebar
       projects={projects}
       selectedProjectId={selectedProjectId}
       collapsed={sidebarCollapsed}
       onToggleCollapse={toggleSidebar}
       onSelect={selectProject}
       onAdd={addProject}
       onUpdate={updateProject}
       onDelete={deleteProject}
       badges={projectBadges}
     />
     ```
   - Pass the three workspace props to `MainPanel` (add to the existing `<MainPanel .../>`):
     ```tsx
     <MainPanel
       tab={mainTab}
       onTab={handleMainTab}
       dashboard={dashboard}
       actions={toolbarActions}
       wikiGenRunning={harnessLoading}
       overview={workspaceOverview}
       onRefreshWorkspace={() => void loadWorkspaceOverview()}
       onOpenProject={(pid) => { void selectProject(pid); handleMainTab('home') }}
     />
     ```

3. **Typecheck**: `pnpm typecheck` → clean.

4. **Full regression** — last task, run the whole workspace suite:
   ```
   pnpm test
   ```
   Expected: all suites pass (~2.5 min), including the new `task-deps` (in dashboard-api), `workspace-overview`, `agent-run-store` `listRunning`, `ipc` `workspaceOverview`, `WorkspaceHome`, `MainPanel`, and `ProjectSidebar.badges` tests, and the re-pointed `PmHome`/`TaskBoard`.

5. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): wire workspace overview into App (전체 tab + sidebar badges)

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Self-review

### Spec coverage (handoff §4 P3: 전 프로젝트의 {진행중 task, 실행중 run, 리뷰 대기} 한 화면 + 프로젝트 뱃지)
- **진행중 task** → `ProjectOverview.activeTaskCount` (todo|in_progress) — Task 3; shown as `진행중 N` on each card (Task 5).
- **실행중 run** → `ProjectOverview.runningRuns` via `AgentRunStore.listRunning()` (Task 2) attributed by task-id set (Task 3); shown as `실행중 N` + agent/time list (Task 5).
- **리뷰 대기** → `ProjectOverview.reviewQueueCount` (status review) — Task 3; shown as `리뷰 N` (Task 5).
- **한 화면 (one screen)** → `WorkspaceHome` grid of per-project cards under the `🌐 전체` MainTab — Tasks 5–6.
- **프로젝트 뱃지 (실행중/리뷰대기)** → `ProjectSidebar` running/review badges from the same overview — Task 7, fed in Task 8.
- **다음 작업(nextUp)** → seam `nextUp` top-3, clickable → open project — Tasks 3, 5, 8.
- **FIXED SEAM names** → `buildWorkspaceOverview` / `WorkspaceOverview` / `ProjectOverview` exported verbatim from `@apc/dashboard-api` (Task 3).

### Design decisions (called out per the brief)
- **Renderer surface = a new `🌐 전체` MainTab rendering a pure `WorkspaceHome`.** Rationale: minimally invasive (one union member + one `TABS` entry + one content branch), consistent with the existing 3-tab structure, and a pure prop-driven component tests like `PmHome` (fixture in, no store/api mocks). The store owns the fetch (fetch-on-tab-open + a refresh button); no websocket/polling per the MVP scope. Sidebar badges reuse the same store data via an App-derived `badges` map, so there is a single source of truth and one round-trip per open/refresh.
- **run→project join = `listRunning()` (global, single-table) + in-assembler grouping by each project's task-id set.** Rationale: `agent_runs` has no `project_id`; `run.repoPath` is unreliable for attribution (shared/ambiguous, esp. `ssh://`), whereas `run.taskId → task.projectId` is authoritative. Grouping reuses the per-project task list already fetched for the counts, so there are no extra DB round-trips and no JOIN SQL — and it keeps the store method signature exactly `listRunning(): AgentRun[]` as specified.
- **`ipc-contract` does not import `@apc/dashboard-api`.** Only the `CH.workspaceOverview` constant is added there; the `WorkspaceOverview` response type is imported from `@apc/dashboard-api` at the two consumption sites (`container.ts`, `api.ts`). This keeps `ipc-contract`'s imports limited to `@apc/shared` and avoids duplicating the seam type inline (the `ProjectDashboardRes` inline duplication is an existing pattern we deliberately don't extend, to prevent drift from the seam).

### Placeholder scan
No `TODO`/`TBD`/`FIXME`/`...` elisions or "same as task N" back-references inside code blocks. Every test, implementation snippet, run command, expected result, and commit command is literal and runnable.

### Type consistency
- `buildWorkspaceOverview(deps: DashboardDeps)` — `DashboardDeps` is structurally `{ registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }`, exactly the seam's deps shape; only the three exported *names* are fixed by the seam, so reusing `DashboardDeps` is compliant.
- `nextUp(tasks, 3)` returns `Task[]`; `Task['blockedBy']` is output-required (`string[]`) — every new `Task` fixture in this plan includes `blockedBy: []`, so `pnpm typecheck` (which includes test files) stays green.
- `Container` gains `workspaceOverview: () => WorkspaceOverview`; the handler returns it directly; `api.workspaceOverview()` is typed `Promise<WorkspaceOverview>` — one type threaded end-to-end from the seam.
- `MainPanel`'s three new props are optional (`overview?`, `onRefreshWorkspace?`, `onOpenProject?`) with in-component defaults, so the pre-existing `MainPanel` tests (which pass none of them) still typecheck and pass; `ProjectSidebar.badges?` is optional for the same reason.
- No changes to `AgentKind`/`RunAgent`. `AgentRun.status` union already includes `'running'` (Zod `z.enum(['running','completed','failed'])`), so `listRunning`'s SQL filter is consistent with the type.

### Merge-safety with the parallel P4
`ipc-contract.ts` (one appended `CH` line), `container.ts` (one appended import symbol + one type line + one return line), and `api.ts` (one appended import + one appended method) are all additive and localized — no reordering of existing blocks — so P4's later additions to the same files merge without conflict.
