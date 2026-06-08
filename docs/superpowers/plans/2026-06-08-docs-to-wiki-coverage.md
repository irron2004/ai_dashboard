# Docs → Wiki One-Click + Coverage Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "generate wiki from all project docs" flow that first materializes every project document into the harness source area, then surfaces a coverage matrix (which source docs were reflected into wiki nodes, which were omitted) so the user can verify completeness.

**Architecture:** Approach A — a trusted `SourceMaterializer` copies project docs into `vault/raw/project-docs/`; the existing 9-state Knowledge Harness pipeline runs unchanged except it now also emits a `coverage-report` artifact (built from the run's source list × node-proposal evidence citations); a new `CoverageMatrix` UI tab renders it. No new IPC channel, no DB migration — only a `materialize?` flag on `HarnessRunReq` and one new artifact.

**Tech Stack:** TypeScript, Zod (`@apc/shared`), Node fs, React, Zustand, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-08-docs-to-wiki-coverage-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/kh-schema.ts` | Modify | Add `KhCoverageReportSchema` + type |
| `packages/knowledge-harness/src/eval/coverage-report.ts` | Create | Pure `buildCoverageReport(sourcePaths, proposals)` |
| `packages/knowledge-harness/src/eval/coverage-report.test.ts` | Create | Builder unit tests |
| `packages/knowledge-harness/src/runtime/make-drivers.ts` | Modify | `ARTIFACTS.coverageReport` + emit in `HUMAN_REVIEW_REQUIRED` |
| `packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts` | Modify | Assert the coverage artifact is produced |
| `packages/app-services/src/source-materializer.ts` | Create | `materializeProjectDocs(repoPaths, vaultRoot)` |
| `packages/app-services/src/source-materializer.test.ts` | Create | Materializer unit tests |
| `packages/app-services/src/index.ts` | Modify | Export the materializer |
| `packages/app-services/src/harness-service.ts` | Modify | `run()` accepts `materialize?`/`repoPaths?`, calls materializer |
| `apps/desktop/src/shared/ipc-contract.ts:82` | Modify | `HarnessRunReq` gains `materialize?: boolean` |
| `apps/desktop/src/main/container.ts:188` | Modify | `harnessRun` resolves repoPaths from registry |
| `apps/desktop/src/renderer/store.ts` | Modify | `startHarnessRun(materialize?)` |
| `apps/desktop/src/renderer/components/CoverageMatrix.tsx` | Create | Pure coverage matrix component |
| `apps/desktop/src/renderer/components/CoverageMatrix.test.tsx` | Create | Component tests |
| `apps/desktop/src/renderer/components/HarnessDashboard.tsx` | Modify | Coverage tab + "전 문서로 위키 생성" button |
| `apps/desktop/src/renderer/app.css` | Modify | `.coverage*` styles |

**Verification commands:**
- knowledge-harness tests: `npx vitest run packages/knowledge-harness`
- app-services tests: `npx vitest run packages/app-services`
- desktop tests: `cd apps/desktop && npx vitest run`
- typecheck: `pnpm typecheck`

> NodeNext note: every relative import uses a `.js` extension even for `.ts`/`.tsx` files.

---

## Task 1: Coverage schema + pure builder

**Files:**
- Modify: `packages/shared/src/kh-schema.ts` (append near the other report schemas, e.g. after `KhEvalReportSchema`)
- Create: `packages/knowledge-harness/src/eval/coverage-report.ts`
- Create: `packages/knowledge-harness/src/eval/coverage-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/knowledge-harness/src/eval/coverage-report.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { KhNodeProposal } from '@apc/shared'
import { buildCoverageReport } from './coverage-report.js'

const proposal = (id: string, title: string, sourcePaths: string[]): KhNodeProposal => ({
  proposal_id: `prop-${id}`, proposal_type: 'create_or_update_node', proposed_by: 'extractor',
  source_type: 'agent_session', created_at: '2026-06-08T00:00:00Z',
  node: { id, type: 'ConceptNode', scope: 'project', title, summary: '', project_ids: [], tags: [] },
  claims: [],
  evidence: sourcePaths.map((sp, i) => ({
    evidence_id: `${id}-e${i}`, source_id: sp, source_path: sp, evidence_type: 'quote',
    quote_or_summary: '', confidence: 'medium',
  })),
  claim_policy: { minimum_evidence_count: 1, requires_direct_source: true, allow_inference: true, inference_note_required: true },
  actions: [], risk: { level: 'low', reason: '' }, review: { requires_human_review: true, reviewer_question: '' },
})

describe('buildCoverageReport', () => {
  test('marks a source covered when a node cites it, unmapped otherwise', () => {
    const sources = ['raw/project-docs/0/PRD.md', 'raw/project-docs/0/notes.md', 'raw/project-docs/0/adr.md']
    const proposals = [
      proposal('n1', 'Architecture', ['raw/project-docs/0/PRD.md']),
      proposal('n2', 'Decisions', ['raw/project-docs/0/adr.md']),
    ]
    const rep = buildCoverageReport(sources, proposals)
    expect(rep.totals).toEqual({ sourcesTotal: 3, covered: 2, unmapped: 1 })
    expect(rep.sources.find((s) => s.path.endsWith('notes.md'))!.status).toBe('unmapped')
    expect(rep.sources.find((s) => s.path.endsWith('PRD.md'))!.citedBy).toEqual(['n1'])
  })

  test('a source cited by multiple nodes lists all of them', () => {
    const rep = buildCoverageReport(['raw/s.md'], [proposal('n1', 'A', ['raw/s.md']), proposal('n2', 'B', ['raw/s.md'])])
    expect(rep.sources[0].citedBy.sort()).toEqual(['n1', 'n2'])
    expect(rep.totals.covered).toBe(1)
  })
})
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npx vitest run packages/knowledge-harness/src/eval/coverage-report.test.ts`
Expected: FAIL — `Cannot find module './coverage-report.js'` (and `buildCoverageReport` / `KhCoverageReport` undefined).

- [ ] **Step 3: Add the schema**

In `packages/shared/src/kh-schema.ts`, add (place it alongside the other `Kh*ReportSchema` exports):

```ts
export const KhCoverageReportSchema = z.object({
  sources: z.array(z.object({
    path: z.string(),
    status: z.enum(['covered', 'unmapped']),
    citedBy: z.array(z.string()).default([]),   // node ids that cite this source
  })).default([]),
  nodes: z.array(z.object({
    id: z.string(),
    title: z.string(),
    cites: z.array(z.string()).default([]),     // source paths this node cites
  })).default([]),
  totals: z.object({
    sourcesTotal: z.number().int().default(0),
    covered: z.number().int().default(0),
    unmapped: z.number().int().default(0),
  }),
})
export type KhCoverageReport = z.infer<typeof KhCoverageReportSchema>
```

Confirm `@apc/shared` re-exports it. If `packages/shared/src/kh-schema.ts` symbols are surfaced via an index/barrel (`packages/shared/src/index.ts`), no change is usually needed because the file is already exported; verify `KhCoverageReport` is importable from `@apc/shared` after Step 4 typecheck.

- [ ] **Step 4: Write the builder**

Create `packages/knowledge-harness/src/eval/coverage-report.ts`:

```ts
import { KhCoverageReportSchema, type KhCoverageReport, type KhNodeProposal } from '@apc/shared'

/**
 * Coverage = which raw source documents were reflected into wiki nodes. A source is `covered` iff at least
 * one node proposal cites it (via evidence.source_path); otherwise it is `unmapped` (omitted from the wiki).
 * Pure: takes the run's source path list and its node proposals. No filesystem, no LLM.
 */
export function buildCoverageReport(sourcePaths: string[], proposals: KhNodeProposal[]): KhCoverageReport {
  const nodes = proposals.map((p) => ({
    id: p.node.id,
    title: p.node.title,
    cites: Array.from(new Set(p.evidence.map((e) => e.source_path))),
  }))
  const citedBy = new Map<string, string[]>()
  for (const n of nodes) {
    for (const src of n.cites) {
      const arr = citedBy.get(src) ?? []
      arr.push(n.id)
      citedBy.set(src, arr)
    }
  }
  const sources = sourcePaths.map((path) => {
    const ids = citedBy.get(path) ?? []
    return { path, status: ids.length > 0 ? ('covered' as const) : ('unmapped' as const), citedBy: ids }
  })
  const covered = sources.filter((s) => s.status === 'covered').length
  return KhCoverageReportSchema.parse({
    sources,
    nodes,
    totals: { sourcesTotal: sources.length, covered, unmapped: sources.length - covered },
  })
}
```

- [ ] **Step 5: Run the test + typecheck, confirm PASS**

Run: `npx vitest run packages/knowledge-harness/src/eval/coverage-report.test.ts && pnpm typecheck`
Expected: PASS (2 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/kh-schema.ts packages/knowledge-harness/src/eval/coverage-report.ts packages/knowledge-harness/src/eval/coverage-report.test.ts
git commit -m "feat(knowledge-harness): coverage-report schema + pure builder (source→node)"
```

---

## Task 2: Emit `coverage-report` artifact in the pipeline

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (the `ARTIFACTS` object at line ~39, and the `HUMAN_REVIEW_REQUIRED` driver)
- Modify: `packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts`

- [ ] **Step 1: Write the failing test (assert the artifact is produced)**

Open `packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts`. It already drives a full run with fake agents and inspects the finished run's artifacts. Locate the point where the run has reached `HUMAN_REVIEW_REQUIRED` and the artifacts are available (a `show()` result or the run state's artifacts). Add this assertion there (adapt the artifacts accessor name to the one already used in that test):

```ts
    // coverage-report artifact is emitted at HUMAN_REVIEW_REQUIRED
    const coverageArtifact = artifacts.find((a) => a.name === 'coverage-report')
    expect(coverageArtifact).toBeDefined()
    const coverage = coverageArtifact!.data as { totals: { sourcesTotal: number; covered: number; unmapped: number } }
    expect(typeof coverage.totals.sourcesTotal).toBe('number')
    expect(coverage.totals.covered + coverage.totals.unmapped).toBe(coverage.totals.sourcesTotal)
```

If the test exposes artifacts as a nested `Record<state, Artifact[]>` rather than a flat array, flatten first: `const artifacts = Object.values(runState.artifacts).flat()` (use whatever the file already calls the run state).

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npx vitest run packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts`
Expected: FAIL — no artifact named `coverage-report` exists yet.

- [ ] **Step 3: Add the artifact name constant**

In `packages/knowledge-harness/src/runtime/make-drivers.ts`, inside the `ARTIFACTS` object (around line 39), add a member following the existing kebab-case basename convention:

```ts
  coverageReport: 'coverage-report',
```

- [ ] **Step 4: Import the builder and emit the artifact**

In `packages/knowledge-harness/src/runtime/make-drivers.ts`:

(a) Add the import near the other `eval` imports:

```ts
import { buildCoverageReport } from '../eval/coverage-report.js'
```

(b) In the `HUMAN_REVIEW_REQUIRED` driver, after `evalReport` is built and before the `return { artifacts: [...] }`, compute coverage from the run's real source list and the proposals already in scope:

```ts
      const coverage = buildCoverageReport(sources.read().map((s) => s.source_path), proposals)
```

(c) Add it to that driver's returned `artifacts` array:

```ts
        { name: ARTIFACTS.coverageReport, data: coverage },
```

(`sources` is the `SourceReader` created once in `makeDrivers` scope; `proposals` is already destructured at the top of this driver.)

- [ ] **Step 5: Run the e2e + full knowledge-harness suite + typecheck, confirm PASS**

Run: `npx vitest run packages/knowledge-harness && pnpm typecheck`
Expected: PASS — the new coverage assertion passes and all existing harness tests stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/runtime/make-drivers.ts packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts
git commit -m "feat(knowledge-harness): emit coverage-report artifact at human-review"
```

---

## Task 3: `SourceMaterializer` — copy project docs into the source area

**Files:**
- Create: `packages/app-services/src/source-materializer.ts`
- Create: `packages/app-services/src/source-materializer.test.ts`
- Modify: `packages/app-services/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app-services/src/source-materializer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { materializeProjectDocs } from './source-materializer.js'

let root: string
beforeEach(() => {
  root = join(process.cwd(), `.tmp-materializer-${process.pid}-${Math.floor(performance.now())}`)
  mkdirSync(root, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('materializeProjectDocs', () => {
  test('copies docs recursively, skips excluded dirs and non-doc files', () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(join(repo, 'sub'), { recursive: true })
    mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(repo, 'PRD.md'), '# prd')
    writeFileSync(join(repo, 'sub', 'notes.txt'), 'notes')
    writeFileSync(join(repo, 'image.png'), 'x')                 // non-doc → skipped
    writeFileSync(join(repo, 'node_modules', 'pkg', 'readme.md'), 'noise')  // excluded dir → skipped

    const manifest = materializeProjectDocs([repo], vault)

    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'PRD.md'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'sub', 'notes.txt'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'image.png'))).toBe(false)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'node_modules', 'pkg', 'readme.md'))).toBe(false)
    expect(manifest.files.map((f) => f.rel).sort()).toEqual(['project-docs/0/PRD.md', 'project-docs/0/sub/notes.txt'])
    expect(readFileSync(join(vault, 'raw', 'project-docs', '0', 'PRD.md'), 'utf8')).toBe('# prd')
  })

  test('is idempotent: a removed source disappears on the next run', () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'a.md'), 'a'); writeFileSync(join(repo, 'b.md'), 'b')
    materializeProjectDocs([repo], vault)
    rmSync(join(repo, 'b.md'))
    materializeProjectDocs([repo], vault)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'a.md'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'b.md'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npx vitest run packages/app-services/src/source-materializer.test.ts`
Expected: FAIL — `Cannot find module './source-materializer.js'`.

- [ ] **Step 3: Write the materializer**

Create `packages/app-services/src/source-materializer.ts`:

```ts
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, type Dirent } from 'node:fs'
import { join, relative, extname, dirname, sep } from 'node:path'

export type MaterializeManifest = { files: Array<{ rel: string; bytes: number }>; scanned: number; skipped: string[] }

const DOC_EXT = new Set(['.md', '.markdown', '.txt'])
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.worktrees'])

/** Recursively collect doc files under `root`, skipping excluded dirs and the vault itself. */
function walkDocs(root: string, vaultRoot: string): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const ent of entries) {
    const abs = join(root, ent.name)
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue
      if (abs === vaultRoot || abs.startsWith(vaultRoot + sep)) continue  // never pull the vault back into raw/
      out.push(...walkDocs(abs, vaultRoot))
    } else if (ent.isFile() && DOC_EXT.has(extname(ent.name).toLowerCase())) {
      out.push(abs)
    }
  }
  return out
}

/**
 * Copy every project document (.md/.markdown/.txt) under each repoPath into
 * `<vaultRoot>/raw/project-docs/<i>/<relative>`, the trusted immutable source area the harness reads.
 * Idempotent: clears `raw/project-docs/` first so deleted docs disappear. Does NOT touch other `raw/` content.
 */
export function materializeProjectDocs(repoPaths: string[], vaultRoot: string): MaterializeManifest {
  const destRoot = join(vaultRoot, 'raw', 'project-docs')
  rmSync(destRoot, { recursive: true, force: true })
  const files: Array<{ rel: string; bytes: number }> = []
  const skipped: string[] = []
  let scanned = 0
  repoPaths.forEach((repoPath, i) => {
    for (const abs of walkDocs(repoPath, vaultRoot)) {
      scanned++
      const rel = relative(repoPath, abs).replace(/\\/g, '/')
      const dest = join(destRoot, String(i), rel)
      try {
        mkdirSync(dirname(dest), { recursive: true })
        const buf = readFileSync(abs)
        writeFileSync(dest, buf)
        files.push({ rel: `project-docs/${i}/${rel}`, bytes: buf.byteLength })
      } catch {
        skipped.push(abs)
      }
    }
  })
  return { files, scanned, skipped }
}
```

- [ ] **Step 4: Export it**

In `packages/app-services/src/index.ts`, add an export line alongside the other exports:

```ts
export { materializeProjectDocs, type MaterializeManifest } from './source-materializer.js'
```

- [ ] **Step 5: Run the test + typecheck, confirm PASS**

Run: `npx vitest run packages/app-services/src/source-materializer.test.ts && pnpm typecheck`
Expected: PASS (2 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app-services/src/source-materializer.ts packages/app-services/src/source-materializer.test.ts packages/app-services/src/index.ts
git commit -m "feat(app-services): SourceMaterializer copies project docs into raw/project-docs"
```

---

## Task 4: Thread `materialize` through the service + IPC contract

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts:82`
- Modify: `packages/app-services/src/harness-service.ts` (the `run()` method)
- Modify: `apps/desktop/src/main/container.ts` (the `harnessRun` arrow at ~line 188)
- Modify: `packages/app-services/src/harness-service.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/app-services/src/harness-service.test.ts`, reuse its existing `HarnessService` construction setup (temp `vaultRoot`/`runsRoot`/fake `runner`). Add a test that materialize populates `raw/project-docs/` before the run. Mirror the existing setup for building the service; add:

```ts
  test('run({ materialize: true }) copies project docs into raw/project-docs before running', () => {
    // `vaultRoot` and `harness` are built the same way the other tests in this file build them.
    const repo = join(tmp, 'repo')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'GUIDE.md'), '# guide')

    return harness.run({ projectId: 'p1', engine: 'claude', materialize: true, repoPaths: [repo] }).then(() => {
      expect(existsSync(join(vaultRoot, 'raw', 'project-docs', '0', 'GUIDE.md'))).toBe(true)
    })
  })
```

(Use the same `tmp`/`vaultRoot`/`harness` identifiers the surrounding tests use; if they differ, adapt the names. `mkdirSync`, `writeFileSync`, `existsSync`, `join` may need adding to the test's imports.)

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npx vitest run packages/app-services/src/harness-service.test.ts`
Expected: FAIL — `run()` does not accept `materialize`/`repoPaths` and does not copy docs.

- [ ] **Step 3: Extend `HarnessRunReq`**

In `apps/desktop/src/shared/ipc-contract.ts`, line 82:

```ts
export type HarnessRunReq = { projectId: string; engine: AgentType; materialize?: boolean }
```

- [ ] **Step 4: Materialize in `HarnessService.run`**

In `packages/app-services/src/harness-service.ts`:

(a) Add the import at the top (alongside other local imports):

```ts
import { materializeProjectDocs } from './source-materializer.js'
```

(b) Change the `run` signature and body. Replace:

```ts
  async run(input: { projectId: string; engine: AgentType }): Promise<HarnessRunResult> {
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
```

with:

```ts
  async run(input: { projectId: string; engine: AgentType; materialize?: boolean; repoPaths?: string[] }): Promise<HarnessRunResult> {
    if (input.materialize && input.repoPaths?.length) {
      materializeProjectDocs(input.repoPaths, this.deps.vaultRoot)
    }
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
```

- [ ] **Step 5: Resolve repoPaths in the container**

In `apps/desktop/src/main/container.ts`, replace the `harnessRun` arrow (line ~188):

```ts
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => harness.run(req)
```

with:

```ts
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => {
    const project = registry.get(req.projectId)
    return harness.run({ projectId: req.projectId, engine: req.engine, materialize: req.materialize, repoPaths: project?.repoPaths ?? [] })
  }
```

(`registry` is already in scope in this builder — it is constructed earlier as `const registry = new ProjectRegistry(db)`.)

- [ ] **Step 6: Run tests + typecheck, confirm PASS**

Run: `npx vitest run packages/app-services && pnpm typecheck`
Expected: PASS — the new materialize test passes, existing app-services tests stay green, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts packages/app-services/src/harness-service.ts apps/desktop/src/main/container.ts packages/app-services/src/harness-service.test.ts
git commit -m "feat: thread materialize flag through harnessRun (service + container + contract)"
```

---

## Task 5: Store action — `startHarnessRun(materialize?)`

**Files:**
- Modify: `apps/desktop/src/renderer/store.ts` (the `ApcStore` type for `startHarnessRun` and its implementation at ~line 257)
- Modify: `apps/desktop/src/renderer/harness-store.test.tsx`

- [ ] **Step 1: Write the failing test**

Open `apps/desktop/src/renderer/harness-store.test.tsx` and reuse its existing api-mock setup. Add a test asserting the flag is forwarded:

```tsx
  test('startHarnessRun(true) forwards materialize:true to api.harnessRun', async () => {
    // Reuse the file's existing api mock. Arrange a selected project as the other tests do.
    await useStore.getState().startHarnessRun(true)
    expect(api.harnessRun).toHaveBeenCalledWith(expect.objectContaining({ materialize: true }))
  })
```

(Use the same `useStore` / `api` import + project-selection arrangement the surrounding tests already use. If the existing tests assert `api.harnessRun` via a `vi.mock('../api.js', ...)`, rely on that same mock.)

- [ ] **Step 2: Run it, confirm FAIL**

Run: `cd apps/desktop && npx vitest run src/renderer/harness-store.test.tsx`
Expected: FAIL — `startHarnessRun` takes no argument and never passes `materialize`.

- [ ] **Step 3: Update the store type**

In `apps/desktop/src/renderer/store.ts`, in the `ApcStore` type, change:

```ts
  startHarnessRun(): Promise<void>
```

to:

```ts
  startHarnessRun(materialize?: boolean): Promise<void>
```

- [ ] **Step 4: Pass the flag through the implementation**

In the same file, the `startHarnessRun` implementation (around line 257). Change the signature and the `api.harnessRun` call. Replace:

```ts
  async startHarnessRun() {
```

with:

```ts
  async startHarnessRun(materialize = false) {
```

and replace:

```ts
      const started = await api.harnessRun({ projectId, engine: config.model.engine })
```

with:

```ts
      const started = await api.harnessRun({ projectId, engine: config.model.engine, materialize })
```

- [ ] **Step 5: Run the test + typecheck, confirm PASS**

Run: `cd apps/desktop && npx vitest run src/renderer/harness-store.test.tsx && cd ../.. && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/harness-store.test.tsx
git commit -m "feat(desktop): startHarnessRun(materialize) forwards the flag to the run"
```

---

## Task 6: `CoverageMatrix` component (pure)

**Files:**
- Create: `apps/desktop/src/renderer/components/CoverageMatrix.tsx`
- Create: `apps/desktop/src/renderer/components/CoverageMatrix.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/components/CoverageMatrix.test.tsx`:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { KhCoverageReport } from '@apc/shared'
import { CoverageMatrix } from './CoverageMatrix.js'

const data: KhCoverageReport = {
  sources: [
    { path: 'raw/project-docs/0/PRD.md', status: 'covered', citedBy: ['n1'] },
    { path: 'raw/project-docs/0/notes.md', status: 'unmapped', citedBy: [] },
  ],
  nodes: [{ id: 'n1', title: 'Architecture', cites: ['raw/project-docs/0/PRD.md'] }],
  totals: { sourcesTotal: 2, covered: 1, unmapped: 1 },
}

describe('CoverageMatrix', () => {
  test('shows the covered/unmapped summary', () => {
    render(<CoverageMatrix data={data} />)
    expect(screen.getByTestId('coverage-summary').textContent).toContain('1/2')
    expect(screen.getByTestId('coverage-summary').textContent).toContain('1 누락')
  })

  test('lists unmapped sources and calls onOpenSource when clicked', () => {
    const onOpen = vi.fn()
    render(<CoverageMatrix data={data} onOpenSource={onOpen} />)
    const unmapped = screen.getByTestId('coverage-unmapped')
    fireEvent.click(within(unmapped).getByText('raw/project-docs/0/notes.md'))
    expect(onOpen).toHaveBeenCalledWith('raw/project-docs/0/notes.md')
  })

  test('shows an all-covered empty state when nothing is unmapped', () => {
    const allCovered: KhCoverageReport = {
      sources: [{ path: 'raw/a.md', status: 'covered', citedBy: ['n1'] }],
      nodes: [{ id: 'n1', title: 'A', cites: ['raw/a.md'] }],
      totals: { sourcesTotal: 1, covered: 1, unmapped: 0 },
    }
    render(<CoverageMatrix data={allCovered} />)
    expect(screen.getByText('누락 없음 — 전 문서 반영됨')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `cd apps/desktop && npx vitest run src/renderer/components/CoverageMatrix.test.tsx`
Expected: FAIL — `Cannot find module './CoverageMatrix.js'`.

- [ ] **Step 3: Write the component**

Create `apps/desktop/src/renderer/components/CoverageMatrix.tsx`:

```tsx
import type { KhCoverageReport } from '@apc/shared'

type Props = { data: KhCoverageReport; onOpenSource?: (path: string) => void }

export function CoverageMatrix({ data, onOpenSource }: Props) {
  const { totals, sources, nodes } = data
  const unmapped = sources.filter((s) => s.status === 'unmapped')

  return (
    <div className="coverage">
      <header className="coverage__summary" data-testid="coverage-summary">
        {totals.covered}/{totals.sourcesTotal} 반영 · {totals.unmapped} 누락
      </header>

      <div className="coverage__cols">
        <ul className="coverage__sources">
          {sources.map((s) => (
            <li key={s.path} className={`coverage__src coverage__src--${s.status}`}>
              <button type="button" onClick={() => onOpenSource?.(s.path)}>
                {s.status === 'covered' ? '✓' : '✗'} {s.path}
              </button>
              {s.status === 'covered' && s.citedBy.length > 0 && (
                <span className="coverage__cited"> → {s.citedBy.join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
        <ul className="coverage__nodes">
          {nodes.map((n) => <li key={n.id} className="coverage__node">{n.title}</li>)}
        </ul>
      </div>

      <section className="coverage__unmapped" data-testid="coverage-unmapped">
        <h3>누락 {unmapped.length}건</h3>
        {unmapped.length === 0 ? (
          <p className="coverage__empty">누락 없음 — 전 문서 반영됨</p>
        ) : (
          <ul>
            {unmapped.map((s) => (
              <li key={s.path}>
                <button type="button" onClick={() => onOpenSource?.(s.path)}>{s.path}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run the test + typecheck, confirm PASS**

Run: `cd apps/desktop && npx vitest run src/renderer/components/CoverageMatrix.test.tsx && cd ../.. && pnpm typecheck`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/CoverageMatrix.tsx apps/desktop/src/renderer/components/CoverageMatrix.test.tsx
git commit -m "feat(desktop): CoverageMatrix component (source→node, unmapped flagged)"
```

---

## Task 7: Wire Coverage tab + "전 문서로 위키 생성" button into HarnessDashboard

**Files:**
- Modify: `apps/desktop/src/renderer/components/HarnessDashboard.tsx`
- Modify: `apps/desktop/src/renderer/app.css`

- [ ] **Step 1: Add the import and extend the tab type**

In `apps/desktop/src/renderer/components/HarnessDashboard.tsx`:

(a) Add the imports (near the other component + shared imports):

```tsx
import { CoverageMatrix } from './CoverageMatrix.js'
import type { KhCoverageReport } from '@apc/shared'
```

(b) Change the `Tab` type (line 17):

```tsx
type Tab = 'markdown' | 'graph' | 'flow' | 'coverage'
```

- [ ] **Step 2: Derive the coverage artifact from the current run**

In `HarnessDashboard.tsx`, after `currentRun` is computed (the `useMemo` that finds the selected run bundle), add:

```tsx
  const coverageData = currentRun?.artifacts.find((a) => a.name === 'coverage-report')?.data as KhCoverageReport | undefined
```

- [ ] **Step 3: Add the "전 문서로 위키 생성" button and the Coverage tab**

(a) Next to the existing `Run harness` button (around line 74), add a button that materializes + runs + jumps to the coverage tab:

```tsx
            <button
              type="button"
              onClick={() => { setTab('coverage'); void startHarnessRun(true) }}
              disabled={harnessLoading || !selectedProjectId}
              title="프로젝트 하위 문서를 모아 위키 생성 후 커버리지 확인"
            >전 문서로 위키 생성</button>
```

(b) Add the Coverage tab button after the `Task Flow View` tab button (around line 94):

```tsx
            <button type="button" className={tab === 'coverage' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('coverage')}>Coverage</button>
```

(c) Add the Coverage content after the `flow` content (around line 110):

```tsx
            {tab === 'coverage' && (
              coverageData
                ? <CoverageMatrix data={coverageData} onOpenSource={(p) => window.alert(p)} />
                : <div className="harness-dashboard__placeholder">아직 커버리지 데이터가 없습니다 — "전 문서로 위키 생성"을 실행하세요.</div>
            )}
```

- [ ] **Step 4: Add styles**

Append to `apps/desktop/src/renderer/app.css`:

```css
/* ── Coverage matrix ─────────────────────────────────── */
.coverage { display: flex; flex-direction: column; gap: 12px; padding: 10px; }
.coverage__summary { font-size: 0.95rem; font-weight: 600; }
.coverage__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.coverage__sources, .coverage__nodes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.coverage__src button, .coverage__unmapped button { background: none; border: none; color: #cdd; cursor: pointer; text-align: left; font-size: 0.8rem; padding: 1px 0; }
.coverage__src--unmapped button { color: #f87171; }
.coverage__cited { font-size: 0.7rem; opacity: 0.6; }
.coverage__node { font-size: 0.8rem; color: #9cf; }
.coverage__unmapped { border-top: 1px solid #2c2c2c; padding-top: 8px; }
.coverage__empty { opacity: 0.6; font-size: 0.82rem; }
```

- [ ] **Step 5: Run the full desktop suite + typecheck, confirm PASS**

Run: `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck`
Expected: PASS — all desktop suites green (including the new CoverageMatrix tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/HarnessDashboard.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): Coverage tab + 전 문서로 위키 생성 button in HarnessDashboard"
```

---

## Task 8: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run every affected suite**

Run:
```bash
npx vitest run packages/knowledge-harness
npx vitest run packages/app-services
cd apps/desktop && npx vitest run && cd ../..
pnpm typecheck
```
Expected: all green, typecheck clean.

- [ ] **Step 2: Confirm acceptance criteria (spec §8)**

Confirm against `docs/superpowers/specs/2026-06-08-docs-to-wiki-coverage-design.md` §8:
1. "전 문서로 위키 생성" button runs materialize → pipeline → Coverage tab. ✔ (Task 7 + Task 4/5)
2. `SourceMaterializer` copies repoPaths docs into `raw/project-docs/` with manifest, leaving other `raw/` untouched. ✔ (Task 3)
3. Run emits a `coverage-report` artifact with the source↔node mapping + unmapped. ✔ (Task 1/2)
4. Coverage tab renders matrix + unmapped list + summary, unmapped click opens the source. ✔ (Task 6/7)
5. New + existing tests and `pnpm typecheck` pass. ✔ (Step 1)
6. No new IPC channel, no DB migration (only `materialize?` + a new artifact). ✔

- [ ] **Step 3: Note any follow-ups**

The MVP shows coverage but does not auto-reprocess unmapped docs, does not do sub-document (section) coverage, and does not gate CI on eval thresholds — these are explicitly out of scope (spec §7).

---

## Notes for the implementer

- All new components/functions are **pure** (props/args in, value out) — no store/IPC access inside `buildCoverageReport`, `materializeProjectDocs`, or `CoverageMatrix` — which is why they unit-test cleanly.
- Tasks 2, 4, 5 add an assertion to an **existing** test file; open that file first and reuse its existing setup/mocks rather than re-creating fixtures.
- Do NOT change the 9-state pipeline logic — Task 2 only *adds* an artifact at `HUMAN_REVIEW_REQUIRED`; the materialize step (Task 4) runs *before* the pipeline, not inside it.
- `node.id` / `node.title` (not `node_id`) and `evidence[].source_path` are the exact schema field paths used by the coverage builder.
