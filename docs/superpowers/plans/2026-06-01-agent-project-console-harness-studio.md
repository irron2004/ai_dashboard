# Agent Project Console — Harness Studio (read + select) Implementation Plan (Plan 5 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Read OpenCode agent configuration into a normalized, **read-only** `AgentProfile` model the PM can browse, and persist which profile the PM selects to run a given task. No editing, no writes to any tool's config, and credential files are never read.

**Architecture:** `@apc/harness` defines `AgentConfigAdapter` (read-only). `OpenCodeConfigAdapter` reads OpenCode's documented agent sources — the `agent` map in `opencode.json`/`opencode.jsonc` and markdown agent files (YAML frontmatter + prompt body) — into `AgentProfile`. A small `TaskProfileStore` persists the PM's per-task profile selection. `auth.json` and other credential files are hard-excluded.

**Tech Stack:** TypeScript (ESM), Vitest, Zod, `gray-matter`, `node:sqlite`, Node 24.

> Builds on Plans 1–4. Spec: §9.5 (Harness Studio: MVP = read + select; normalized read-only `AgentProfile`; OpenCode-first; config-read safety — exclude auth/session files; editing/teams/Claude+Codex = P1+).

> **Verified (2026-06-01):** OpenCode agent config on this machine lives under `~/.config/opencode/` and project `.opencode/` (the active setup uses an `oh-my-openagent` plugin layer; `auth.json` holds credentials). This plan targets OpenCode's **documented, stable** agent shapes (`opencode.json` `agent` map + markdown agent files); the `oh-my-openagent.json` plugin variant is a secondary source to map in a follow-up. Agent fields that actually appear: `model` (`provider/model-id`), `description`, plus optional `mode`/`permission`/`tools`/`temperature` when present.

---

## File Structure

```
packages/shared/src/
  harness-schema.ts        # AgentProfile (read-only), Permission
  harness-schema.test.ts
packages/harness/
  package.json
  src/index.ts
  src/types.ts             # AgentConfigAdapter interface
  src/jsonc.ts             # strip // and /* */ comments, then JSON.parse
  src/jsonc.test.ts
  src/opencode-config-adapter.ts
  src/opencode-config-adapter.test.ts
  src/migrate.ts           # migrateHarness(db): task_profile
  src/task-profile-store.ts
  src/task-profile-store.test.ts
```

Add `@apc/harness` alias to `vitest.config.ts`.

---

### Task 1: `AgentProfile` contract in `@apc/shared`

**Files:** Create `packages/shared/src/harness-schema.ts`; modify `index.ts`; test `harness-schema.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'vitest'
import { AgentProfileSchema } from './harness-schema.js'

describe('AgentProfileSchema', () => {
  test('parses a full profile', () => {
    const p = AgentProfileSchema.parse({
      id: 'opencode:build', provider: 'opencode', name: 'build', scope: 'project',
      mode: 'primary', model: 'openai/gpt-5.5', description: 'builder',
      permissions: { edit: 'allow', bash: 'ask' }, tools: ['edit', 'bash'],
      rawConfigPath: '/x/.opencode/opencode.json', rawFormat: 'json',
    })
    expect(p.permissions?.bash).toBe('ask')
  })
  test('requires provider/name/scope/rawConfigPath/rawFormat; defaults mode to custom', () => {
    const p = AgentProfileSchema.parse({
      id: 'x', provider: 'opencode', name: 'x', scope: 'global',
      rawConfigPath: '/x', rawFormat: 'markdown',
    })
    expect(p.mode).toBe('custom')
  })
  test('rejects an invalid permission value', () => {
    expect(() => AgentProfileSchema.parse({
      id: 'x', provider: 'opencode', name: 'x', scope: 'global',
      permissions: { edit: 'maybe' }, rawConfigPath: '/x', rawFormat: 'json',
    })).toThrow()
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod'

export const Permission = z.enum(['allow', 'ask', 'deny'])
export type Permission = z.infer<typeof Permission>

export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(['claude', 'codex', 'opencode']),
  name: z.string().min(1),
  scope: z.enum(['global', 'project', 'local', 'managed']),
  mode: z.enum(['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom']).default('custom'),
  description: z.string().optional(),
  model: z.string().optional(),
  prompt: z.object({ inline: z.string().optional(), filePath: z.string().optional() }).optional(),
  permissions: z.object({
    read: Permission.optional(), edit: Permission.optional(), bash: Permission.optional(),
    web: Permission.optional(), task: Permission.optional(),
  }).optional(),
  tools: z.array(z.string()).optional(),
  maxSteps: z.number().optional(),
  temperature: z.number().optional(),
  rawConfigPath: z.string().min(1),
  rawFormat: z.enum(['json', 'markdown', 'toml', 'unknown']),
})
export type AgentProfile = z.infer<typeof AgentProfileSchema>
```

- [ ] **Step 4: Export + run → PASS (3).**
- [ ] **Step 5: Commit** — `feat(shared): add read-only AgentProfile contract`

---

### Task 2: `@apc/harness` scaffold + adapter interface + JSONC parser

**Files:** Create `packages/harness/package.json`, `src/index.ts`, `src/types.ts`, `src/jsonc.ts`; test `jsonc.test.ts`; add alias.

`packages/harness/package.json`:
```json
{
  "name": "@apc/harness",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*", "@apc/core": "workspace:*", "gray-matter": "^4.0.3" }
}
```

`packages/harness/src/types.ts`:
```ts
import type { AgentProfile } from '@apc/shared'

export interface AgentConfigAdapter {
  readonly provider: 'claude' | 'codex' | 'opencode'
  /** Read-only. Returns normalized profiles found in global + project scope. Never reads credential files. */
  discoverProfiles(opts: { projectPath?: string }): Promise<AgentProfile[]>
}
```

- [ ] **Step 1: Failing test for JSONC**

```ts
import { describe, expect, test } from 'vitest'
import { parseJsonc } from './jsonc.js'

describe('parseJsonc', () => {
  test('parses JSON with // and /* */ comments', () => {
    const src = `{
      // line comment
      "agent": { "build": { "model": "openai/gpt-5.5" } } /* trailing */
    }`
    expect(parseJsonc(src)).toEqual({ agent: { build: { model: 'openai/gpt-5.5' } } })
  })
  test('does not strip // inside strings', () => {
    expect(parseJsonc('{"url":"https://x.y"}')).toEqual({ url: 'https://x.y' })
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
/** Minimal JSONC: strips // and /* *​/ comments, preserving comment-like sequences inside strings. */
export function parseJsonc(src: string): unknown {
  let out = ''
  let inStr = false, esc = false, i = 0
  while (i < src.length) {
    const ch = src[i], next = src[i + 1]
    if (inStr) {
      out += ch
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      i++; continue
    }
    if (ch === '"') { inStr = true; out += ch; i++; continue }
    if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (ch === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += ch; i++
  }
  return JSON.parse(out)
}
```

`packages/harness/src/index.ts`:
```ts
export * from './types.js'
export * from './jsonc.js'
export * from './opencode-config-adapter.js'
export * from './migrate.js'
export * from './task-profile-store.js'
```
(Export only `./types.js` + `./jsonc.js` now; add the rest per task.)

- [ ] **Step 4: Run → PASS (2).**
- [ ] **Step 5: Commit** — `feat(harness): scaffold + AgentConfigAdapter interface + JSONC parser`

---

### Task 3: `OpenCodeConfigAdapter` — read profiles (json map + markdown agents)

**Files:** Create `src/opencode-config-adapter.ts`; test `opencode-config-adapter.test.ts`.

**Behavior:** given `{ projectPath }`, read:
1. `<projectPath>/.opencode/opencode.json` or `.jsonc` → top-level `agent` object (each key = an agent; value may have `model`/`mode`/`description`/`permission`/`tools`/`temperature`/`prompt`) → `AgentProfile` (scope `project`, rawFormat `json`).
2. markdown agent files in `<projectPath>/.opencode/agent/*.md` (and `agents/*.md`) → YAML frontmatter (`description`/`mode`/`model`/`temperature`/`permission`/`tools`) + body as `prompt.inline` → `AgentProfile` (scope `project`, rawFormat `markdown`).

Missing files are skipped (return `[]`, never throw). **`auth.json` and any `*credential*`/`*secret*`/`*token*` file are never opened.**

- [ ] **Step 1: Failing test (builds fixtures)**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenCodeConfigAdapter } from './opencode-config-adapter.js'

describe('OpenCodeConfigAdapter', () => {
  let proj: string
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'apc-oc-cfg-'))
    const oc = join(proj, '.opencode')
    mkdirSync(join(oc, 'agent'), { recursive: true })
    writeFileSync(join(oc, 'opencode.jsonc'), `{
      // agents
      "agent": {
        "build": { "model": "openai/gpt-5.5", "mode": "primary", "description": "builder",
                   "permission": { "edit": "allow", "bash": "ask" } }
      }
    }`)
    writeFileSync(join(oc, 'agent', 'review.md'),
      `---\ndescription: code reviewer\nmode: subagent\nmodel: anthropic/claude\npermission:\n  edit: deny\n---\nReview the diff for risks.\n`)
    // credential file that must NOT be read
    writeFileSync(join(oc, 'auth.json'), '{"apiKey":"sk-SECRET"}')
  })
  afterEach(() => rmSync(proj, { recursive: true, force: true }))

  test('reads the json agent map into a profile', async () => {
    const profiles = await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: proj })
    const build = profiles.find((p) => p.name === 'build')!
    expect(build.provider).toBe('opencode')
    expect(build.model).toBe('openai/gpt-5.5')
    expect(build.mode).toBe('primary')
    expect(build.permissions?.bash).toBe('ask')
    expect(build.rawFormat).toBe('json')
  })

  test('reads a markdown agent (frontmatter + body prompt)', async () => {
    const profiles = await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: proj })
    const review = profiles.find((p) => p.name === 'review')!
    expect(review.mode).toBe('subagent')
    expect(review.permissions?.edit).toBe('deny')
    expect(review.prompt?.inline).toContain('Review the diff')
    expect(review.rawFormat).toBe('markdown')
  })

  test('never surfaces auth.json content as a profile', async () => {
    const profiles = await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: proj })
    expect(profiles.some((p) => p.rawConfigPath.endsWith('auth.json'))).toBe(false)
    expect(JSON.stringify(profiles)).not.toContain('sk-SECRET')
  })

  test('returns [] when there is no .opencode dir', async () => {
    expect(await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: '/no/such/path' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import matter from 'gray-matter'
import { AgentProfileSchema, type AgentProfile, type Permission } from '@apc/shared'
import type { AgentConfigAdapter } from './types.js'
import { parseJsonc } from './jsonc.js'

const PERM_KEYS = ['read', 'edit', 'bash', 'web', 'task'] as const
const VALID_MODES = new Set(['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom'])
const VALID_PERMS = new Set<Permission>(['allow', 'ask', 'deny'])

function mapPermissions(raw: unknown): AgentProfile['permissions'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, Permission> = {}
  for (const k of PERM_KEYS) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'string' && VALID_PERMS.has(v as Permission)) out[k] = v as Permission
  }
  return Object.keys(out).length ? out : undefined
}

function normMode(raw: unknown): AgentProfile['mode'] {
  return typeof raw === 'string' && VALID_MODES.has(raw) ? (raw as AgentProfile['mode']) : 'custom'
}

export class OpenCodeConfigAdapter implements AgentConfigAdapter {
  readonly provider = 'opencode' as const

  async discoverProfiles(opts: { projectPath?: string }): Promise<AgentProfile[]> {
    const projectPath = opts.projectPath
    if (!projectPath) return []
    const ocDir = join(projectPath, '.opencode')
    if (!existsSync(ocDir)) return []
    const profiles: AgentProfile[] = []
    profiles.push(...this.readJsonAgents(ocDir))
    profiles.push(...this.readMarkdownAgents(ocDir))
    return profiles
  }

  private readJsonAgents(ocDir: string): AgentProfile[] {
    for (const file of ['opencode.jsonc', 'opencode.json']) {
      const path = join(ocDir, file)
      if (!existsSync(path)) continue
      let parsed: any
      try { parsed = parseJsonc(readFileSync(path, 'utf8')) } catch { return [] }
      const agents = parsed?.agent
      if (!agents || typeof agents !== 'object') return []
      return Object.entries(agents).map(([name, cfg]: [string, any]) =>
        AgentProfileSchema.parse({
          id: `opencode:json:${name}`, provider: 'opencode', name, scope: 'project',
          mode: normMode(cfg?.mode),
          model: typeof cfg?.model === 'string' ? cfg.model : undefined,
          description: typeof cfg?.description === 'string' ? cfg.description : undefined,
          permissions: mapPermissions(cfg?.permission),
          tools: Array.isArray(cfg?.tools) ? cfg.tools.filter((t: unknown) => typeof t === 'string')
            : (cfg?.tools && typeof cfg.tools === 'object' ? Object.keys(cfg.tools) : undefined),
          temperature: typeof cfg?.temperature === 'number' ? cfg.temperature : undefined,
          prompt: typeof cfg?.prompt === 'string' ? { inline: cfg.prompt } : undefined,
          rawConfigPath: path, rawFormat: 'json',
        }),
      )
    }
    return []
  }

  private readMarkdownAgents(ocDir: string): AgentProfile[] {
    const out: AgentProfile[] = []
    for (const sub of ['agent', 'agents']) {
      const dir = join(ocDir, sub)
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue
        const path = join(dir, f)
        const parsed = matter(readFileSync(path, 'utf8'))
        const fm = parsed.data as Record<string, unknown>
        const name = basename(f, '.md')
        out.push(AgentProfileSchema.parse({
          id: `opencode:md:${name}`, provider: 'opencode', name, scope: 'project',
          mode: normMode(fm.mode),
          model: typeof fm.model === 'string' ? fm.model : undefined,
          description: typeof fm.description === 'string' ? fm.description : undefined,
          permissions: mapPermissions(fm.permission),
          tools: Array.isArray(fm.tools) ? (fm.tools as unknown[]).filter((t) => typeof t === 'string') as string[] : undefined,
          temperature: typeof fm.temperature === 'number' ? fm.temperature : undefined,
          prompt: parsed.content.trim() ? { inline: parsed.content.trim() } : undefined,
          rawConfigPath: path, rawFormat: 'markdown',
        }))
      }
    }
    return out
  }
}
```

> Note: the adapter only ever reads `opencode.json(c)` and `agent(s)/*.md`. It never enumerates or opens `auth.json` or other files, so credentials cannot leak (the test asserts this).

- [ ] **Step 4: Run → PASS (4).** Add export.
- [ ] **Step 5: Commit** — `feat(harness): OpenCodeConfigAdapter (read-only json + markdown agent profiles)`

---

### Task 4: `migrateHarness` + `TaskProfileStore` (persist PM's selection)

**Files:** Create `src/migrate.ts`, `src/task-profile-store.ts`; test `task-profile-store.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateHarness } from './migrate.js'
import { TaskProfileStore } from './task-profile-store.js'

describe('TaskProfileStore', () => {
  let db: Db; let store: TaskProfileStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migrateHarness(db); store = new TaskProfileStore(db) })

  test('select then get returns the chosen profile id', () => {
    store.select('TASK-001', 'opencode:json:build')
    expect(store.get('TASK-001')).toBe('opencode:json:build')
  })
  test('selecting again overwrites the choice', () => {
    store.select('TASK-001', 'a'); store.select('TASK-001', 'b')
    expect(store.get('TASK-001')).toBe('b')
  })
  test('get returns undefined when nothing selected', () => {
    expect(store.get('TASK-999')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`src/migrate.ts`:
```ts
import type { Db } from '@apc/core'

export function migrateHarness(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_profile (
      task_id    TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL
    );
  `)
}
```

`src/task-profile-store.ts`:
```ts
import type { Db } from '@apc/core'

export class TaskProfileStore {
  constructor(private readonly db: Db) {}

  select(taskId: string, profileId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO task_profile (task_id, profile_id) VALUES (?, ?)').run(taskId, profileId)
  }

  get(taskId: string): string | undefined {
    const row = this.db.prepare('SELECT profile_id FROM task_profile WHERE task_id = ?').get(taskId) as
      { profile_id: string } | undefined
    return row?.profile_id
  }
}
```

- [ ] **Step 4: Run → PASS (3). Run full suite `pnpm test`.**
- [ ] **Step 5: Commit** — `feat(harness): migrateHarness + TaskProfileStore (per-task profile selection)`

---

## Definition of Done (Plan 5)

- [ ] `pnpm test` green incl. `@apc/harness`.
- [ ] `OpenCodeConfigAdapter` reads both the JSON `agent` map and markdown agent files into validated read-only `AgentProfile`s, mapping model/mode/description/permissions/prompt.
- [ ] Adapter never reads `auth.json`; a test proves no credential content reaches a profile.
- [ ] Missing config returns `[]` (never throws).
- [ ] `TaskProfileStore` persists and overwrites the PM's per-task profile selection.

## Deferred (P1+, per spec §9.5)

- Editing via "Create Change Proposal" + diff + backup + conflict-safe write (reuse `ConflictManager`).
- Claude (`.claude/settings.json` + `.claude/agents`) and Codex (`AGENTS.md`/config) read adapters.
- `oh-my-openagent.json` plugin-layer agent/category mapping (secondary OpenCode source observed on this machine).
- `TeamProfile` / cross-agent teams / team-aware context packages.
- The Harness panel UI + wiring the selected profile into the agent launch command — **Plan 6**.
