# Agent Project Console — Foundation & Common Core Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo and the Common Core packages (shared contracts, SQLite-backed ProjectRegistry, Obsidian vault adapter, conflict manager, local job runner) with full test coverage, so later plans (terminal/ingest, LLM Wiki, PM dashboard) build on a stable foundation.

**Architecture:** A pnpm monorepo. `@apc/shared` holds Zod schemas (the single source of truth for contracts). `@apc/core` owns the SQLite database layer + ProjectRegistry + ConflictManager. `@apc/vault` reads/writes Obsidian-compatible Markdown (YAML frontmatter + `[[wiki-link]]`). `@apc/workflow` provides the `WorkflowRunner` interface and an MVP `LocalWorkerRunner` that persists jobs to SQLite. No Electron/UI in this plan — those come in Plan 2.

**Tech Stack:** TypeScript (ESM), pnpm workspaces, Vitest, Zod, better-sqlite3, gray-matter (frontmatter), Node 20+.

> Spec: `docs/superpowers/specs/2026-06-01-agent-project-console-design.md` (PRD v0.3). This plan covers §3 stack, §4 monorepo + Common Core, §5 contracts, §7 project identity, §10 conflict model, §11 vault, plus the `WorkflowRunner`/Job model.

---

## File Structure

```
package.json                     # root workspace, scripts, dev deps
pnpm-workspace.yaml              # workspace globs
tsconfig.base.json               # shared TS config
vitest.config.ts                 # root test config + @apc/* aliases

packages/
  shared/
    package.json
    src/index.ts                 # re-exports
    src/schema.ts                # Zod schemas: Project, Task, AgentRun, Review, AgentKind, ...
    src/schema.test.ts
  core/
    package.json
    src/index.ts
    src/db.ts                    # better-sqlite3 open + migrate
    src/db.test.ts
    src/project-registry.ts      # ProjectRegistry (SQLite-backed)
    src/project-registry.test.ts
    src/conflict-manager.ts      # hash detect + conflict doc
    src/conflict-manager.test.ts
  vault/
    package.json
    src/index.ts
    src/vault-adapter.ts         # ObsidianVaultAdapter (frontmatter + wiki-link)
    src/vault-adapter.test.ts
  workflow/
    package.json
    src/index.ts
    src/local-worker-runner.ts   # WorkflowRunner interface + LocalWorkerRunner
    src/local-worker-runner.test.ts
```

---

## Prerequisite: tooling

This plan assumes `pnpm` and Node 20+ are installed. Verify before Task 1:

```bash
node --version   # expect v20.x or higher
pnpm --version   # expect 8.x or 9.x; if missing: npm i -g pnpm
```

---

### Task 1: Monorepo scaffold + toolchain smoke test

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/smoke.test.ts`

- [ ] **Step 1: Create the workspace config files**

`package.json`:

```json
{
  "name": "agent-project-console",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@apc/shared': `${root}packages/shared/src/index.ts`,
      '@apc/core': `${root}packages/core/src/index.ts`,
      '@apc/vault': `${root}packages/vault/src/index.ts`,
      '@apc/workflow': `${root}packages/workflow/src/index.ts`,
    },
  },
  test: {
    globals: true,
    include: ['packages/**/*.test.ts'],
  },
})
```

- [ ] **Step 2: Create the `@apc/shared` package skeleton**

`packages/shared/package.json`:

```json
{
  "name": "@apc/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "zod": "^3.23.8"
  }
}
```

`packages/shared/src/index.ts`:

```ts
export const VERSION = '0.0.0'
```

- [ ] **Step 3: Write the smoke test**

`packages/shared/src/smoke.test.ts`:

```ts
import { expect, test } from 'vitest'
import { VERSION } from './index.js'

test('shared package exports VERSION', () => {
  expect(VERSION).toBe('0.0.0')
})
```

- [ ] **Step 4: Install deps and run the smoke test**

Run:

```bash
pnpm install
pnpm test
```

Expected: 1 passed (`packages/shared/src/smoke.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo + vitest toolchain"
```

---

### Task 2: `@apc/shared` — Zod contracts

**Files:**
- Create: `packages/shared/src/schema.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/schema.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { ProjectSchema, TaskSchema, AgentRunSchema, ReviewSchema, AgentKind } from './schema.js'

describe('ProjectSchema', () => {
  test('parses a valid hybrid project', () => {
    const p = ProjectSchema.parse({
      id: 'agent-project-console',
      name: 'Agent Project Console',
      status: 'active',
      goal: 'Task lifecycle MVP',
      projectType: 'hybrid',
      repoPaths: ['/mnt/c/work/apc'],
      vaultPaths: ['vault/projects/agent-project-console'],
      sourcePaths: ['~/.claude'],
    })
    expect(p.status).toBe('active')
    expect(p.repoPaths).toHaveLength(1)
  })

  test('rejects an unknown status', () => {
    expect(() =>
      ProjectSchema.parse({
        id: 'x',
        name: 'x',
        status: 'on-fire',
        projectType: 'git',
        repoPaths: [],
        vaultPaths: [],
        sourcePaths: [],
      }),
    ).toThrow()
  })
})

describe('TaskSchema', () => {
  test('parses a task assigned to an agent', () => {
    const t = TaskSchema.parse({
      id: 'TASK-003',
      projectId: 'agent-project-console',
      title: 'terminal wrapper 설계',
      status: 'in_progress',
      assigneeType: 'agent',
      assignee: 'codex',
      reviewStatus: 'pending',
    })
    expect(t.assignee).toBe('codex')
    expect(t.reviewStatus).toBe('pending')
  })
})

describe('AgentRunSchema', () => {
  test('parses a completed run', () => {
    const r = AgentRunSchema.parse({
      id: 'RUN-20260601-001',
      taskId: 'TASK-003',
      agent: 'codex',
      repoPath: '/mnt/c/work/apc',
      startedAt: '2026-06-01T10:00:00Z',
      status: 'completed',
    })
    expect(AgentKind.options).toContain(r.agent)
  })
})

describe('ReviewSchema', () => {
  test('parses a needs_changes review with next tasks', () => {
    const v = ReviewSchema.parse({
      id: 'REVIEW-001',
      taskId: 'TASK-003',
      agentRunId: 'RUN-20260601-001',
      reviewer: 'hyoseok',
      status: 'needs_changes',
      summary: 'resolver 정책 보완 필요',
      nextTasks: ['TASK-004'],
    })
    expect(v.nextTasks).toEqual(['TASK-004'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/shared/src/schema.test.ts`
Expected: FAIL — cannot resolve `./schema.js` (module does not exist).

- [ ] **Step 3: Write the schema**

`packages/shared/src/schema.ts`:

```ts
import { z } from 'zod'

export const AgentKind = z.enum(['claude', 'codex', 'opencode'])
export type AgentKind = z.infer<typeof AgentKind>

export const ProjectType = z.enum(['git', 'obsidian', 'hybrid'])
export const ProjectStatus = z.enum(['active', 'maintenance', 'paused', 'archived'])

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: ProjectStatus,
  goal: z.string().optional(),
  currentFocus: z.string().optional(),
  startDate: z.string().optional(),
  targetDate: z.string().optional(),
  projectType: ProjectType,
  repoPaths: z.array(z.string()).default([]),
  vaultPaths: z.array(z.string()).default([]),
  sourcePaths: z.array(z.string()).default([]),
})
export type Project = z.infer<typeof ProjectSchema>

export const TaskStatus = z.enum(['todo', 'in_progress', 'review', 'done', 'rejected'])
export const ReviewStatus = z.enum(['none', 'pending', 'approved', 'needs_changes', 'rejected'])

export const TaskSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  status: TaskStatus,
  assigneeType: z.enum(['agent', 'human']).default('agent'),
  assignee: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().optional(),
  contextPackage: z.string().optional(),
  reviewStatus: ReviewStatus.default('none'),
})
export type Task = z.infer<typeof TaskSchema>

export const AgentRunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agent: AgentKind,
  repoPath: z.string(),
  branch: z.string().optional(),
  worktreePath: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  transcriptPath: z.string().optional(),
  summaryPath: z.string().optional(),
})
export type AgentRun = z.infer<typeof AgentRunSchema>

export const ReviewSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  agentRunId: z.string().min(1),
  reviewer: z.string().min(1),
  status: z.enum(['approved', 'needs_changes', 'rejected']),
  summary: z.string(),
  nextTasks: z.array(z.string()).default([]),
})
export type Review = z.infer<typeof ReviewSchema>
```

- [ ] **Step 4: Re-export from the package index**

Replace `packages/shared/src/index.ts` with:

```ts
export const VERSION = '0.0.0'
export * from './schema.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- packages/shared/src/schema.test.ts`
Expected: PASS (4 describe blocks, all green).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): add Zod contracts for Project/Task/AgentRun/Review"
```

---

### Task 3: `@apc/core` — SQLite database + migrations

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/db.ts`
- Test: `packages/core/src/db.test.ts`

- [ ] **Step 1: Create the package manifest and install native deps**

`packages/core/package.json`:

```json
{
  "name": "@apc/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@apc/shared": "workspace:*",
    "better-sqlite3": "^11.1.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

Run:

```bash
pnpm install
```

Expected: better-sqlite3 builds its native addon without error.

- [ ] **Step 2: Write the failing test**

`packages/core/src/db.test.ts`:

```ts
import { expect, test } from 'vitest'
import { openDb, migrate } from './db.js'

test('migrate creates the core tables', () => {
  const db = openDb(':memory:')
  migrate(db)
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: { name: string }) => r.name)
  expect(tables).toContain('projects')
  expect(tables).toContain('project_source_map')
  expect(tables).toContain('ingest_cursors')
  db.close()
})

test('migrate is idempotent', () => {
  const db = openDb(':memory:')
  migrate(db)
  expect(() => migrate(db)).not.toThrow()
  db.close()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/db.test.ts`
Expected: FAIL — cannot resolve `./db.js`.

- [ ] **Step 4: Write the database layer**

`packages/core/src/db.ts`:

```ts
import Database from 'better-sqlite3'

export type Db = Database.Database

export function openDb(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      status       TEXT NOT NULL,
      goal         TEXT,
      current_focus TEXT,
      start_date   TEXT,
      target_date  TEXT,
      project_type TEXT NOT NULL,
      repo_paths   TEXT NOT NULL DEFAULT '[]',
      vault_paths  TEXT NOT NULL DEFAULT '[]',
      source_paths TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS project_source_map (
      agent_kind TEXT NOT NULL,
      native_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      PRIMARY KEY (agent_kind, native_key),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ingest_cursors (
      source_id  TEXT PRIMARY KEY,
      cursor     TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}
```

- [ ] **Step 5: Export from the package index**

`packages/core/src/index.ts`:

```ts
export * from './db.js'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- packages/core/src/db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add SQLite db layer + migrations (projects, source map, cursors)"
```

---

### Task 4: `@apc/core` — ProjectRegistry

**Files:**
- Create: `packages/core/src/project-registry.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/project-registry.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/project-registry.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import type { Project } from '@apc/shared'
import { openDb, migrate, type Db } from './db.js'
import { ProjectRegistry } from './project-registry.js'

const sample: Project = {
  id: 'apc',
  name: 'Agent Project Console',
  status: 'active',
  projectType: 'hybrid',
  repoPaths: ['/mnt/c/work/apc'],
  vaultPaths: ['vault/projects/apc'],
  sourcePaths: ['~/.claude'],
}

describe('ProjectRegistry', () => {
  let db: Db
  let registry: ProjectRegistry

  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    registry = new ProjectRegistry(db)
  })

  test('register then get returns the project', () => {
    registry.register(sample)
    expect(registry.get('apc')?.name).toBe('Agent Project Console')
  })

  test('list returns all registered projects', () => {
    registry.register(sample)
    registry.register({ ...sample, id: 'b', name: 'B', repoPaths: ['/b'] })
    expect(registry.list().map((p) => p.id).sort()).toEqual(['apc', 'b'])
  })

  test('findByRepoPath matches the canonical key', () => {
    registry.register(sample)
    expect(registry.findByRepoPath('/mnt/c/work/apc')?.id).toBe('apc')
    expect(registry.findByRepoPath('/nope')).toBeUndefined()
  })

  test('native-key mapping resolves to a project id', () => {
    registry.register(sample)
    registry.mapNativeKey('claude', '-mnt-c-work-apc', 'apc')
    expect(registry.resolveProjectId('claude', '-mnt-c-work-apc')).toBe('apc')
    expect(registry.resolveProjectId('codex', 'unknown')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/project-registry.test.ts`
Expected: FAIL — cannot resolve `./project-registry.js`.

- [ ] **Step 3: Write the ProjectRegistry**

`packages/core/src/project-registry.ts`:

```ts
import { ProjectSchema, type Project } from '@apc/shared'
import type { Db } from './db.js'

type Row = {
  id: string
  name: string
  status: string
  goal: string | null
  current_focus: string | null
  start_date: string | null
  target_date: string | null
  project_type: string
  repo_paths: string
  vault_paths: string
  source_paths: string
}

function rowToProject(row: Row): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    goal: row.goal ?? undefined,
    currentFocus: row.current_focus ?? undefined,
    startDate: row.start_date ?? undefined,
    targetDate: row.target_date ?? undefined,
    projectType: row.project_type,
    repoPaths: JSON.parse(row.repo_paths),
    vaultPaths: JSON.parse(row.vault_paths),
    sourcePaths: JSON.parse(row.source_paths),
  })
}

export class ProjectRegistry {
  constructor(private readonly db: Db) {}

  register(input: Project): void {
    const p = ProjectSchema.parse(input)
    this.db
      .prepare(
        `INSERT OR REPLACE INTO projects
         (id, name, status, goal, current_focus, start_date, target_date,
          project_type, repo_paths, vault_paths, source_paths)
         VALUES (@id, @name, @status, @goal, @currentFocus, @startDate, @targetDate,
                 @projectType, @repoPaths, @vaultPaths, @sourcePaths)`,
      )
      .run({
        id: p.id,
        name: p.name,
        status: p.status,
        goal: p.goal ?? null,
        currentFocus: p.currentFocus ?? null,
        startDate: p.startDate ?? null,
        targetDate: p.targetDate ?? null,
        projectType: p.projectType,
        repoPaths: JSON.stringify(p.repoPaths),
        vaultPaths: JSON.stringify(p.vaultPaths),
        sourcePaths: JSON.stringify(p.sourcePaths),
      })
  }

  get(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
    return row ? rowToProject(row) : undefined
  }

  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY id').all() as Row[]
    return rows.map(rowToProject)
  }

  findByRepoPath(repoPath: string): Project | undefined {
    // canonical project key = a repo path in repo_paths (spec §7)
    const rows = this.db.prepare('SELECT * FROM projects').all() as Row[]
    const match = rows.find((r) => (JSON.parse(r.repo_paths) as string[]).includes(repoPath))
    return match ? rowToProject(match) : undefined
  }

  mapNativeKey(agentKind: string, nativeKey: string, projectId: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_source_map (agent_kind, native_key, project_id)
         VALUES (?, ?, ?)`,
      )
      .run(agentKind, nativeKey, projectId)
  }

  resolveProjectId(agentKind: string, nativeKey: string): string | undefined {
    const row = this.db
      .prepare('SELECT project_id FROM project_source_map WHERE agent_kind = ? AND native_key = ?')
      .get(agentKind, nativeKey) as { project_id: string } | undefined
    return row?.project_id
  }
}
```

- [ ] **Step 4: Export from the package index**

Replace `packages/core/src/index.ts` with:

```ts
export * from './db.js'
export * from './project-registry.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- packages/core/src/project-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add SQLite-backed ProjectRegistry with repoPath + native-key mapping"
```

---

### Task 5: `@apc/vault` — ObsidianVaultAdapter

**Files:**
- Create: `packages/vault/package.json`
- Create: `packages/vault/src/index.ts`
- Create: `packages/vault/src/vault-adapter.ts`
- Test: `packages/vault/src/vault-adapter.test.ts`

- [ ] **Step 1: Create the package manifest and install deps**

`packages/vault/package.json`:

```json
{
  "name": "@apc/vault",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "gray-matter": "^4.0.3"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/vault/src/vault-adapter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultAdapter } from './vault-adapter.js'

describe('VaultAdapter', () => {
  let dir: string
  let vault: VaultAdapter

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-vault-'))
    vault = new VaultAdapter(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('write then read round-trips frontmatter and body', () => {
    vault.writeDoc('projects/apc/current.md', {
      frontmatter: { project_id: 'apc', status: 'active' },
      body: '# Current\n\nSee [[TASK-003]].\n',
    })
    const doc = vault.readDoc('projects/apc/current.md')
    expect(doc.frontmatter).toEqual({ project_id: 'apc', status: 'active' })
    expect(doc.body.trim()).toBe('# Current\n\nSee [[TASK-003]].')
  })

  test('extractWikiLinks finds [[links]]', () => {
    expect(vault.extractWikiLinks('see [[TASK-003]] and [[RUN-001]]')).toEqual([
      'TASK-003',
      'RUN-001',
    ])
    expect(vault.extractWikiLinks('no links here')).toEqual([])
  })

  test('readDoc throws a clear error for a missing file', () => {
    expect(() => vault.readDoc('projects/apc/missing.md')).toThrow(/not found/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- packages/vault/src/vault-adapter.test.ts`
Expected: FAIL — cannot resolve `./vault-adapter.js`.

- [ ] **Step 4: Write the adapter**

`packages/vault/src/vault-adapter.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import matter from 'gray-matter'

export type VaultDoc = {
  frontmatter: Record<string, unknown>
  body: string
}

const WIKI_LINK = /\[\[([^\]]+)\]\]/g

export class VaultAdapter {
  constructor(private readonly root: string) {}

  private abs(relPath: string): string {
    if (isAbsolute(relPath)) return relPath
    return resolve(this.root, relPath)
  }

  readDoc(relPath: string): VaultDoc {
    const file = this.abs(relPath)
    if (!existsSync(file)) {
      throw new Error(`Vault document not found: ${relPath}`)
    }
    const raw = readFileSync(file, 'utf8')
    const parsed = matter(raw)
    return { frontmatter: parsed.data, body: parsed.content }
  }

  writeDoc(relPath: string, doc: VaultDoc): void {
    const file = this.abs(relPath)
    mkdirSync(dirname(file), { recursive: true })
    const out = matter.stringify(doc.body, doc.frontmatter)
    writeFileSync(file, out, 'utf8')
  }

  extractWikiLinks(body: string): string[] {
    const links: string[] = []
    for (const match of body.matchAll(WIKI_LINK)) {
      links.push(match[1].trim())
    }
    return links
  }
}
```

- [ ] **Step 5: Export from the package index**

`packages/vault/src/index.ts`:

```ts
export * from './vault-adapter.js'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- packages/vault/src/vault-adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(vault): add Obsidian-compatible VaultAdapter (frontmatter + wiki-links)"
```

---

### Task 6: `@apc/core` — ConflictManager

**Files:**
- Create: `packages/core/src/conflict-manager.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/conflict-manager.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/conflict-manager.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { ConflictManager } from './conflict-manager.js'

describe('ConflictManager', () => {
  const cm = new ConflictManager()

  test('hash is stable for the same content', () => {
    expect(cm.hash('hello')).toBe(cm.hash('hello'))
    expect(cm.hash('hello')).not.toBe(cm.hash('world'))
  })

  test('detectConflict is false when last-read hash matches current content', () => {
    const current = '# current\n'
    const lastRead = cm.hash(current)
    expect(cm.detectConflict(lastRead, current)).toBe(false)
  })

  test('detectConflict is true when the file changed since last read', () => {
    const lastRead = cm.hash('# old\n')
    expect(cm.detectConflict(lastRead, '# changed on disk\n')).toBe(true)
  })

  test('buildConflictDoc includes all four sections', () => {
    const doc = cm.buildConflictDoc({
      targetPath: 'projects/apc/current.md',
      previousVersion: '# v1\n',
      currentVersion: '# v2 (edited in Obsidian)\n',
      proposedChange: '# v3 (LLM proposal)\n',
    })
    expect(doc).toContain('projects/apc/current.md')
    expect(doc).toContain('# v1')
    expect(doc).toContain('# v2 (edited in Obsidian)')
    expect(doc).toContain('# v3 (LLM proposal)')
    expect(doc).toContain('## Merge proposal')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/conflict-manager.test.ts`
Expected: FAIL — cannot resolve `./conflict-manager.js`.

- [ ] **Step 3: Write the ConflictManager**

`packages/core/src/conflict-manager.ts`:

```ts
import { createHash } from 'node:crypto'

export type ConflictInput = {
  targetPath: string
  previousVersion: string
  currentVersion: string
  proposedChange: string
}

export class ConflictManager {
  hash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }

  /** True when the on-disk content no longer matches what the app last read. */
  detectConflict(lastReadHash: string, currentContent: string): boolean {
    return this.hash(currentContent) !== lastReadHash
  }

  buildConflictDoc(input: ConflictInput): string {
    return [
      '---',
      'type: conflict',
      `target: ${input.targetPath}`,
      '---',
      '',
      `# Conflict: ${input.targetPath}`,
      '',
      '## Previous version (app last knew)',
      '',
      '```markdown',
      input.previousVersion.trimEnd(),
      '```',
      '',
      '## Current version (on disk now)',
      '',
      '```markdown',
      input.currentVersion.trimEnd(),
      '```',
      '',
      '## LLM proposed change',
      '',
      '```markdown',
      input.proposedChange.trimEnd(),
      '```',
      '',
      '## Merge proposal',
      '',
      '- [ ] Keep current (on disk)',
      '- [ ] Accept LLM proposal',
      '- [ ] Merge manually below',
      '',
    ].join('\n')
  }
}
```

- [ ] **Step 4: Add to the package index**

Replace `packages/core/src/index.ts` with:

```ts
export * from './db.js'
export * from './project-registry.js'
export * from './conflict-manager.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- packages/core/src/conflict-manager.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add ConflictManager (hash detect + conflict document)"
```

---

### Task 7: `@apc/workflow` — WorkflowRunner + LocalWorkerRunner

**Files:**
- Create: `packages/workflow/package.json`
- Create: `packages/workflow/src/index.ts`
- Create: `packages/workflow/src/local-worker-runner.ts`
- Test: `packages/workflow/src/local-worker-runner.test.ts`

- [ ] **Step 1: Create the package manifest and install deps**

`packages/workflow/package.json`:

```json
{
  "name": "@apc/workflow",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "better-sqlite3": "^11.1.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/workflow/src/local-worker-runner.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { LocalWorkerRunner } from './local-worker-runner.js'

describe('LocalWorkerRunner', () => {
  let runner: LocalWorkerRunner

  beforeEach(() => {
    runner = new LocalWorkerRunner(new Database(':memory:'))
  })

  test('runs a registered handler and records a completed job', async () => {
    runner.register('echo', async (input) => ({ echoed: input }))
    const jobId = await runner.start('echo', { hi: 1 })
    const job = runner.getJobStatus(jobId)
    expect(job?.status).toBe('completed')
    expect(job?.result).toEqual({ echoed: { hi: 1 } })
  })

  test('records a failed job when the handler throws', async () => {
    runner.register('boom', async () => {
      throw new Error('kaboom')
    })
    const jobId = await runner.start('boom', {})
    const job = runner.getJobStatus(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('kaboom')
  })

  test('throws when starting an unregistered job type', async () => {
    await expect(runner.start('nope', {})).rejects.toThrow(/no handler/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- packages/workflow/src/local-worker-runner.test.ts`
Expected: FAIL — cannot resolve `./local-worker-runner.js`.

- [ ] **Step 4: Write the runner**

`packages/workflow/src/local-worker-runner.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

export type JobRecord = {
  id: string
  type: string
  status: JobStatus
  input: unknown
  result: unknown
  error: string | null
}

export type JobHandler = (input: unknown) => Promise<unknown>

/**
 * MVP job runner. Persists jobs to SQLite and runs handlers in-process.
 * Implements the WorkflowRunner contract via the generic start()/getJobStatus().
 * Plan: a TemporalWorkflowRunner can replace this behind the same surface.
 */
export class LocalWorkerRunner {
  private readonly handlers = new Map<string, JobHandler>()

  constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        status     TEXT NOT NULL,
        input      TEXT NOT NULL,
        result     TEXT,
        error      TEXT
      );
    `)
  }

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler)
  }

  async start(type: string, input: unknown): Promise<string> {
    const handler = this.handlers.get(type)
    if (!handler) throw new Error(`No handler registered for job type: ${type}`)

    const id = randomUUID()
    this.db
      .prepare('INSERT INTO jobs (id, type, status, input) VALUES (?, ?, ?, ?)')
      .run(id, type, 'running', JSON.stringify(input))

    try {
      const result = await handler(input)
      this.db
        .prepare('UPDATE jobs SET status = ?, result = ? WHERE id = ?')
        .run('completed', JSON.stringify(result ?? null), id)
    } catch (err) {
      this.db
        .prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?')
        .run('failed', err instanceof Error ? err.message : String(err), id)
    }
    return id
  }

  getJobStatus(jobId: string): JobRecord | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
      | {
          id: string
          type: string
          status: JobStatus
          input: string
          result: string | null
          error: string | null
        }
      | undefined
    if (!row) return undefined
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      input: JSON.parse(row.input),
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
    }
  }
}
```

- [ ] **Step 5: Export from the package index**

`packages/workflow/src/index.ts`:

```ts
export * from './local-worker-runner.js'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- packages/workflow/src/local-worker-runner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full suite and commit**

Run: `pnpm test`
Expected: ALL pass across shared/core/vault/workflow.

```bash
git add -A
git commit -m "feat(workflow): add LocalWorkerRunner (SQLite-backed in-process jobs)"
```

---

## Definition of Done (Plan 1)

- [ ] `pnpm install` succeeds (including better-sqlite3 native build).
- [ ] `pnpm test` is green across all four packages.
- [ ] `@apc/shared` exports validated Zod contracts for Project / Task / AgentRun / Review.
- [ ] `@apc/core` opens/migrates SQLite, provides ProjectRegistry (repoPath + native-key mapping) and ConflictManager.
- [ ] `@apc/vault` round-trips Obsidian-compatible Markdown (frontmatter + `[[wiki-link]]`).
- [ ] `@apc/workflow` runs and records jobs behind a runner contract that a Temporal adapter can later replace.

## What this plan deliberately defers (later plans)

- Electron shell, preload/contextBridge, React renderer, Zustand — **Plan 2**.
- `node-pty`/`xterm.js` terminal surface, `AgentAdapter` (Claude first), Transcript Resolver, incremental ingest, SQLite FTS search — **Plan 2**.
- `AgentRunner` multi-engine + model picker; work summary / current proposal / next-task generation — **Plan 3**.
- PM domain services (Task/AgentRun/Review lifecycle) + PM Control Tower UI + `dashboard-api` aggregates — **Plan 4**.
