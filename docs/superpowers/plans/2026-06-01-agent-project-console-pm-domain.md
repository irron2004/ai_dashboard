# Agent Project Console — PM Domain Implementation Plan (Plan 4 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the PM core loop as testable services: persist Tasks / AgentRuns / Reviews in SQLite, drive the review lifecycle state machine (approve / needs-changes / reject → next-task creation), write PM artifacts into the Obsidian vault, and expose a single `getProjectDashboard` aggregate for the UI.

**Architecture:** `@apc/pm` owns the domain: `migratePm` creates `tasks`/`agent_runs`/`reviews` tables; `TaskStore`/`AgentRunStore`/`ReviewStore` are thin SQLite repositories over `@apc/shared` Zod types; `ReviewService` is the pure state machine; `VaultWriter` renders artifacts via `@apc/vault` (canonical `current.md` is never overwritten — proposals go to a separate file); `dashboard-api` aggregates everything the PM Home screen needs.

**Tech Stack:** TypeScript (ESM), Vitest, Zod, `node:sqlite`, Node 24.

> Builds on Plans 1–3. Spec: §2 (task lifecycle), §5 (PM objects), §11 (vault structure: `tasks/`, `agent-runs/`, `reviews/`, `current.md` canonical vs proposal), §9 권한 (canonical apply = human gate), §13 (PM Control Tower aggregate).

---

## File Structure

```
packages/pm/
  package.json
  src/index.ts
  src/migrate.ts            # migratePm(db): tasks, agent_runs, reviews
  src/migrate.test.ts
  src/task-store.ts
  src/task-store.test.ts
  src/agent-run-store.ts
  src/agent-run-store.test.ts
  src/review-service.ts     # ReviewStore + applyReview state machine
  src/review-service.test.ts
  src/vault-writer.ts       # render task/run/review/proposal markdown
  src/vault-writer.test.ts
packages/dashboard-api/
  package.json
  src/index.ts
  src/project-dashboard.ts  # getProjectDashboard aggregate
  src/project-dashboard.test.ts
```

Add `@apc/pm` and `@apc/dashboard-api` aliases to `vitest.config.ts`.

---

### Task 1: `@apc/pm` scaffold + `migratePm`

**Files:** Create `packages/pm/package.json`, `src/index.ts`, `src/migrate.ts`; test `migrate.test.ts`; add aliases.

`packages/pm/package.json`:
```json
{
  "name": "@apc/pm",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*", "@apc/core": "workspace:*", "@apc/vault": "workspace:*" }
}
```

- [ ] **Step 1: Failing test**

```ts
import { expect, test } from 'vitest'
import { openDb, migrate } from '@apc/core'
import { migratePm } from './migrate.js'

test('migratePm creates tasks, agent_runs, reviews', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((r: { name: string }) => r.name)
  expect(tables).toEqual(expect.arrayContaining(['tasks', 'agent_runs', 'reviews']))
})

test('migratePm is idempotent', () => {
  const db = openDb(':memory:'); migrate(db); migratePm(db)
  expect(() => migratePm(db)).not.toThrow()
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { Db } from '@apc/core'

export function migratePm(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      title         TEXT NOT NULL,
      status        TEXT NOT NULL,
      assignee_type TEXT NOT NULL DEFAULT 'agent',
      assignee      TEXT,
      priority      TEXT NOT NULL DEFAULT 'medium',
      due_date      TEXT,
      context_package TEXT,
      review_status TEXT NOT NULL DEFAULT 'none'
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id            TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL,
      agent         TEXT NOT NULL,
      repo_path     TEXT NOT NULL,
      branch        TEXT,
      worktree_path TEXT,
      started_at    TEXT NOT NULL,
      ended_at      TEXT,
      status        TEXT NOT NULL,
      transcript_path TEXT,
      summary_path  TEXT
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      reviewer     TEXT NOT NULL,
      status       TEXT NOT NULL,
      summary      TEXT NOT NULL,
      next_tasks   TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON agent_runs(task_id);
  `)
}
```

`packages/pm/src/index.ts`:
```ts
export * from './migrate.js'
export * from './task-store.js'
export * from './agent-run-store.js'
export * from './review-service.js'
export * from './vault-writer.js'
```
(Export only `./migrate.js` now; add the rest per task.)

- [ ] **Step 4: Run → PASS (2).**
- [ ] **Step 5: Commit** — `feat(pm): scaffold package + migratePm (tasks/agent_runs/reviews)`

---

### Task 2: `TaskStore`

**Files:** Create `src/task-store.ts`; test `task-store.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { TaskStore } from './task-store.js'
import type { Task } from '@apc/shared'

const base: Task = {
  id: 'TASK-001', projectId: 'p1', title: 'first', status: 'todo',
  assigneeType: 'agent', assignee: 'codex', priority: 'high', reviewStatus: 'none',
}

describe('TaskStore', () => {
  let db: Db; let store: TaskStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new TaskStore(db) })

  test('create + get round-trips', () => {
    store.create(base)
    expect(store.get('TASK-001')?.title).toBe('first')
  })
  test('listByProject filters by project and optional status', () => {
    store.create(base)
    store.create({ ...base, id: 'TASK-002', status: 'done' })
    store.create({ ...base, id: 'TASK-003', projectId: 'p2' })
    expect(store.listByProject('p1').map((t) => t.id).sort()).toEqual(['TASK-001', 'TASK-002'])
    expect(store.listByProject('p1', { status: 'todo' }).map((t) => t.id)).toEqual(['TASK-001'])
  })
  test('updateStatus changes status and reviewStatus', () => {
    store.create(base)
    store.updateStatus('TASK-001', 'review', 'pending')
    const t = store.get('TASK-001')!
    expect(t.status).toBe('review'); expect(t.reviewStatus).toBe('pending')
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { TaskSchema, type Task, type TaskStatus, type ReviewStatus } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  id: string; project_id: string; title: string; status: string
  assignee_type: string; assignee: string | null; priority: string
  due_date: string | null; context_package: string | null; review_status: string
}

function toTask(r: Row): Task {
  return TaskSchema.parse({
    id: r.id, projectId: r.project_id, title: r.title, status: r.status,
    assigneeType: r.assignee_type, assignee: r.assignee ?? undefined, priority: r.priority,
    dueDate: r.due_date ?? undefined, contextPackage: r.context_package ?? undefined,
    reviewStatus: r.review_status,
  })
}

export class TaskStore {
  constructor(private readonly db: Db) {}

  create(input: Task): void {
    const t = TaskSchema.parse(input)
    this.db.prepare(
      `INSERT OR REPLACE INTO tasks
       (id, project_id, title, status, assignee_type, assignee, priority, due_date, context_package, review_status)
       VALUES (:id, :projectId, :title, :status, :assigneeType, :assignee, :priority, :dueDate, :contextPackage, :reviewStatus)`,
    ).run({
      id: t.id, projectId: t.projectId, title: t.title, status: t.status,
      assigneeType: t.assigneeType, assignee: t.assignee ?? null, priority: t.priority,
      dueDate: t.dueDate ?? null, contextPackage: t.contextPackage ?? null, reviewStatus: t.reviewStatus,
    })
  }

  get(id: string): Task | undefined {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    return r ? toTask(r) : undefined
  }

  listByProject(projectId: string, opts: { status?: TaskStatus } = {}): Task[] {
    const rows = (opts.status
      ? this.db.prepare('SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY id').all(projectId, opts.status)
      : this.db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id').all(projectId)) as Row[]
    return rows.map(toTask)
  }

  updateStatus(id: string, status: TaskStatus, reviewStatus?: ReviewStatus): void {
    if (reviewStatus) this.db.prepare('UPDATE tasks SET status = ?, review_status = ? WHERE id = ?').run(status, reviewStatus, id)
    else this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id)
  }
}
```

- [ ] **Step 4: Run → PASS (3).** Add export.
- [ ] **Step 5: Commit** — `feat(pm): TaskStore (create/get/listByProject/updateStatus)`

---

### Task 3: `AgentRunStore`

**Files:** Create `src/agent-run-store.ts`; test `agent-run-store.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { AgentRunStore } from './agent-run-store.js'
import type { AgentRun } from '@apc/shared'

const run: AgentRun = {
  id: 'RUN-1', taskId: 'TASK-001', agent: 'codex', repoPath: '/work/apc',
  branch: 'main', startedAt: '2026-06-01T10:00:00Z', status: 'running',
}

describe('AgentRunStore', () => {
  let db: Db; let store: AgentRunStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new AgentRunStore(db) })

  test('create + get round-trips', () => {
    store.create(run)
    expect(store.get('RUN-1')?.agent).toBe('codex')
  })
  test('complete sets endedAt/status/summaryPath', () => {
    store.create(run)
    store.complete('RUN-1', { endedAt: '2026-06-01T10:30:00Z', summaryPath: 'agent-runs/RUN-1-summary.md' })
    const r = store.get('RUN-1')!
    expect(r.status).toBe('completed'); expect(r.summaryPath).toContain('RUN-1')
  })
  test('listByTask returns runs for a task newest-first', () => {
    store.create(run)
    store.create({ ...run, id: 'RUN-2', startedAt: '2026-06-01T11:00:00Z' })
    expect(store.listByTask('TASK-001').map((r) => r.id)).toEqual(['RUN-2', 'RUN-1'])
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { AgentRunSchema, type AgentRun } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  id: string; task_id: string; agent: string; repo_path: string; branch: string | null
  worktree_path: string | null; started_at: string; ended_at: string | null
  status: string; transcript_path: string | null; summary_path: string | null
}
function toRun(r: Row): AgentRun {
  return AgentRunSchema.parse({
    id: r.id, taskId: r.task_id, agent: r.agent, repoPath: r.repo_path,
    branch: r.branch ?? undefined, worktreePath: r.worktree_path ?? undefined,
    startedAt: r.started_at, endedAt: r.ended_at ?? undefined, status: r.status,
    transcriptPath: r.transcript_path ?? undefined, summaryPath: r.summary_path ?? undefined,
  })
}

export class AgentRunStore {
  constructor(private readonly db: Db) {}

  create(input: AgentRun): void {
    const r = AgentRunSchema.parse(input)
    this.db.prepare(
      `INSERT OR REPLACE INTO agent_runs
       (id, task_id, agent, repo_path, branch, worktree_path, started_at, ended_at, status, transcript_path, summary_path)
       VALUES (:id, :taskId, :agent, :repoPath, :branch, :worktreePath, :startedAt, :endedAt, :status, :transcriptPath, :summaryPath)`,
    ).run({
      id: r.id, taskId: r.taskId, agent: r.agent, repoPath: r.repoPath, branch: r.branch ?? null,
      worktreePath: r.worktreePath ?? null, startedAt: r.startedAt, endedAt: r.endedAt ?? null,
      status: r.status, transcriptPath: r.transcriptPath ?? null, summaryPath: r.summaryPath ?? null,
    })
  }

  get(id: string): AgentRun | undefined {
    const r = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as Row | undefined
    return r ? toRun(r) : undefined
  }

  complete(id: string, patch: { endedAt: string; summaryPath?: string }): void {
    this.db.prepare('UPDATE agent_runs SET status = ?, ended_at = ?, summary_path = ? WHERE id = ?')
      .run('completed', patch.endedAt, patch.summaryPath ?? null, id)
  }

  listByTask(taskId: string): AgentRun[] {
    const rows = this.db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId) as Row[]
    return rows.map(toRun)
  }
}
```

- [ ] **Step 4: Run → PASS (3).** Add export.
- [ ] **Step 5: Commit** — `feat(pm): AgentRunStore (create/get/complete/listByTask)`

---

### Task 4: `ReviewService` — persist + lifecycle state machine

**Files:** Create `src/review-service.ts`; test `review-service.test.ts`.

**State machine (`applyReview`):**
- `approved` → task `status='done'`, `reviewStatus='approved'`
- `rejected` → task `status='rejected'`, `reviewStatus='rejected'`
- `needs_changes` → task `status='in_progress'`, `reviewStatus='needs_changes'`
- For every `review.nextTasks[]` title → produce a new `todo` Task draft in the same project (ids from an injected factory) and persist via `TaskStore`. Returns the created tasks.

- [ ] **Step 1: Failing test**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { TaskStore } from './task-store.js'
import { ReviewService } from './review-service.js'
import type { Review, Task } from '@apc/shared'

const task: Task = { id: 'TASK-001', projectId: 'p1', title: 't', status: 'review',
  assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending' }

function review(status: Review['status'], nextTasks: string[] = []): Review {
  return { id: 'REVIEW-1', taskId: 'TASK-001', agentRunId: 'RUN-1', reviewer: 'me', status, summary: 's', nextTasks }
}

describe('ReviewService.applyReview', () => {
  let db: Db; let tasks: TaskStore; let svc: ReviewService; let n: number
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    tasks = new TaskStore(db); tasks.create(task)
    n = 0
    svc = new ReviewService(db, tasks, () => `TASK-NEW-${++n}`)
  })

  test('approved → task done', () => {
    svc.applyReview(review('approved'))
    expect(tasks.get('TASK-001')!.status).toBe('done')
  })
  test('needs_changes → task back to in_progress', () => {
    svc.applyReview(review('needs_changes'))
    expect(tasks.get('TASK-001')!.status).toBe('in_progress')
    expect(tasks.get('TASK-001')!.reviewStatus).toBe('needs_changes')
  })
  test('rejected → task rejected', () => {
    svc.applyReview(review('rejected'))
    expect(tasks.get('TASK-001')!.status).toBe('rejected')
  })
  test('next tasks are created as todo in the same project', () => {
    const created = svc.applyReview(review('approved', ['do follow-up A', 'do follow-up B']))
    expect(created.map((t) => t.title)).toEqual(['do follow-up A', 'do follow-up B'])
    expect(tasks.get('TASK-NEW-1')!.status).toBe('todo')
    expect(tasks.get('TASK-NEW-2')!.projectId).toBe('p1')
  })
  test('persists the review row', () => {
    svc.applyReview(review('approved'))
    const row = db.prepare('SELECT status FROM reviews WHERE id = ?').get('REVIEW-1') as { status: string }
    expect(row.status).toBe('approved')
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { ReviewSchema, TaskSchema, type Review, type Task, type TaskStatus } from '@apc/shared'
import type { Db } from '@apc/core'
import type { TaskStore } from './task-store.js'

const NEXT_STATUS: Record<Review['status'], TaskStatus> = {
  approved: 'done', rejected: 'rejected', needs_changes: 'in_progress',
}

export class ReviewService {
  constructor(
    private readonly db: Db,
    private readonly tasks: TaskStore,
    private readonly nextId: () => string,
  ) {}

  applyReview(input: Review): Task[] {
    const review = ReviewSchema.parse(input)
    this.db.prepare(
      `INSERT OR REPLACE INTO reviews (id, task_id, agent_run_id, reviewer, status, summary, next_tasks)
       VALUES (:id, :taskId, :agentRunId, :reviewer, :status, :summary, :nextTasks)`,
    ).run({
      id: review.id, taskId: review.taskId, agentRunId: review.agentRunId, reviewer: review.reviewer,
      status: review.status, summary: review.summary, nextTasks: JSON.stringify(review.nextTasks),
    })

    this.tasks.updateStatus(review.taskId, NEXT_STATUS[review.status], review.status)

    const parent = this.tasks.get(review.taskId)
    const projectId = parent?.projectId ?? ''
    const created: Task[] = []
    for (const title of review.nextTasks) {
      const t = TaskSchema.parse({
        id: this.nextId(), projectId, title, status: 'todo',
        assigneeType: 'agent', priority: 'medium', reviewStatus: 'none',
      })
      this.tasks.create(t)
      created.push(t)
    }
    return created
  }
}
```

- [ ] **Step 4: Run → PASS (5).** Add export.
- [ ] **Step 5: Commit** — `feat(pm): ReviewService lifecycle state machine + next-task creation`

---

### Task 5: `VaultWriter` — PM artifacts (canonical-safe)

**Files:** Create `src/vault-writer.ts`; test `vault-writer.test.ts`.

**Behavior:** render Markdown (frontmatter + `[[wiki-link]]`) via `@apc/vault`'s `VaultAdapter` for: an AgentRun summary (`agent-runs/<runId>-summary.md`), a current **proposal** (`current.proposal.md` — NEVER `current.md`, which is the human-approved canonical), a task doc, and a review doc. Returns the relative path it wrote.

- [ ] **Step 1: Failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultAdapter } from '@apc/vault'
import { VaultWriter } from './vault-writer.js'

describe('VaultWriter', () => {
  let dir: string; let writer: VaultWriter
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apc-vw-')); writer = new VaultWriter(new VaultAdapter(dir)) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('writes an agent-run summary with frontmatter + link to the task', () => {
    const rel = writer.writeRunSummary('p1', {
      runId: 'RUN-1', taskId: 'TASK-001', agent: 'codex',
      summary: 'did the thing', filesTouched: ['a.ts'], openProblems: [],
    })
    expect(rel).toBe('projects/p1/agent-runs/RUN-1-summary.md')
    const doc = new VaultAdapter(dir).readDoc(rel)
    expect(doc.frontmatter.task_id).toBe('TASK-001')
    expect(doc.body).toContain('[[TASK-001]]')
    expect(doc.body).toContain('did the thing')
  })

  test('writes the current PROPOSAL to current.proposal.md, never current.md', () => {
    const rel = writer.writeCurrentProposal('p1', '## Current\n- updated\n')
    expect(rel).toBe('projects/p1/current.proposal.md')
    expect(() => new VaultAdapter(dir).readDoc('projects/p1/current.md')).toThrow(/not found/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { VaultAdapter } from '@apc/vault'

export type RunSummaryInput = {
  runId: string; taskId: string; agent: string
  summary: string; filesTouched: string[]; openProblems: string[]
}

export class VaultWriter {
  constructor(private readonly vault: VaultAdapter) {}

  writeRunSummary(projectId: string, input: RunSummaryInput): string {
    const rel = `projects/${projectId}/agent-runs/${input.runId}-summary.md`
    const body = [
      `# Run ${input.runId} — [[${input.taskId}]]`,
      '',
      '## Summary',
      input.summary,
      '',
      '## Files touched',
      input.filesTouched.map((f) => `- ${f}`).join('\n') || '- (none)',
      '',
      '## Open problems',
      input.openProblems.map((p) => `- ${p}`).join('\n') || '- (none)',
      '',
    ].join('\n')
    this.vault.writeDoc(rel, {
      frontmatter: { type: 'agent-run', run_id: input.runId, task_id: input.taskId, agent: input.agent },
      body,
    })
    return rel
  }

  /** Writes the LLM's proposed current.md. Canonical current.md is only ever written on human approval (UI layer). */
  writeCurrentProposal(projectId: string, proposedMarkdown: string): string {
    const rel = `projects/${projectId}/current.proposal.md`
    this.vault.writeDoc(rel, { frontmatter: { type: 'current-proposal', project_id: projectId }, body: proposedMarkdown })
    return rel
  }
}
```

- [ ] **Step 4: Run → PASS (2).** Add export.
- [ ] **Step 5: Commit** — `feat(pm): VaultWriter for run summaries + current proposal (canonical-safe)`

---

### Task 6: `@apc/dashboard-api` — `getProjectDashboard` aggregate

**Files:** Create `packages/dashboard-api/package.json`, `src/index.ts`, `src/project-dashboard.ts`; test `project-dashboard.test.ts`; add alias.

`packages/dashboard-api/package.json`:
```json
{
  "name": "@apc/dashboard-api",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*", "@apc/core": "workspace:*", "@apc/pm": "workspace:*" }
}
```

**Behavior:** `getProjectDashboard(deps, projectId)` returns `{ project, activeTasks, reviewQueue, recentRuns }` where `activeTasks` = status `todo`/`in_progress`, `reviewQueue` = tasks with `status='review'` (reviewStatus `pending`), `recentRuns` = latest runs across the project's tasks (cap 10).

- [ ] **Step 1: Failing test**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore } from '@apc/pm'
import { getProjectDashboard } from './project-dashboard.js'

describe('getProjectDashboard', () => {
  let db: Db; let registry: ProjectRegistry; let tasks: TaskStore; let runs: AgentRunStore
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    registry = new ProjectRegistry(db); tasks = new TaskStore(db); runs = new AgentRunStore(db)
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/p1'], vaultPaths: [], sourcePaths: [] })
    tasks.create({ id: 'T1', projectId: 'p1', title: 'active', status: 'in_progress', assigneeType: 'agent', priority: 'high', reviewStatus: 'none' })
    tasks.create({ id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending' })
    tasks.create({ id: 'T3', projectId: 'p1', title: 'done', status: 'done', assigneeType: 'agent', priority: 'low', reviewStatus: 'approved' })
    runs.create({ id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' })
  })

  test('aggregates project, active tasks, review queue, recent runs', () => {
    const dash = getProjectDashboard({ registry, tasks, runs }, 'p1')
    expect(dash.project.name).toBe('P1')
    expect(dash.activeTasks.map((t) => t.id)).toEqual(['T1'])
    expect(dash.reviewQueue.map((t) => t.id)).toEqual(['T2'])
    expect(dash.recentRuns.map((r) => r.id)).toEqual(['R1'])
  })

  test('throws for an unknown project', () => {
    expect(() => getProjectDashboard({ registry, tasks, runs }, 'nope')).toThrow(/not found/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { AgentRun, Project, Task } from '@apc/shared'
import type { ProjectRegistry } from '@apc/core'
import type { TaskStore, AgentRunStore } from '@apc/pm'

export type DashboardDeps = { registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }
export type ProjectDashboard = {
  project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[]
}

export function getProjectDashboard(deps: DashboardDeps, projectId: string): ProjectDashboard {
  const project = deps.registry.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  const all = deps.tasks.listByProject(projectId)
  const activeTasks = all.filter((t) => t.status === 'todo' || t.status === 'in_progress')
  const reviewQueue = all.filter((t) => t.status === 'review')
  const recentRuns = all
    .flatMap((t) => deps.runs.listByTask(t.id))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 10)
  return { project, activeTasks, reviewQueue, recentRuns }
}
```

- [ ] **Step 4: Run → PASS (2). Run full suite `pnpm test`.**
- [ ] **Step 5: Commit** — `feat(dashboard-api): getProjectDashboard aggregate`

---

## Definition of Done (Plan 4)

- [ ] `pnpm test` green incl. `@apc/pm` and `@apc/dashboard-api`.
- [ ] Task / AgentRun / Review persist and round-trip through SQLite.
- [ ] `ReviewService` enforces the lifecycle (approved→done, needs_changes→in_progress, rejected→rejected) and creates `todo` next-tasks in the same project.
- [ ] `VaultWriter` writes run summaries + a `current.proposal.md`; it never writes `current.md` (canonical stays a human gate).
- [ ] `getProjectDashboard` returns exactly the PM Home panels (active tasks, review queue, recent runs).

## Deferred

- Promoting `current.proposal.md` → `current.md` on PM approval, with the `ConflictManager` hash check (write-through) — small follow-up; lands with the approve action in **Plan 6 (UI)**.
- An `IngestService` wiring adapters → `ProjectRegistry.resolveProjectId`/mapping → `SearchIndex` → cursor save, run as a `LocalWorkerRunner` job, and a `RunService` that creates an `AgentRun`, ingests its transcript, calls `WikiEngine`, writes the summary, and flips the task to `review` — **Plan 6 (integration)**, since it composes Plans 2/3/4 and is exercised end-to-end by the UI.
