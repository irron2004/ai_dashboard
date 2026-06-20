# Paper Domain — Plan 1: Domain Plumbing + DomainPack Scaffold

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a per-project `domain` ('project-docs' | 'paper') end-to-end (schema → DB → registry → IPC → renderer UI) and route it into the harness via a `DomainPack` selector, with **zero behavior change** for existing project-docs projects.

**Architecture:** A new `domain` field on `Project` flows from the ProjectSidebar form through IPC/registry into SQLite (idempotent column migration). The knowledge-harness gains a `DomainPack` interface and a `domainPackFor(domain)` selector; the `project-docs` pack is a thin marker that preserves current behavior, and a `paper` pack is registered as the extension point that later plans fill in. `HarnessService.run` carries the project's domain into `DriverDeps` but `make-drivers` consumption is deferred to Plan 2.

**Tech Stack:** TypeScript (pnpm monorepo), Zod, `node:sqlite` (DatabaseSync), React (renderer), Vitest.

## Global Constraints

- Node `node:sqlite` (`DatabaseSync`) is the DB driver — no other SQL lib. Migrations run via `db.exec(...)` and must be idempotent (re-running `migrate` on an existing DB must not throw).
- `Project.domain` default = `'project-docs'`; existing rows without the column resolve to that default.
- Tests run from the repo root: `pnpm exec vitest run <path>` (NOT `pnpm --filter <pkg> test`).
- Desktop tests run via the desktop config: `pnpm --filter @apc/desktop exec vitest run src/...`.
- Typecheck authority: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json` and `node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit`.
- No behavior change for project-docs: a project-docs harness run must be byte-identical to today.

---

## File Structure

- `packages/shared/src/schema.ts` — add `domain` to `ProjectSchema`.
- `packages/core/src/db.ts` — idempotent `domain` column migration.
- `packages/core/src/project-registry.ts` — read/write `domain`.
- `apps/desktop/src/shared/ipc-contract.ts` — `domain` on register/update req types.
- `apps/desktop/src/main/ipc.ts` — pass `domain` through register/update handlers.
- `apps/desktop/src/renderer/api.ts`, `store.ts`, `App.tsx` — thread `domain` param.
- `apps/desktop/src/renderer/components/ProjectSidebar.tsx` — domain `<select>` + thread through submit.
- `packages/knowledge-harness/src/domains/{types.ts,project-docs-pack.ts,paper-pack.ts,index.ts}` — `DomainPack` + selector (create).
- `packages/app-services/src/harness-service.ts` — carry `domain` into the run (no make-drivers consumption yet).

---

### Task 1: `domain` field on the Project schema

**Files:**
- Modify: `packages/shared/src/schema.ts:8-23`
- Test: `packages/shared/src/schema.domain.test.ts`

**Interfaces:**
- Produces: `ProjectDomain` (Zod enum `['project-docs','paper']`); `ProjectSchema` gains `domain: ProjectDomain` defaulting to `'project-docs'`; `Project['domain']` type.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/schema.domain.test.ts
import { describe, expect, test } from 'vitest'
import { ProjectSchema } from './schema.js'

describe('ProjectSchema.domain', () => {
  test('defaults to project-docs when omitted', () => {
    const p = ProjectSchema.parse({ id: 'a', name: 'A', status: 'active', projectType: 'git' })
    expect(p.domain).toBe('project-docs')
  })
  test('accepts paper', () => {
    const p = ProjectSchema.parse({ id: 'a', name: 'A', status: 'active', projectType: 'git', domain: 'paper' })
    expect(p.domain).toBe('paper')
  })
  test('rejects an unknown domain', () => {
    expect(() => ProjectSchema.parse({ id: 'a', name: 'A', status: 'active', projectType: 'git', domain: 'nope' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/schema.domain.test.ts`
Expected: FAIL — `p.domain` is `undefined` (field not yet on schema).

- [ ] **Step 3: Add the field**

In `packages/shared/src/schema.ts`, after line 9 (`ProjectStatus`):
```ts
export const ProjectDomain = z.enum(['project-docs', 'paper'])
```
In `ProjectSchema` (after the `projectType` line), add:
```ts
  domain: ProjectDomain.default('project-docs'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/schema.domain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schema.ts packages/shared/src/schema.domain.test.ts
git commit -m "feat(shared): add Project.domain ('project-docs'|'paper', default project-docs)"
```

---

### Task 2: Persist `domain` in SQLite (idempotent migration + registry)

**Files:**
- Modify: `packages/core/src/db.ts:12-42`
- Modify: `packages/core/src/project-registry.ts:4-16` (Row), `:18-32` (rowToProject), `:37-60` (register)
- Test: `packages/core/src/project-registry.domain.test.ts`

**Interfaces:**
- Consumes: `Project['domain']` (Task 1).
- Produces: `migrate(db)` adds a `domain TEXT NOT NULL DEFAULT 'project-docs'` column when missing; `ProjectRegistry.register`/`get`/`list` round-trip `domain`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/project-registry.domain.test.ts
import { describe, expect, test, beforeEach } from 'vitest'
import { openDb, migrate } from './db.js'
import { ProjectRegistry } from './project-registry.js'

const base = { status: 'active' as const, projectType: 'git' as const, repoPaths: [], vaultPaths: [], sourcePaths: [] }

describe('ProjectRegistry domain', () => {
  let reg: ProjectRegistry
  beforeEach(() => { const db = openDb(':memory:'); migrate(db); reg = new ProjectRegistry(db) })

  test('round-trips paper domain', () => {
    reg.register({ ...base, id: 'p', name: 'P', domain: 'paper' })
    expect(reg.get('p')!.domain).toBe('paper')
  })
  test('defaults to project-docs', () => {
    reg.register({ ...base, id: 'q', name: 'Q' })
    expect(reg.get('q')!.domain).toBe('project-docs')
  })
  test('migrate is idempotent (second call does not throw)', () => {
    const db = openDb(':memory:'); migrate(db); expect(() => migrate(db)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/project-registry.domain.test.ts`
Expected: FAIL — `domain` not selected/inserted (get returns default only because schema defaults; the `paper` round-trip fails because register does not write the column).

- [ ] **Step 3: Add the migration**

In `packages/core/src/db.ts`, inside `migrate`, AFTER the `db.exec(\`CREATE TABLE ...\`)` block, append:
```ts
  // Idempotent column add: node:sqlite has no "ADD COLUMN IF NOT EXISTS", so probe first.
  const cols = db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'domain')) {
    db.exec(`ALTER TABLE projects ADD COLUMN domain TEXT NOT NULL DEFAULT 'project-docs'`)
  }
```

- [ ] **Step 4: Thread domain through the registry**

In `packages/core/src/project-registry.ts`:
- Add to `Row` (after `project_type`): `domain: string`
- In `rowToProject`, add to the parsed object: `domain: row.domain ?? undefined,`
- In `register`, add `domain` to BOTH the column list and VALUES and the `.run({...})` params:
  - column list: `... project_type, domain, repo_paths, ...`
  - values: `... :projectType, :domain, :repoPaths, ...`
  - run param: `domain: p.domain,`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/project-registry.domain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the existing core suite (no regression)**

Run: `pnpm exec vitest run packages/core/src/project-registry.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/db.ts packages/core/src/project-registry.ts packages/core/src/project-registry.domain.test.ts
git commit -m "feat(core): persist Project.domain (idempotent column migration + registry round-trip)"
```

---

### Task 3: IPC contract + handlers carry `domain`

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts:62-63`
- Modify: `apps/desktop/src/main/ipc.ts:26-52`
- Test: `apps/desktop/src/main/ipc.domain.test.ts`

**Interfaces:**
- Consumes: `Project['domain']` (Task 1), `ProjectRegistry` (Task 2).
- Produces: `RegisterProjectReq`/`UpdateProjectReq` gain `domain?: string`; the register/update handlers persist it (defaulting to `'project-docs'`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/ipc.domain.test.ts
import { describe, expect, test } from 'vitest'
import { openDb, migrate, ProjectRegistry } from '@apc/core'
import { handlers } from './ipc.js'
import { CHANNELS as CH } from '../shared/ipc-contract.js'
import { makeTestContainer } from './ipc.test-helpers.js' // existing helper used by ipc.test.ts

describe('registerProject domain', () => {
  test('persists the chosen domain', async () => {
    const c = makeTestContainer()
    const h = handlers(c)
    const created = await h[CH.registerProject]({ name: 'Papers', projectType: 'git', repoPath: 'ssh://u@h:22/p', domain: 'paper' })
    expect((created as { domain: string }).domain).toBe('paper')
  })
  test('defaults to project-docs when omitted', async () => {
    const c = makeTestContainer()
    const h = handlers(c)
    const created = await h[CH.registerProject]({ name: 'Local', projectType: 'git', repoPath: '/tmp/x' })
    expect((created as { domain: string }).domain).toBe('project-docs')
  })
})
```

> NOTE: if `ipc.test.ts` builds its container inline rather than via a helper, replicate that inline setup here instead of importing `makeTestContainer`; do not add a production export just for tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/main/ipc.domain.test.ts`
Expected: FAIL — handler ignores `domain`, so the `paper` case returns `project-docs`.

- [ ] **Step 3: Extend the request types**

In `apps/desktop/src/shared/ipc-contract.ts`:
```ts
export type RegisterProjectReq = { name: string; projectType: string; repoPath: string; domain?: string }
export type UpdateProjectReq = { id: string; name: string; projectType: string; repoPath: string; domain?: string }
```

- [ ] **Step 4: Persist domain in the handlers**

In `apps/desktop/src/main/ipc.ts`:
- `registerProject` handler: add to the `register({...})` object: `domain: (req.domain ?? 'project-docs') as 'project-docs' | 'paper',`
- `updateProject` handler: add to the `update({...})` object: `domain: (req.domain ?? existing.domain) as 'project-docs' | 'paper',`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/main/ipc.domain.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the existing ipc suite (no regression)**

Run: `pnpm --filter @apc/desktop exec vitest run src/main/ipc.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/ipc.domain.test.ts
git commit -m "feat(desktop): carry Project.domain through register/update IPC"
```

---

### Task 4: Renderer — domain selector in the project dialog

**Files:**
- Modify: `apps/desktop/src/renderer/api.ts:56-58`
- Modify: `apps/desktop/src/renderer/store.ts:76` (interface), `:209-212` (addProject)
- Modify: `apps/desktop/src/renderer/App.tsx:30,215` (thread the new param)
- Modify: `apps/desktop/src/renderer/components/ProjectSidebar.tsx:38-113,280-298`
- Test: `apps/desktop/src/renderer/components/ProjectSidebar.domain.test.tsx`

**Interfaces:**
- Consumes: `RegisterProjectReq.domain` (Task 3).
- Produces: `api.registerProject` forwards `domain`; `store.addProject(name, projectType, repoPath, domain)` and `updateProject(id, name, projectType, repoPath, domain)` gain a `domain` arg; ProjectSidebar renders a domain `<select>` and passes its value.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/desktop/src/renderer/components/ProjectSidebar.domain.test.tsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectSidebar } from './ProjectSidebar.js'

describe('ProjectSidebar domain', () => {
  test('passes the chosen domain to onAdd', () => {
    const onAdd = vi.fn()
    render(<ProjectSidebar projects={[]} selectedId={null} onSelect={() => {}} onAdd={onAdd} onUpdate={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByText('+ Add Project'))           // open dialog (match existing trigger label)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Papers' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'paper' } })
    fireEvent.change(screen.getByLabelText('Repo Path'), { target: { value: '/tmp/p' } })
    fireEvent.click(screen.getByText('Save'))
    expect(onAdd).toHaveBeenCalledWith('Papers', 'git', '/tmp/p', 'paper')
  })
})
```

> NOTE: match the EXACT trigger/label/button text already in `ProjectSidebar.tsx` (open-dialog button, the name input's accessible label, the submit button). If labels are not wired for accessibility, add `aria-label`/`<label htmlFor>` as part of Step 3 so the test can query them.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/ProjectSidebar.domain.test.tsx`
Expected: FAIL — no Domain control; `onAdd` called with 3 args, not 4.

- [ ] **Step 3: Add the domain control + thread it**

In `ProjectSidebar.tsx`:
- Add state near the other form state (after line 38): `const [domain, setDomain] = useState<'project-docs' | 'paper'>('project-docs')`
- In `resetForm` add: `setDomain('project-docs')`
- In `openEdit`, after `setProjectType(p.projectType)`: `setDomain(p.domain)`
- In `handleSubmit`, change the calls:
  - `if (editingId) onUpdate(editingId, name.trim(), projectType, finalPath, domain)`
  - `else onAdd(name.trim(), projectType, finalPath, domain)`
- In the dialog JSX (near the project-type field), add:
```tsx
<label htmlFor="domain-select">Domain</label>
<select id="domain-select" aria-label="Domain" value={domain} onChange={(e) => setDomain(e.target.value as 'project-docs' | 'paper')}>
  <option value="project-docs">Project docs</option>
  <option value="paper">Paper (autosci)</option>
</select>
```
- Update the component's prop types: `onAdd: (name: string, projectType: string, repoPath: string, domain: string) => void` and the same extra `domain: string` arg on `onUpdate`.

- [ ] **Step 4: Thread through api/store/App**

- `apps/desktop/src/renderer/api.ts` `registerProject`: ensure it forwards the full req object (it already passes `req` through; no change if `RegisterProjectReq` now has `domain`). Confirm the `updateProject` call likewise forwards `domain`.
- `apps/desktop/src/renderer/store.ts`:
  - interface (line 76): `addProject(name: string, projectType: string, repoPath: string, domain: string): Promise<void>`
  - impl (line 209): `async addProject(name: string, projectType: string, repoPath: string, domain: string) {` and `await api.registerProject({ name, projectType, repoPath, domain })`
  - mirror the same change for `updateProject` (add `domain` param + pass to `api.updateProject`).
- `apps/desktop/src/renderer/App.tsx`: the `onAdd={addProject}` / update wiring already forwards args positionally; no change beyond the store signature.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/ProjectSidebar.domain.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck the desktop app**

Run: `node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit`
Expected: 0 errors (all `onAdd`/`onUpdate`/`addProject` call sites updated).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/api.ts apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/ProjectSidebar.tsx apps/desktop/src/renderer/components/ProjectSidebar.domain.test.tsx
git commit -m "feat(desktop): domain selector in the project dialog, threaded to registerProject"
```

---

### Task 5: `DomainPack` interface + `domainPackFor` selector + project-docs pack

**Files:**
- Create: `packages/knowledge-harness/src/domains/types.ts`
- Create: `packages/knowledge-harness/src/domains/project-docs-pack.ts`
- Create: `packages/knowledge-harness/src/domains/paper-pack.ts`
- Create: `packages/knowledge-harness/src/domains/index.ts`
- Test: `packages/knowledge-harness/src/domains/index.test.ts`

**Interfaces:**
- Consumes: `Project['domain']` (Task 1).
- Produces:
  - `type DomainId = 'project-docs' | 'paper'`
  - `interface DomainPack { id: DomainId; contractDir?: string }` (minimal in Plan 1; Plans 2–3 add `nodeSchema`/`buildExtractorPrompt`/`renderNode`/`validate`).
  - `projectDocsPack: DomainPack`, `paperPack: DomainPack`
  - `domainPackFor(domain: DomainId): DomainPack`

- [ ] **Step 1: Write the failing test**

```ts
// packages/knowledge-harness/src/domains/index.test.ts
import { describe, expect, test } from 'vitest'
import { domainPackFor } from './index.js'

describe('domainPackFor', () => {
  test('returns the project-docs pack with no contract dir', () => {
    const p = domainPackFor('project-docs')
    expect(p.id).toBe('project-docs')
    expect(p.contractDir).toBeUndefined()
  })
  test('returns the paper pack pointing at the paper contract', () => {
    const p = domainPackFor('paper')
    expect(p.id).toBe('paper')
    expect(p.contractDir).toMatch(/wiki-domains[\\/]paper[\\/]runtime$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/index.test.ts`
Expected: FAIL — module `./index.js` does not exist.

- [ ] **Step 3: Create the pack files**

```ts
// packages/knowledge-harness/src/domains/types.ts
export type DomainId = 'project-docs' | 'paper'

/** Overlay seam: a domain parameterizes the harness. Plan 1 carries only identity + contract location;
 *  Plans 2–3 extend this with nodeSchema / buildExtractorPrompt / renderNode / validate. */
export interface DomainPack {
  id: DomainId
  /** Absolute path to the autosci contract dir (wiki-domains/<id>/runtime), or undefined for code-driven domains. */
  contractDir?: string
}
```

```ts
// packages/knowledge-harness/src/domains/project-docs-pack.ts
import type { DomainPack } from './types.js'

/** The existing project-docs pipeline. Plan 1: marker only — behavior stays in make-drivers unchanged. */
export const projectDocsPack: DomainPack = { id: 'project-docs' }
```

```ts
// packages/knowledge-harness/src/domains/paper-pack.ts
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { DomainPack } from './types.js'

// repo-root/wiki-domains/paper/runtime, resolved relative to this file
// (packages/knowledge-harness/src/domains/ -> up 4 to repo root).
const here = dirname(fileURLToPath(import.meta.url))
const contractDir = join(here, '..', '..', '..', '..', 'wiki-domains', 'paper', 'runtime')

export const paperPack: DomainPack = { id: 'paper', contractDir }
```

```ts
// packages/knowledge-harness/src/domains/index.ts
import type { DomainId, DomainPack } from './types.js'
import { projectDocsPack } from './project-docs-pack.js'
import { paperPack } from './paper-pack.js'

export type { DomainId, DomainPack } from './types.js'
export { projectDocsPack, paperPack }

export function domainPackFor(domain: DomainId): DomainPack {
  return domain === 'paper' ? paperPack : projectDocsPack
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/index.test.ts`
Expected: PASS (2 tests).

> If the `contractDir` regex fails because the resolved path differs, fix the `join(...)` depth in `paper-pack.ts` to land on repo-root `wiki-domains/paper/runtime` (verify with a temporary `console.log(contractDir)`), then re-run.

- [ ] **Step 5: Export from the package entry**

Add to `packages/knowledge-harness/src/index.ts` (the package's public barrel — match the existing export style there):
```ts
export { domainPackFor, projectDocsPack, paperPack, type DomainPack, type DomainId } from './domains/index.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/domains packages/knowledge-harness/src/index.ts
git commit -m "feat(knowledge-harness): DomainPack interface + domainPackFor selector (project-docs/paper)"
```

---

### Task 6: Carry `domain` into the harness run (no behavior change)

**Files:**
- Modify: `packages/app-services/src/harness-service.ts:189` (run signature), `:271-279` consumer in `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/main/container.ts:271-279` (`harnessRun`)
- Test: `packages/app-services/src/harness-service.domain.test.ts`

**Interfaces:**
- Consumes: `domainPackFor` (Task 5), `Project['domain']` (Task 1).
- Produces: `HarnessService.run` accepts `domain?: DomainId` on its input and resolves `domainPackFor(domain ?? 'project-docs')`, exposing the resolved pack id on the run result/log (so a test can assert routing) WITHOUT changing driver selection yet.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-services/src/harness-service.domain.test.ts
import { describe, expect, test } from 'vitest'
import { resolveDomainPack } from './harness-service.js'

describe('resolveDomainPack', () => {
  test('paper project resolves the paper pack', () => {
    expect(resolveDomainPack('paper').id).toBe('paper')
  })
  test('undefined domain resolves project-docs', () => {
    expect(resolveDomainPack(undefined).id).toBe('project-docs')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/app-services/src/harness-service.domain.test.ts`
Expected: FAIL — `resolveDomainPack` is not exported.

- [ ] **Step 3: Add the resolver and carry it into run input**

In `packages/app-services/src/harness-service.ts`:
- Add import: `import { domainPackFor, type DomainId, type DomainPack } from '@apc/knowledge-harness'`
- Add exported helper:
```ts
/** Resolve the domain pack for a run; missing domain = the legacy project-docs pack. */
export function resolveDomainPack(domain: DomainId | undefined): DomainPack {
  return domainPackFor(domain ?? 'project-docs')
}
```
- Extend the `run` input type (line 189) with `domain?: DomainId` and, at the top of `run`, compute `const pack = resolveDomainPack(input.domain)` and `log(\`domain: ${pack.id}\n\`)`. Do NOT pass `pack` into `runnerFor`/`makeDrivers` yet (Plan 2 wires consumption).

- [ ] **Step 4: Pass domain from the container**

In `apps/desktop/src/main/container.ts` `harnessRun` (line ~273), add `domain: project?.domain` to the `harness.run({...})` input object.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/app-services/src/harness-service.domain.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Full regression — project-docs unchanged**

Run: `pnpm exec vitest run packages/app-services packages/knowledge-harness`
Then: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: all PASS, 0 type errors. (A project-docs run still selects today's drivers — `pack` is computed and logged but unused in selection.)

- [ ] **Step 7: Commit**

```bash
git add packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.domain.test.ts apps/desktop/src/main/container.ts
git commit -m "feat(app-services): carry project domain into HarnessService.run (routing scaffold, no behavior change)"
```

---

## Self-Review

**Spec coverage (§4.2 domain routing):** Task 1 (schema) → Task 2 (DB/registry) → Task 3 (IPC) → Task 4 (UI) → Task 5 (`DomainPack`/selector) → Task 6 (carry into run) cover the routing/plumbing slice of the spec. The spec's §4.1 `DomainPack` is introduced here at minimal shape (id + contractDir); §3/§4.3/§4.4 (paper render, ingest, extraction, lint gate, typed proposals) are explicitly DEFERRED to Plans 2–4 below — not gaps.

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. Two NOTE callouts (Task 3 test container, Task 4 label text) instruct matching existing code exactly rather than guessing — acceptable, since the surrounding test files exist and define the pattern.

**Type consistency:** `domain: 'project-docs' | 'paper'` and `DomainId` used consistently; `addProject`/`updateProject`/`onAdd`/`onUpdate` all gain the same trailing `domain: string` arg; `resolveDomainPack(domain: DomainId | undefined)` matches `domainPackFor(domain: DomainId)`.

---

## Follow-on plans (separate specs/plans, after Plan 1 lands)

- **Plan 2 — Paper render + kernel-lint gate (deterministic, no LLM):** extend `DomainPack` with `renderNode` + `validate`; render typed golden nodes → autosci vault (`wiki/<type>/<slug>.md` + `edges.jsonl`) + UI frontmatter; wire `make-drivers` `STAGING_WRITTEN`/`VALIDATED` to the pack; negative test proves kernel lint FAILS the run with report preserved (venv-gated). Reuses #1 `WikiSubstrate`.
- **Plan 3 — Paper ingest + LLM extraction:** `WikiSubstrate` ingest (autosci-read) of `raw/`; paper extractor prompt+`nodeSchema` producing typed proposals; typed-edge merge; PolicyGuard domain-awareness; generalize generic→typed NodeProposal.
- **Plan 4 — End-to-end wiring + e2e:** route papers→paper drivers through the live run; interactive confirm + promote on the paper path; e2e (papers-like fixture → HUMAN_REVIEW + index/graph), negative, project-docs regression, UI graph smoke.

---

## Execution Handoff

(see skill — offered after save)
