# Implementation Plan — P1: Task 의존성(전후관계) 모델

## Goal

Give Tasks a first-class dependency edge (`blockedBy: string[]`) and surface it end-to-end:

1. **Schema + persistence**: `blockedBy` on `TaskSchema`, a `blocked_by` JSON column in the `tasks` table (idempotent migration), round-tripped by `TaskStore`.
2. **Write path**: a `taskSetBlockedBy` IPC command (contract → handler → container → renderer api) with a self-reference + direct-cycle guard.
3. **TaskBoard 차단 표시**: a `🚫 차단` badge on any card with unresolved blockers, plus a minimal `⛓` dependency editor.
4. **Work graph**: `task→task` edges (`kind: 'blocks'`) in `buildWorkGraphData`, wired through `KnowledgeView`.
5. **"다음 할 일" (Next Up) widget**: unblocked `todo`/`in_progress` tasks, sorted by priority then dueDate, top 5, in `PmHome`.

This is the root of the "전후 작업 파악" vision (handoff §4 P1).

## Architecture (data flow this plan touches)

```
packages/shared/src/schema.ts        TaskSchema.blockedBy: string[]  (Zod, output-required)
  └─ packages/pm/src/migrate.ts       tasks.blocked_by TEXT NOT NULL DEFAULT '[]'
  └─ packages/pm/src/task-store.ts    create/get/list serialize blocked_by (JSON); setBlockedBy(); validateBlockedBy()
  └─ packages/app-services/.../task-extractor.ts  (no code change — schema default covers; test only)

apps/desktop/src/shared/ipc-contract.ts   CH.taskSetBlockedBy + req/res types
  └─ apps/desktop/src/main/ipc.ts          handler: strict-parse → container.taskSetBlockedBy
  └─ apps/desktop/src/main/container.ts    taskSetBlockedBy: validateBlockedBy → tasks.setBlockedBy
  └─ apps/desktop/src/renderer/api.ts      api.taskSetBlockedBy(req)
  (preload NOT changed — generic window.apc.invoke bridge already carries all command channels)

packages/graph-view/src/build-graph.ts     WorkTaskInput.blockedBy → 'blocks' links
  └─ apps/desktop/src/renderer/components/KnowledgeView.tsx  pass blockedBy into buildWorkGraphData items

apps/desktop/src/renderer/task-deps.ts     isBlocked / unresolvedBlockers / nextUp  (new, pure)
  └─ TaskBoard.tsx   차단 badge + ⛓ editor (optional onSetBlockedBy prop)
  └─ PmHome.tsx      "다음 할 일" widget + wires onSetBlockedBy (optimistic overlay → api.taskSetBlockedBy)
```

## Tech stack

- TypeScript, Zod (`@apc/shared`), `node:sqlite` (`DatabaseSync`) via `@apc/core`.
- Tests: Vitest ^2 workspace (`vitest.workspace.ts` unifies `packages/*` + `apps/desktop`). Renderer component tests use `@testing-library/react` in jsdom (`.test.tsx` → jsdom via `environmentMatchGlobs`); pure `.ts` tests run in node.
- Electron IPC: single `CH` source in `apps/desktop/src/shared/ipc-contract.ts`.

## Global constraints (read before every task)

- **TDD, strict order per task**: write the failing test → run it → see it fail for the expected reason → write the minimal implementation → run it green → then the next test. Tests are colocated (`*.test.ts` / `*.test.tsx`).
- **Run a single test/file (from repo root)**: `npx vitest run <path-or-substring>`. Full suite: `pnpm test` (~2.5 min). **Typecheck authority**: `pnpm typecheck` (runs `tsc -p tsconfig.typecheck.json && tsc -p apps/desktop/tsconfig.json --noEmit`; IDE diagnostics are unreliable — ignore `@xterm/*`, `node:sqlite not found`, `node-pty-*` IDE-only noise).
- **`pnpm typecheck` includes test files.** `tsconfig.typecheck.json` includes `packages/*/src/**/*.{ts,tsx}` and `apps/desktop/tsconfig.json` includes `src` (both test suites). This matters in **Task 1**: making `blockedBy` an output-required field breaks every `Task` object literal that omits it. Task 1 fixes them all and is not "done" until `pnpm typecheck` is green.
- **Commit after each task** (conventional commits + trailer). Template:
  ```
  git add -A && git commit -m "<type>(<scope>): <summary>

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```
  scopes in use: `shared`, `pm`, `desktop`, `knowledge`, `graph-view`, `app-services`.
- **Do NOT** add values to `AgentKind` / `RunAgent`. **Do NOT** touch anything outside this repo (no coin/calc/blog). **Do NOT** switch git branches (stay on the checked-out branch).
- **Cycle guard scope**: `taskSetBlockedBy` rejects self-reference (`taskId ∈ blockedBy`) and **direct** 2-cycles (A blocks B while B already blocks A). Deep/transitive cycle detection (A→B→C→A) is explicitly **out of scope** for this MVP — document it in the code comment, do not implement it.
- Column naming: DB columns are `snake_case`, TS fields `camelCase`. Migrations are idempotent (`CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing`).

---

## Task 1 — `blockedBy` on the schema + green the whole tree

**Why first:** `Task` is a shared type; every later task builds on it. Because `.default([])` makes the *inferred* (`z.infer`) type require the field, all existing `Task` literals must gain `blockedBy` before `pnpm typecheck` passes.

### Files
- `packages/shared/src/schema.ts` (impl)
- `packages/shared/src/schema.test.ts` (test)
- Fixture sweep (add `blockedBy: []`): `packages/pm/src/task-store.test.ts`, `packages/pm/src/review-service.test.ts`, `packages/app-services/src/task-extractor.test.ts`, `packages/app-services/src/run-service.test.ts`, `packages/dashboard-api/src/project-dashboard.test.ts`, `apps/desktop/src/main/ipc.test.ts`, `apps/desktop/src/renderer/components/PmHome.test.tsx`, `apps/desktop/src/renderer/components/TaskBoard.test.tsx`, `apps/desktop/src/renderer/components/TimelineStrip.test.tsx`, `apps/desktop/src/renderer/components/HomeView.test.tsx`, `apps/desktop/src/renderer/components/DevHarnessPanel.test.tsx`. Plus any source `Task` literal (`packages/pm/src/review-service.ts` builds a task via `TaskSchema.parse` — that's a `.parse()` **input**, so it is *not* required, but adding `blockedBy: []` there is harmless and explicit).

### Interface
```ts
// added to TaskSchema
blockedBy: z.array(z.string()).default([])
// => Task['blockedBy'] is `string[]` (output-required, same shape as acceptanceCriteria/linkedWikiPages)
```

### Steps

1. **Failing test** — add to the `describe('TaskSchema', ...)` block in `packages/shared/src/schema.test.ts`:
   ```ts
   test('defaults blockedBy to [] and preserves given ids', () => {
     const d = TaskSchema.parse({
       id: 'T1', projectId: 'p1', title: 'x', status: 'todo',
     })
     expect(d.blockedBy).toEqual([])
     const b = TaskSchema.parse({
       id: 'T2', projectId: 'p1', title: 'y', status: 'todo', blockedBy: ['T1'],
     })
     expect(b.blockedBy).toEqual(['T1'])
   })
   ```
   Run: `npx vitest run packages/shared/src/schema.test.ts` → **fails** (`blockedBy` is `undefined` — property does not exist yet).

2. **Implement** — in `packages/shared/src/schema.ts`, add the field to `TaskSchema` immediately after `linkedWikiPages`:
   ```ts
   linkedWikiPages: z.array(z.string()).default([]),
   blockedBy: z.array(z.string()).default([]),
   contextPackage: z.string().optional(),
   ```
   Run: `npx vitest run packages/shared/src/schema.test.ts` → **passes**.

3. **Sweep every `Task` literal green.** For each fixture object that represents a Task (it has `status` + `acceptanceCriteria` + `linkedWikiPages`), add `blockedBy: []`. Prefer editing shared **factory helpers** once rather than every call site:
   - `packages/pm/src/task-store.test.ts`: add `blockedBy: [],` to the `const base: Task = {...}` literal **and** to the inline literal in the `delete` test (`t('T-del' … create({ … }))`). Spreads of `base` inherit it.
   - `packages/app-services/src/task-extractor.test.ts`: add `blockedBy: [],` to the `mk()` helper's returned object (before `...extra`).
   - `apps/desktop/src/renderer/components/TaskBoard.test.tsx`: add `blockedBy: [],` to the `t()` helper (before `...extra`).
   - All other listed files: add `blockedBy: []` to each Task literal alongside its `acceptanceCriteria: []` / `linkedWikiPages: []`.
   - `packages/pm/src/review-service.ts` (source, `TaskSchema.parse({...})` input): add `blockedBy: [],` for explicitness (optional but keep it consistent).

4. **Authoritative gate** — this enumerates any literal you missed by file:line:
   ```
   pnpm typecheck
   ```
   Expected: no errors. If it reports `Property 'blockedBy' is missing in type '{...}' but required in type 'Task'`, add `blockedBy: []` to that exact literal and re-run until clean.

5. **Regression guard** — the touched suites must still pass:
   ```
   npx vitest run task-store task-extractor project-dashboard run-service review-service
   ```
   Expected: all passing.

6. **Commit**:
   ```
   git add -A && git commit -m "feat(shared): add blockedBy dependency field to TaskSchema

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 2 — Persist `blocked_by` + cycle validator in the PM package

### Files
- `packages/pm/src/migrate.ts` (impl)
- `packages/pm/src/migrate.test.ts` (test)
- `packages/pm/src/task-store.ts` (impl)
- `packages/pm/src/task-store.test.ts` (test)

### Interfaces
```ts
// task-store.ts
class TaskStore {
  setBlockedBy(id: string, blockedBy: string[]): void
}
/** Guard for a proposed blockedBy edit. Rejects self-reference and DIRECT 2-cycles only. */
export function validateBlockedBy(
  getTask: (id: string) => Task | undefined,
  taskId: string,
  blockedBy: string[],
): { ok: true } | { ok: false; reason: 'self-reference' | 'cycle' }
```

### Steps

1. **Failing migration test** — add to `packages/pm/src/migrate.test.ts`:
   ```ts
   test('tasks table has a blocked_by column (fresh + legacy upgrade)', () => {
     const fresh = openDb(':memory:'); migrate(fresh); migratePm(fresh)
     const freshCols = fresh.prepare('PRAGMA table_info(tasks)').all().map((c) => (c as { name: string }).name)
     expect(freshCols).toContain('blocked_by')

     const legacy = openDb(':memory:'); migrate(legacy)
     legacy.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL)')
     migratePm(legacy)
     const legacyCols = legacy.prepare('PRAGMA table_info(tasks)').all().map((c) => (c as { name: string }).name)
     expect(legacyCols).toContain('blocked_by')
   })
   ```
   Run: `npx vitest run packages/pm/src/migrate.test.ts` → **fails** (no `blocked_by`).

2. **Implement migration** — in `packages/pm/src/migrate.ts`:
   - In the `CREATE TABLE IF NOT EXISTS tasks (...)` block, change the last column line and add `blocked_by`:
     ```sql
           context_package TEXT,
           review_status TEXT NOT NULL DEFAULT 'none',
           blocked_by    TEXT NOT NULL DEFAULT '[]'
         );
     ```
   - Add the idempotent upgrade after the `linked_wiki_pages` line:
     ```ts
     addColumnIfMissing(db, 'tasks', 'linked_wiki_pages', "linked_wiki_pages TEXT NOT NULL DEFAULT '[]'")
     addColumnIfMissing(db, 'tasks', 'blocked_by', "blocked_by TEXT NOT NULL DEFAULT '[]'")
     ```
   Run: `npx vitest run packages/pm/src/migrate.test.ts` → **passes**.

3. **Failing store tests** — add to `packages/pm/src/task-store.test.ts`:
   ```ts
   test('round-trips blockedBy and defaults to []', () => {
     store.create(base)
     expect(store.get('TASK-001')?.blockedBy).toEqual([])
     store.create({ ...base, id: 'TASK-020', blockedBy: ['TASK-001', 'TASK-002'] })
     expect(store.get('TASK-020')?.blockedBy).toEqual(['TASK-001', 'TASK-002'])
   })
   test('setBlockedBy updates only the blocked_by column', () => {
     store.create({ ...base, id: 'TASK-021', priority: 'low' })
     store.setBlockedBy('TASK-021', ['TASK-009'])
     const t = store.get('TASK-021')!
     expect(t.blockedBy).toEqual(['TASK-009'])
     expect(t.priority).toBe('low') // other columns untouched
   })
   ```
   And add a `validateBlockedBy` unit block (import it: `import { TaskStore, validateBlockedBy } from './task-store.js'`):
   ```ts
   describe('validateBlockedBy', () => {
     const get = (map: Record<string, Task>) => (id: string) => map[id]
     test('rejects self-reference', () => {
       expect(validateBlockedBy(get({}), 'A', ['A'])).toEqual({ ok: false, reason: 'self-reference' })
     })
     test('rejects a direct 2-cycle (B already blocks A)', () => {
       const B: Task = { ...base, id: 'B', blockedBy: ['A'] }
       expect(validateBlockedBy(get({ B }), 'A', ['B'])).toEqual({ ok: false, reason: 'cycle' })
     })
     test('accepts a fresh edge and ignores unknown blockers', () => {
       expect(validateBlockedBy(get({}), 'A', ['B', 'ghost'])).toEqual({ ok: true })
     })
   })
   ```
   Run: `npx vitest run packages/pm/src/task-store.test.ts` → **fails** (`setBlockedBy`/`validateBlockedBy` do not exist; `blockedBy` undefined on read).

4. **Implement store** — in `packages/pm/src/task-store.ts`:
   - `Row` type: add `blocked_by: string` (put it next to `acceptance_criteria`/`linked_wiki_pages`).
   - `toTask`: add `blockedBy: JSON.parse(r.blocked_by),` after `linkedWikiPages`.
   - `create`: extend the INSERT column list, the VALUES list, and the params object:
     ```ts
     this.db.prepare(
       `INSERT OR REPLACE INTO tasks
        (id, project_id, title, status, assignee_type, assignee, priority, due_date,
         estimate, parent_task_id, acceptance_criteria, linked_wiki_pages, context_package, review_status, blocked_by)
        VALUES (:id, :projectId, :title, :status, :assigneeType, :assignee, :priority, :dueDate,
         :estimate, :parentTaskId, :acceptanceCriteria, :linkedWikiPages, :contextPackage, :reviewStatus, :blockedBy)`,
     ).run({
       id: t.id, projectId: t.projectId, title: t.title, status: t.status,
       assigneeType: t.assigneeType, assignee: t.assignee ?? null, priority: t.priority,
       dueDate: t.dueDate ?? null, estimate: t.estimate ?? null, parentTaskId: t.parentTaskId ?? null,
       acceptanceCriteria: JSON.stringify(t.acceptanceCriteria), linkedWikiPages: JSON.stringify(t.linkedWikiPages),
       contextPackage: t.contextPackage ?? null, reviewStatus: t.reviewStatus, blockedBy: JSON.stringify(t.blockedBy),
     })
     ```
   - Add the method (after `updateStatus`):
     ```ts
     setBlockedBy(id: string, blockedBy: string[]): void {
       this.db.prepare('UPDATE tasks SET blocked_by = ? WHERE id = ?').run(JSON.stringify(blockedBy), id)
     }
     ```
   - Add the exported validator at module scope (below the class):
     ```ts
     /**
      * Guard for a proposed blockedBy edit. Rejects a self-reference and a DIRECT 2-cycle
      * (the proposed blocker already lists `taskId` among its own blockers). Deep/transitive
      * cycle detection (A→B→C→A) is intentionally out of scope for this MVP.
      */
     export function validateBlockedBy(
       getTask: (id: string) => Task | undefined,
       taskId: string,
       blockedBy: string[],
     ): { ok: true } | { ok: false; reason: 'self-reference' | 'cycle' } {
       if (blockedBy.includes(taskId)) return { ok: false, reason: 'self-reference' }
       for (const blockerId of blockedBy) {
         const blocker = getTask(blockerId)
         if (blocker?.blockedBy.includes(taskId)) return { ok: false, reason: 'cycle' }
       }
       return { ok: true }
     }
     ```
   Run: `npx vitest run packages/pm/src/task-store.test.ts` → **passes**.

5. **Typecheck**: `pnpm typecheck` → clean (`validateBlockedBy` is re-exported automatically via `export * from './task-store.js'` in `packages/pm/src/index.ts`).

6. **Commit**:
   ```
   git add -A && git commit -m "feat(pm): persist blocked_by + add validateBlockedBy cycle guard

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 3 — Verify SP1 capture defaults `blockedBy` to `[]` (test only)

**Why:** `task-extractor.ts` builds tasks via `TaskSchema.parse(...)` without a `blockedBy` key; the schema default supplies `[]`. No code change — lock it with a test so a future refactor can't drop it.

### Files
- `packages/app-services/src/task-extractor.test.ts` (test only)

### Steps

1. **Add the test** inside `describe('extractTasks', ...)`:
   ```ts
   it('defaults blockedBy to [] on the request and every todo', async () => {
     const s = session({ turns: [
       { role: 'user', text: 'do the thing', toolCalls: [] },
       { role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'A', status: 'pending' }])] },
     ] as NormalizedSession['turns'] })
     const { request, todos } = await extractTasks(s, 'p1', { summarize })
     expect(request.blockedBy).toEqual([])
     expect(todos.every((t) => Array.isArray(t.blockedBy) && t.blockedBy.length === 0)).toBe(true)
   })
   ```
   (`summarize` is the `vi.fn` already defined in that describe block.)

2. **Run** — it should pass immediately (schema default already applies):
   ```
   npx vitest run packages/app-services/src/task-extractor.test.ts
   ```
   Expected: all passing. (If it fails, the schema default from Task 1 is missing — go back and fix Task 1, do not add code here.)

3. **Commit**:
   ```
   git add -A && git commit -m "test(app-services): assert extracted tasks default blockedBy to []

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 4 — `taskSetBlockedBy` IPC command (contract → handler → container → api)

**Preload note:** no preload edit. `contextBridge.exposeInMainWorld('apc', { invoke, ... })` already exposes a generic `invoke(channel, payload)`; every query/command channel rides it (only PTY/stream/event channels need explicit preload methods). Verified in `apps/desktop/src/preload/index.ts`.

### Files
- `apps/desktop/src/shared/ipc-contract.ts` (impl)
- `apps/desktop/src/main/ipc.ts` (impl)
- `apps/desktop/src/main/container.ts` (impl)
- `apps/desktop/src/renderer/api.ts` (impl)
- `apps/desktop/src/main/ipc.test.ts` (test)

### Interfaces
```ts
// ipc-contract.ts
taskSetBlockedBy: 'c:taskSetBlockedBy'                       // in CH
export type TaskSetBlockedByReq = { taskId: string; blockedBy: string[] }
export type TaskSetBlockedByRes = { ok: boolean; reason?: string }

// container.ts (Container type + impl)
taskSetBlockedBy: (req: TaskSetBlockedByReq) => TaskSetBlockedByRes

// api.ts
taskSetBlockedBy(req: TaskSetBlockedByReq): Promise<TaskSetBlockedByRes>
```

### Steps

1. **Failing handler tests** — add to `apps/desktop/src/main/ipc.test.ts` (inside the existing `describe`). The `beforeEach` already seeds project `p1` + task `T1`:
   ```ts
   test('c:taskSetBlockedBy persists deps, and rejects self-reference + direct cycle', async () => {
     const h = handlers(container)
     container.tasks.create({
       id: 'T2', projectId: 'p1', title: 'dep', status: 'todo',
       assigneeType: 'agent', priority: 'medium', reviewStatus: 'none',
       acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [],
     })
     expect(await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: ['T2'] })).toEqual({ ok: true })
     expect(container.tasks.get('T1')?.blockedBy).toEqual(['T2'])

     expect(await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: ['T1'] }))
       .toMatchObject({ ok: false, reason: 'self-reference' })

     await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: [] })      // clear
     await h[CH.taskSetBlockedBy]({ taskId: 'T2', blockedBy: ['T1'] })  // T2 now blocked by T1
     expect(await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: ['T2'] }))
       .toMatchObject({ ok: false, reason: 'cycle' })
   })
   test('c:taskSetBlockedBy strict-parses its payload', async () => {
     const h = handlers(container)
     await expect(h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: 'nope' })).rejects.toThrow()   // non-array
     await expect(h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: [], extra: 1 })).rejects.toThrow() // unknown key
     await expect(h[CH.taskSetBlockedBy]({ blockedBy: [] })).rejects.toThrow()                     // missing taskId
   })
   ```
   Run: `npx vitest run apps/desktop/src/main/ipc.test.ts` → **fails** (`CH.taskSetBlockedBy` undefined; no handler).

2. **Contract** — in `apps/desktop/src/shared/ipc-contract.ts`:
   - Add to the `CH` object under the `// commands` group (near `selectProfile`):
     ```ts
     taskSetBlockedBy: 'c:taskSetBlockedBy',
     ```
   - Add the types near the other `*Req`/`*Res` declarations (e.g. after `SelectProfileReq`):
     ```ts
     export type TaskSetBlockedByReq = { taskId: string; blockedBy: string[] }
     export type TaskSetBlockedByRes = { ok: boolean; reason?: string }
     ```

3. **Container** — in `apps/desktop/src/main/container.ts`:
   - Import the validator (extend the existing `@apc/pm` import):
     ```ts
     import { migratePm, TaskStore, AgentRunStore, ReviewService, VaultWriter, validateBlockedBy } from '@apc/pm'
     ```
   - Import the request/response types (add to the big `import type { ... } from '../shared/ipc-contract.js'` block):
     ```ts
     TaskSetBlockedByReq, TaskSetBlockedByRes,
     ```
   - Add to the `Container` type (near `dashboard`):
     ```ts
     taskSetBlockedBy: (req: TaskSetBlockedByReq) => TaskSetBlockedByRes
     ```
   - Implement it in `buildContainer` (place near `readProjectWikiQuery`, using the already-constructed `tasks` store):
     ```ts
     const taskSetBlockedBy = (req: TaskSetBlockedByReq): TaskSetBlockedByRes => {
       const check = validateBlockedBy((id) => tasks.get(id), req.taskId, req.blockedBy)
       if (!check.ok) return { ok: false, reason: check.reason }
       tasks.setBlockedBy(req.taskId, req.blockedBy)
       return { ok: true }
     }
     ```
   - Add `taskSetBlockedBy` to the returned object (alongside `readProjectWiki: readProjectWikiQuery`):
     ```ts
     taskSetBlockedBy,
     ```

4. **Handler** — in `apps/desktop/src/main/ipc.ts`, add inside `handlers()` (near `[CH.selectProfile]`):
   ```ts
   [CH.taskSetBlockedBy]: async (payload: unknown) => {
     const req = z.object({ taskId: z.string(), blockedBy: z.array(z.string()) }).strict().parse(payload)
     return container.taskSetBlockedBy(req)
   },
   ```
   (`z` is already imported at the top of the file.)

5. **Renderer api** — in `apps/desktop/src/renderer/api.ts`:
   - Add the two types to the `import type { ... } from '../shared/ipc-contract.js'` block:
     ```ts
     TaskSetBlockedByReq, TaskSetBlockedByRes,
     ```
   - Add the method to the `api` object (near `tasksList`):
     ```ts
     taskSetBlockedBy(req: TaskSetBlockedByReq): Promise<TaskSetBlockedByRes> {
       return window.apc.invoke(CH.taskSetBlockedBy, req) as Promise<TaskSetBlockedByRes>
     },
     ```

6. **Run** the handler tests green + typecheck:
   ```
   npx vitest run apps/desktop/src/main/ipc.test.ts
   pnpm typecheck
   ```
   Expected: tests pass; typecheck clean.

7. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): add taskSetBlockedBy IPC command end-to-end

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 5 — Work-graph `task→task` "blocks" edges

### Files
- `packages/graph-view/src/build-graph.ts` (impl)
- `packages/graph-view/src/build-graph.test.ts` (test)
- `apps/desktop/src/renderer/components/KnowledgeView.tsx` (wiring, no unit test — verified by typecheck)

### Interface
```ts
// build-graph.ts — extend the existing input type
export type WorkTaskInput = { id: string; title: string; status: string; linkedWikiPages: string[]; blockedBy?: string[]; data?: unknown }
// New links: { id: `blocks:${blockerId}->${taskId}`, source: blockerId, target: taskId, kind: 'blocks', label: 'blocks', direction: 'directed' }
// Only emitted when BOTH endpoints are already task nodes in the graph.
```

### Steps

1. **Failing tests** — add to `describe('buildWorkGraphData', ...)` in `packages/graph-view/src/build-graph.test.ts`:
   ```ts
   it('adds a blocks edge (blocker -> blocked) between two task nodes from blockedBy', () => {
     const tasks = [
       { id: 'req:p1:a', title: 'A', status: 'done', linkedWikiPages: [] },
       { id: 'req:p1:b', title: 'B', status: 'todo', linkedWikiPages: [], blockedBy: ['req:p1:a'] },
     ]
     const g = buildWorkGraphData(tasks, [])
     const link = g.links.find((l) => l.kind === 'blocks')
     expect(link).toMatchObject({ source: 'req:p1:a', target: 'req:p1:b', kind: 'blocks', label: 'blocks', direction: 'directed' })
   })
   it('does not add a blocks edge when the blocker is not a node in the graph', () => {
     const tasks = [{ id: 'req:p1:b', title: 'B', status: 'todo', linkedWikiPages: [], blockedBy: ['ghost'] }]
     const g = buildWorkGraphData(tasks, [])
     expect(g.links.some((l) => l.kind === 'blocks')).toBe(false)
   })
   ```
   Run: `npx vitest run packages/graph-view/src/build-graph.test.ts` → **fails** (no `blocks` links; `blockedBy` not on the input type).

2. **Implement** — in `packages/graph-view/src/build-graph.ts`:
   - Add `blockedBy?: string[]` to `WorkTaskInput`:
     ```ts
     export type WorkTaskInput = { id: string; title: string; status: string; linkedWikiPages: string[]; blockedBy?: string[]; data?: unknown }
     ```
   - In `buildWorkGraphData`, after the existing `for (const task of tasks) { ... }` loop (all task nodes exist by now) and before `return`, add:
     ```ts
     // task→task dependency edges: X blocks T when T.blockedBy contains X. Only draw when both
     // endpoints are task nodes already in this graph (avoid ghost dependency nodes).
     for (const task of tasks) {
       for (const blockerId of task.blockedBy ?? []) {
         if (!nodeMap.has(blockerId) || !nodeMap.has(task.id)) continue
         addLink(links, {
           id: `blocks:${blockerId}->${task.id}`, source: blockerId, target: task.id,
           kind: 'blocks', label: 'blocks', direction: 'directed',
         })
       }
     }
     ```
   Run: `npx vitest run packages/graph-view/src/build-graph.test.ts` → **passes** (existing `buildWorkGraphData` assertions still hold: no `blockedBy` in those fixtures → no `blocks` links).

3. **Wire the caller** — in `apps/desktop/src/renderer/components/KnowledgeView.tsx`, in the `workGraph` `useMemo`, add `blockedBy` to each mapped item:
   ```ts
   const items = reqs.map((t) => ({
     id: t.id, title: t.title, status: t.status, linkedWikiPages: t.linkedWikiPages, blockedBy: t.blockedBy,
     data: { sessionId: t.contextPackage, todos: tasks.filter((c) => c.parentTaskId === t.id).map((c) => ({ title: c.title, status: c.status })) },
   }))
   ```
   (Limitation to accept for MVP: `KnowledgeView` only feeds `req:`-prefixed tasks into the work graph, so a `blocks` edge renders only between two request-tasks that block each other. Dependencies set on `todo:` tasks persist and drive the TaskBoard badge / Next Up widget but are not drawn in this graph. Deep work-graph integration is a follow-up.)

4. **Typecheck** (the KnowledgeView change has no unit test):
   ```
   pnpm typecheck
   ```
   Expected: clean. (`t` in the map is a `Task`, so `t.blockedBy` is `string[]`, assignable to `blockedBy?: string[]`.)

5. **Commit**:
   ```
   git add -A && git commit -m "feat(graph-view): render task->task blocks edges in the work graph

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 6 — Renderer dependency helpers (`task-deps.ts`)

**Why a shared module:** TaskBoard (badge) and PmHome (Next Up) both need "is this task blocked?" — keep the logic in one pure, node-testable place.

### Files
- `apps/desktop/src/renderer/task-deps.ts` (impl, new)
- `apps/desktop/src/renderer/task-deps.test.ts` (test, new — runs in node)

### Interface
```ts
export const PRIORITY_ORDER: Record<Task['priority'], number>
export function unresolvedBlockers(task: Task, byId: Map<string, Task>): Task[]
export function isBlocked(task: Task, byId: Map<string, Task>): boolean
export function nextUp(tasks: Task[], limit?: number): Task[]  // default limit 5
```

### Steps

1. **Failing tests** — create `apps/desktop/src/renderer/task-deps.test.ts`:
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
   Run: `npx vitest run apps/desktop/src/renderer/task-deps.test.ts` → **fails** (module does not exist).

2. **Implement** — create `apps/desktop/src/renderer/task-deps.ts`:
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
   Run: `npx vitest run apps/desktop/src/renderer/task-deps.test.ts` → **passes**.

3. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): add task-deps helpers (isBlocked, nextUp)

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 7 — TaskBoard: 차단 badge + `⛓` dependency editor

### Files
- `apps/desktop/src/renderer/components/TaskBoard.tsx` (impl)
- `apps/desktop/src/renderer/components/TaskBoard.test.tsx` (test)

### Interface
```ts
type Props = { tasks: Task[]; onSetBlockedBy?: (taskId: string, blockedBy: string[]) => void }
```
- Badge renders whenever `unresolvedBlockers(task, byId).length > 0` (no prop required).
- Editor (`⛓` button + `<select multiple>`) renders **only** when `onSetBlockedBy` is provided (keeps existing pure-render tests unchanged and window.apc-free).

### Steps

1. **Failing tests** — add to `apps/desktop/src/renderer/components/TaskBoard.test.tsx`:
   - Update the imports line to include `fireEvent`:
     ```ts
     import { render, screen, within, fireEvent } from '@testing-library/react'
     ```
   - Add tests:
     ```ts
     test('shows a 차단 badge whose tooltip lists unresolved blocker titles', () => {
       const list: Task[] = [
         t('B1', 'todo', 'blocked one', { blockedBy: ['B2'] }),
         t('B2', 'in_progress', 'blocker task'),
       ]
       render(<TaskBoard tasks={list} />)
       const card = within(screen.getByTestId('col-todo')).getByText('blocked one').closest('.pm-board__card')!
       const badge = within(card as HTMLElement).getByText('🚫 차단')
       expect(badge.getAttribute('title')).toContain('blocker task')
     })
     test('no 차단 badge once the blocker is done', () => {
       const list: Task[] = [
         t('B1', 'todo', 'now free', { blockedBy: ['B2'] }),
         t('B2', 'done', 'finished'),
       ]
       render(<TaskBoard tasks={list} />)
       expect(screen.queryByText('🚫 차단')).toBeNull()
     })
     test('the ⛓ editor calls onSetBlockedBy with the selected ids', () => {
       const calls: Array<[string, string[]]> = []
       const list: Task[] = [t('E1', 'todo', 'pick deps'), t('E2', 'todo', 'other task')]
       render(<TaskBoard tasks={list} onSetBlockedBy={(id, deps) => calls.push([id, deps])} />)
       fireEvent.click(screen.getByLabelText('의존성 편집 pick deps'))
       const select = screen.getByLabelText('차단 작업 선택 pick deps') as HTMLSelectElement
       ;(within(select).getByText('other task') as HTMLOptionElement).selected = true
       fireEvent.change(select)
       expect(calls).toEqual([['E1', ['E2']]])
     })
     test('no ⛓ editor button when onSetBlockedBy is absent', () => {
       render(<TaskBoard tasks={[t('X', 'todo', 'solo')]} />)
       expect(screen.queryByLabelText('의존성 편집 solo')).toBeNull()
     })
     ```
   Run: `npx vitest run apps/desktop/src/renderer/components/TaskBoard.test.tsx` → **fails** (no badge, no editor).

2. **Implement** — replace the body of `apps/desktop/src/renderer/components/TaskBoard.tsx` with:
   ```tsx
   import { useState } from 'react'
   import type { Task, TaskStatus } from '@apc/shared'
   import { unresolvedBlockers } from '../task-deps.js'

   const COLUMNS: { status: TaskStatus; label: string }[] = [
     { status: 'todo', label: 'To Do' },
     { status: 'in_progress', label: 'In Progress' },
     { status: 'review', label: 'Review' },
     { status: 'done', label: 'Done' },
   ]

   type Props = { tasks: Task[]; onSetBlockedBy?: (taskId: string, blockedBy: string[]) => void }

   export function TaskBoard({ tasks, onSetBlockedBy }: Props) {
     const [editing, setEditing] = useState<string | null>(null)
     const byId = new Map(tasks.map((t) => [t.id, t]))
     return (
       <div className="pm-board">
         {COLUMNS.map(({ status, label }) => {
           const items = tasks.filter((t) => t.status === status)
           return (
             <div key={status} className="pm-board__col" data-testid={`col-${status}`}>
               <h3 className="pm-board__col-title">{label} <span className="pm-board__count">{items.length}</span></h3>
               {items.length === 0 ? (
                 <p className="pm-board__empty">—</p>
               ) : (
                 items.map((task) => {
                   const blockers = unresolvedBlockers(task, byId)
                   return (
                     <div key={task.id} className="pm-board__card">
                       <span className="pm-board__card-title">{task.title}</span>
                       <span className="pm-board__card-meta">
                         <span className={`pm-board__priority pm-board__priority--${task.priority}`}>{task.priority}</span>
                         {task.dueDate && <span className="pm-board__due">{task.dueDate}</span>}
                         {blockers.length > 0 && (
                           <span className="pm-board__blocked" title={`차단: ${blockers.map((b) => b.title).join(', ')}`}>🚫 차단</span>
                         )}
                         {onSetBlockedBy && (
                           <button
                             type="button" className="pm-board__dep-btn" aria-label={`의존성 편집 ${task.title}`}
                             onClick={() => setEditing((cur) => (cur === task.id ? null : task.id))}
                           >⛓</button>
                         )}
                       </span>
                       {onSetBlockedBy && editing === task.id && (
                         <select
                           multiple className="pm-board__dep-select" aria-label={`차단 작업 선택 ${task.title}`}
                           value={task.blockedBy}
                           onChange={(e) => onSetBlockedBy(task.id, Array.from(e.target.selectedOptions, (o) => o.value))}
                         >
                           {tasks.filter((o) => o.id !== task.id).map((o) => (
                             <option key={o.id} value={o.id}>{o.title}</option>
                           ))}
                         </select>
                       )}
                     </div>
                   )
                 })
               )}
             </div>
           )
         })}
       </div>
     )
   }
   ```
   Run: `npx vitest run apps/desktop/src/renderer/components/TaskBoard.test.tsx` → **passes** (existing "groups tasks", "renders priority/dueDate", "no rejected column" tests still hold — the card structure is unchanged for the no-prop case).

3. **Typecheck**: `pnpm typecheck` → clean.

4. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): TaskBoard 차단 badge + dependency editor

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Task 8 — PmHome: "다음 할 일" widget + wire the dependency editor

**Data-flow note:** `PmHome` receives a static `dashboard` prop (owner `HomeView` does not re-fetch on edit). To make edits feel live without touching the upstream reload chain, keep an **optimistic overlay** of edited `blockedBy` in local state, merge it into the tasks passed to TaskBoard + Next Up, and fire `api.taskSetBlockedBy` (persistence). Auto re-fetch after edit is out of MVP scope.

### Files
- `apps/desktop/src/renderer/components/PmHome.tsx` (impl)
- `apps/desktop/src/renderer/components/PmHome.test.tsx` (test)

### Steps

1. **Failing tests** — edit `apps/desktop/src/renderer/components/PmHome.test.tsx`:
   - Update imports:
     ```ts
     import { render, screen, within, fireEvent } from '@testing-library/react'
     import { describe, expect, test, vi } from 'vitest'
     import { CH } from '../../shared/ipc-contract.js'
     ```
   - Add tests inside `describe('PmHome', ...)`:
     ```ts
     test('renders the 다음 할 일 widget with unblocked actionable tasks', () => {
       render(<PmHome dashboard={dashboard} />)
       const nextUp = screen.getByTestId('next-up')
       // T1 (in_progress) is actionable; T2 (review) is not listed here
       expect(within(nextUp).getByText('do work')).toBeDefined()
       expect(within(nextUp).queryByText('needs review')).toBeNull()
     })
     test('editing a dependency persists via the bridge and marks the task blocked', () => {
       const invoke = vi.fn(() => Promise.resolve({ ok: true }))
       ;(window as unknown as { apc: unknown }).apc = { invoke, onDevHarnessLog: () => () => {} }
       try {
         render(<PmHome dashboard={dashboard} />)
         fireEvent.click(screen.getByLabelText('의존성 편집 do work'))
         const select = screen.getByLabelText('차단 작업 선택 do work') as HTMLSelectElement
         ;(within(select).getByText('needs review') as HTMLOptionElement).selected = true
         fireEvent.change(select)
         expect(invoke).toHaveBeenCalledWith(CH.taskSetBlockedBy, { taskId: 'T1', blockedBy: ['T2'] })
         expect(screen.getByText('🚫 차단')).toBeDefined() // optimistic overlay reflects blockage
       } finally {
         delete (window as unknown as { apc?: unknown }).apc
       }
     })
     ```
   Run: `npx vitest run apps/desktop/src/renderer/components/PmHome.test.tsx` → **fails** (no `next-up` testid; no editor).

2. **Implement** — edit `apps/desktop/src/renderer/components/PmHome.tsx`:
   - Update imports at the top:
     ```tsx
     import { useState } from 'react'
     import type { Task } from '@apc/shared'
     import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
     import { api } from '../api.js'
     import { nextUp } from '../task-deps.js'
     import { TimelineStrip } from './TimelineStrip.js'
     import { TaskBoard } from './TaskBoard.js'
     import { DevHarnessPanel } from './DevHarnessPanel.js'
     ```
   - Replace the top of the component (state + derived tasks) — after `const { project, reviewQueue, recentRuns, allTasks } = dashboard`:
     ```tsx
     const [depOverrides, setDepOverrides] = useState<Record<string, string[]>>({})
     const tasks: Task[] = allTasks.map((t) => (depOverrides[t.id] ? { ...t, blockedBy: depOverrides[t.id] } : t))
     const handleSetBlockedBy = (taskId: string, blockedBy: string[]) => {
       setDepOverrides((prev) => ({ ...prev, [taskId]: blockedBy }))
       void api.taskSetBlockedBy({ taskId, blockedBy })
     }
     const upNext = nextUp(tasks)
     ```
   - Change the Task Board section to pass the merged tasks + handler:
     ```tsx
     <section className="pm-home__board">
       <h2>Task Board</h2>
       <TaskBoard tasks={tasks} onSetBlockedBy={handleSetBlockedBy} />
     </section>
     ```
   - Insert the Next Up section immediately **after** the `pm-home__timeline` section and before `pm-home__board`:
     ```tsx
     <section className="pm-home__next-up" data-testid="next-up">
       <h2>다음 할 일</h2>
       {upNext.length === 0 ? (
         <p className="pm-home__empty">진행할 수 있는 작업 없음</p>
       ) : (
         <ol className="pm-home__next-list">
           {upNext.map((t) => (
             <li key={t.id}>
               <span className="task-title">{t.title}</span>
               <span className={`pm-board__priority pm-board__priority--${t.priority}`}>{t.priority}</span>
               {t.dueDate && <span className="pm-board__due">{t.dueDate}</span>}
             </li>
           ))}
         </ol>
       )}
     </section>
     ```
   (Leave `TimelineStrip` and `DevHarnessPanel` reading `allTasks` — they only need id/title/status and dependency edits shouldn't churn them.)
   Run: `npx vitest run apps/desktop/src/renderer/components/PmHome.test.tsx` → **passes** (the pre-existing "renders goal", "task board columns", "timeline marker", "review queue and recent runs" tests still hold).

3. **Typecheck**: `pnpm typecheck` → clean.

4. **Full regression** — this is the last task; run the whole suite:
   ```
   pnpm test
   ```
   Expected: all suites pass (~2.5 min).

5. **Commit**:
   ```
   git add -A && git commit -m "feat(desktop): PmHome 다음 할 일 widget + wire dependency editor

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```

---

## Self-review

### Spec coverage (handoff §4 P1)
- **`blockedBy: string[]` on Task** → Task 1 (schema, output-required, default `[]`).
- **Persistence + migration** → Task 2 (`blocked_by` JSON column, idempotent `addColumnIfMissing`, `create`/`get`/`list` round-trip, `setBlockedBy`).
- **SP1 capture default** → Task 3 (test locks the schema default).
- **Write API + cycle guard** → Task 4 (IPC `taskSetBlockedBy`; self-reference + direct-cycle rejection; strict-parse; preload untouched by design and noted).
- **TaskBoard 차단 표시** → Task 7 (`🚫 차단` badge = dep exists AND not done, computed from the passed tasks array; tooltip lists blocker titles).
- **Work graph task→task 엣지** → Task 5 (`kind: 'blocks'` edges in `buildWorkGraphData` + KnowledgeView wiring).
- **"다음 할 일" (unblocked, priority order) 위젯** → Task 6 (`nextUp` helper) + Task 8 (PmHome section).
- **Dependency editing UI (MVP)** → Task 7 (`⛓` + `<select multiple>` in TaskBoard) + Task 8 (wired via optimistic overlay → `api.taskSetBlockedBy`).

### Placeholder scan
No `TODO`, `TBD`, `FIXME`, `...` elisions, or "same as task N" back-references in code blocks. Every test, implementation snippet, run command, and commit command is literal and runnable.

### Type consistency
- `blockedBy` is output-required on `Task` (mirrors `acceptanceCriteria`/`linkedWikiPages`); Task 1 gates on `pnpm typecheck` so every literal is fixed before proceeding. This is called out explicitly because typecheck includes test files.
- `WorkTaskInput.blockedBy` is **optional** (`?: string[]`) so existing callers/tests need no change; a `Task['blockedBy']` (`string[]`) is assignable to it.
- `validateBlockedBy` return type is a discriminated union `{ ok: true } | { ok: false; reason: 'self-reference' | 'cycle' }`; the container maps `reason` into `TaskSetBlockedByRes.reason?: string`.
- IPC handler strict-parse (`z.object({...}).strict()`) matches the pattern of neighbouring handlers and is covered by a rejection test.
- Renderer editor is gated behind the optional `onSetBlockedBy` prop, so `window.apc` is only touched in the one PmHome test that stubs it — the four pre-existing TaskBoard tests and four pre-existing PmHome tests stay green without a bridge stub.

### Known MVP limitations (documented in-code / here, not bugs)
- Work graph only draws `blocks` edges between `req:` request-tasks (KnowledgeView feeds only those); dependencies on `todo:` tasks still drive the badge + Next Up but aren't drawn. Follow-up: feed all tasks into the work graph.
- Cycle guard covers self-reference and direct 2-cycles only; transitive cycles are out of scope.
- PmHome edits are optimistic-local + persisted; no upstream auto re-fetch (a project re-select reloads the true state).
