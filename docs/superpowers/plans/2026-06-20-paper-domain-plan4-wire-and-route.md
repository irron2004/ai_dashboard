# Paper Domain — Plan 4: wire the paper pipeline + route papers (e2e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `domain:'paper'` run actually generate a paper wiki: route the harness through a **paper-drivers overlay** that runs the extractor (3b) → renders typed nodes (3) → gates with kernel lint (2), reusing the existing run/staging/promote/UI machinery. Prove it end-to-end on a source fixture; keep `project-docs` byte-identical.

**Architecture:** `makeDrivers` returns the existing project-docs drivers, **overlaid** with paper-specific drivers for `NODE_PROPOSALS_CREATED` / `STAGING_WRITTEN` / `VALIDATED` when `deps.domainPack?.id === 'paper'` (the project-docs object is never mutated — overlay = `{ ...projectDocsDrivers, ...paperDrivers }`). The paper drivers reuse `makePaperNodeExtractor`, `paperPack.renderNode`, `paperPack.validate`, the existing `StagingVault`, and `vaultToStagedDocs` (so the UI graph shows the nodes). `HarnessService` threads the resolved `DomainPack` + a `WikiSubstrate` (built from the venv python) into `DriverDeps`.

**Tech Stack:** TypeScript (pnpm monorepo), the existing harness runtime (`make-drivers`, `StagingVault`, `RunArtifactStore`), `@apc/wiki-substrate`, Vitest (fake extractor/substrate for unit tests; venv-gated e2e).

## Global Constraints

- `project-docs` runs MUST be byte-identical: the overlay only adds keys when `domainPack?.id === 'paper'`; never edit the project-docs driver bodies.
- Paper `NODE_PROPOSALS_CREATED` output artifact: `{ nodes: PaperNode[] }` stored under the existing `ARTIFACTS.nodeProposals` name (so downstream/UI lookups resolve), where `PaperNode = { type, slug, fields, body? }`.
- Paper staging layout: nodes at `<stagingRoot>/wiki/<type>/<slug>.md` (via `paperPack.renderNode`), edges at `<stagingRoot>/wiki/graph/edges.jsonl`, AND UI staging docs at `<stagingRoot>/nodes/<slug>.md` (via `vaultToStagedDocs`) so `KnowledgeView`/graph render the nodes.
- Paper `VALIDATED` = `domainPack.validate(<stagingRoot>/wiki, { substrate })` (kernel lint); a lint issue → `DriverResult{ status:'failed', artifacts:[the report under ARTIFACTS.kernelLint] }` (the §4a-1 fail-preserve contract already exists).
- The substrate is built from `core.lock`'s `venv_python`; when absent/non-runnable (native Windows Linux venv), the paper VALIDATED must fail with an actionable error (do NOT silently pass). e2e tests are venv-gated (skip on native Windows; controller verifies under WSL).
- Sources for the extractor = the run's `raw/` docs via the existing `SourceReader` (markdown/text). PDF-via-autosci-read ingest is DEFERRED to Plan 5.
- Tests from repo root. Typecheck: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`.

## File Structure

- `packages/knowledge-harness/src/runtime/make-drivers.ts` — add `domainPack`/`substrate` to `DriverDeps`; overlay paper drivers.
- `packages/knowledge-harness/src/runtime/paper-drivers.ts` — `makePaperDrivers(deps)` (the three paper drivers).
- `packages/knowledge-harness/src/runtime/paper-drivers.test.ts` — unit tests (fake extractor + fake substrate).
- `packages/app-services/src/harness-service.ts` — thread `domainPack` + construct `substrate`, pass into `runnerFor` → `makeDrivers`.
- `packages/knowledge-harness/src/runtime/paper-pipeline.e2e.test.ts` — venv-gated e2e.

---

### Task 1: Thread `domainPack` + `substrate` into DriverDeps (no behavior change)

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (`DriverDeps` type only)
- Modify: `packages/app-services/src/harness-service.ts` (`runnerFor` + `run`)
- Test: `packages/app-services/src/harness-service.domain.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveDomainPack` (Plan 1), `DomainPack` + `WikiSubstrate`.
- Produces: `DriverDeps` gains `domainPack?: DomainPack` and `substrate?: WikiSubstrate`; `HarnessService.runnerFor` accepts + forwards them; `run` resolves the pack and (for paper) builds a `PythonKernelAdapter` from `core.lock`'s venv python.

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/app-services/src/harness-service.domain.test.ts
import { buildVenvSubstrate } from './harness-service.js'

describe('buildVenvSubstrate', () => {
  test('returns undefined when no core.lock venv is configured', () => {
    expect(buildVenvSubstrate('/no/such/repo')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/app-services/src/harness-service.domain.test.ts`
Expected: FAIL — `buildVenvSubstrate` not exported.

- [ ] **Step 3: Add the fields + helper**

In `make-drivers.ts` `DriverDeps` (around line 31), add:
```ts
  /** Domain overlay pack (Plan 1+). When id==='paper', makeDrivers overlays the paper drivers. */
  domainPack?: import('../domains/types.js').DomainPack
  /** Substrate for paper kernel lint (built from the venv python). Required for paper VALIDATED. */
  substrate?: import('@apc/wiki-substrate').WikiSubstrate
```

In `harness-service.ts`:
- Add imports: `import { PythonKernelAdapter, type WikiSubstrate } from '@apc/wiki-substrate'`, `readFileSync`/`existsSync` from `node:fs`, `join` from `node:path` (if not already imported).
- Add exported helper (resolves the venv python from `core.lock` next to the repo root — derive repoRoot as the dir containing `core.lock`; the harness-service file is under `packages/app-services/src`, so resolve up to repo root via a passed `repoRoot` param for testability):
```ts
/** Build the kernel-lint substrate from core.lock's venv python, or undefined if unavailable
 *  (no lock, missing python, or a non-Windows venv on win32). Paper VALIDATED needs this. */
export function buildVenvSubstrate(repoRoot: string): WikiSubstrate | undefined {
  const lock = join(repoRoot, 'core.lock')
  if (!existsSync(lock)) return undefined
  const python = join(repoRoot, JSON.parse(readFileSync(lock, 'utf8')).venv_python ?? '')
  const winRunnable = process.platform !== 'win32' || /[\\/]scripts[\\/]/i.test(python)
  if (!existsSync(python) || !winRunnable) return undefined
  return new PythonKernelAdapter({ python, cwd: repoRoot })
}
```
- In `runnerFor`, add params `domainPack?` and `substrate?` and pass them into the `makeDrivers({ ... })` call.
- In `run`, compute `const pack = resolveDomainPack(input.domain)` (already present from Plan 1), and for paper build the substrate: derive repoRoot (the dir holding `core.lock`; reuse however the service already locates it, else accept it via deps — NOTE: locate how harness-service resolves repo-relative paths and match that), then pass `pack` and `buildVenvSubstrate(repoRoot)` into `runnerFor`.

> NOTE: `harness-service.ts` does not currently know `repoRoot`. Find the least-invasive source (e.g. a `process.cwd()` fallback, or thread it from the container which knows app paths). Pick one, keep it testable (`buildVenvSubstrate` takes `repoRoot` explicitly so the unit test passes a bogus path).

- [ ] **Step 4: Run to verify it passes + project-docs regression**

Run: `pnpm exec vitest run packages/app-services/src/harness-service.domain.test.ts`
Then: `pnpm exec vitest run packages/app-services packages/knowledge-harness`
Then: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: PASS (project-docs drivers unchanged — `makeDrivers` ignores `domainPack`/`substrate` until Task 2), 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-harness/src/runtime/make-drivers.ts packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.domain.test.ts
git commit -m "feat: thread domainPack + venv substrate into DriverDeps (paper routing scaffold)"
```

---

### Task 2: `makePaperDrivers` overlay (extract → render → validate)

**Files:**
- Create: `packages/knowledge-harness/src/runtime/paper-drivers.ts`
- Create: `packages/knowledge-harness/src/runtime/paper-drivers.test.ts`
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (overlay merge)

**Interfaces:**
- Consumes: `makePaperNodeExtractor` (3b), `paperPack.renderNode`/`validate` (2/3), `SourceReader` (`./source-reader.js`), `StagingVault` (`../staging/staging-vault.js`), `vaultToStagedDocs` (`@apc/wiki-substrate`), `RunnerContext`/`Driver`/`DriverResult` (`./harness-runner.js`), `ARTIFACTS` (`./make-drivers.js`).
- Produces: `makePaperDrivers(deps: DriverDeps): Partial<Record<KhState, Driver>>` covering `NODE_PROPOSALS_CREATED`, `STAGING_WRITTEN`, `VALIDATED`.

- [ ] **Step 1: Write the failing test (fake extractor + fake substrate)**

```ts
// packages/knowledge-harness/src/runtime/paper-drivers.test.ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from './run-artifact-store.js'
import { makePaperDrivers } from './paper-drivers.js'
import { paperPack } from '../domains/paper-pack.js'
import { ARTIFACTS } from './make-drivers.js'
import { KhKernelLintReportSchema } from '@apc/shared'

// A runner whose paper extractor output is canned (no real LLM).
const fakeRunner = (out: unknown) => ({ run: async () => ({ ok: true, output: JSON.stringify(out), raw: '' }) })
const okSubstrate = { lint: async () => KhKernelLintReportSchema.parse({ ok: true, issues: [] }), rebuildIndex: async () => {}, checkSources: async () => ({ ok: true, output: '' }) }

function deps(dir: string, runner: unknown, substrate: unknown) {
  return {
    runner, vaultRoot: join(dir, 'vault'), stagingRoot: join(dir, 'staging'), preamble: 'P',
    domainPack: paperPack, substrate,
  } as never
}

describe('makePaperDrivers', () => {
  test('NODE_PROPOSALS_CREATED runs the paper extractor and stores typed nodes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-drv-'))
    try {
      const out = { nodes: [{ type: 'papers', slug: 'p1', fields: { title: 'T', slug: 'p1' } }] }
      const store = new RunArtifactStore(join(dir, 'run'))
      store.createRun?.({ runId: 'R', projectId: 'paper', engine: 'claude' }) // if applicable; else use the runner contract
      const drivers = makePaperDrivers(deps(dir, fakeRunner(out), okSubstrate))
      const res = await drivers.NODE_PROPOSALS_CREATED!({ /* RunnerContext */ } as never)
      const stored = res.artifacts.find((a) => a.name === ARTIFACTS.nodeProposals)
      expect((stored!.data as { nodes: unknown[] }).nodes).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('STAGING_WRITTEN renders nodes to wiki/<type>/<slug>.md + UI staging docs', async () => {
    // construct a ctx whose NODE_PROPOSALS_CREATED artifact holds one paper node, run STAGING_WRITTEN,
    // assert <stagingRoot>/wiki/papers/p1.md exists and <stagingRoot>/nodes/p1.md exists.
  })

  test('VALIDATED green when substrate.lint ok; FAILED+report when issues', async () => {
    // run VALIDATED with okSubstrate -> status ok; with a substrate returning issues -> status 'failed'
    // and an artifact under ARTIFACTS.kernelLint.
  })
})
```

> NOTE: the exact `RunnerContext` shape (ctx.store, ctx.runState, ctx.projectId, artifactByName) and how a driver reads a prior artifact must MATCH the existing project-docs drivers in `make-drivers.ts`. Read those (NODE_PROPOSALS_CREATED/STAGING_WRITTEN/VALIDATED) and mirror their ctx usage exactly. Fill the two stubbed tests with the same ctx-construction the existing driver tests use (see `make-drivers.interactive.test.ts` / `paper-phase1.e2e.test.ts` for how a RunnerContext/store is built).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/paper-drivers.test.ts`
Expected: FAIL — `makePaperDrivers` not defined.

- [ ] **Step 3: Implement `paper-drivers.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { KhState } from '@apc/shared'
import { vaultToStagedDocs } from '@apc/wiki-substrate'
import type { Driver, DriverResult, RunnerContext } from './harness-runner.js'
import type { DriverDeps } from './make-drivers.js'
import { ARTIFACTS } from './make-drivers.js'
import { SourceReader } from './source-reader.js'
import { makePaperNodeExtractor } from '../agents/paper-node-extractor.js'
import type { PaperNode } from '../agents/paper-node-extractor.js'

export function makePaperDrivers(deps: DriverDeps): Partial<Record<KhState, Driver>> {
  const extractor = makePaperNodeExtractor(deps.preamble)
  const pack = deps.domainPack!            // makeDrivers only overlays when id==='paper'
  const sources = new SourceReader(deps.vaultRoot)

  return {
    NODE_PROPOSALS_CREATED: async (ctx: RunnerContext): Promise<DriverResult> => {
      const out = await extractor.run({
        runner: deps.runner, engine: ctx.engine as never, timeoutMs: deps.stepTimeoutMs,
        cwd: deps.projectCwd, engineOptions: deps.engineOptions,
        label: `NODE_PROPOSALS_CREATED-${extractor.name}`,
        input: { sources: sources.read() },
      })
      return { artifacts: [{ name: ARTIFACTS.nodeProposals, data: out }] }
    },

    STAGING_WRITTEN: async (ctx: RunnerContext): Promise<DriverResult> => {
      const nodes = (readArtifact<{ nodes: PaperNode[] }>(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals)?.nodes) ?? []
      const wikiDir = join(deps.stagingRoot, 'wiki')
      for (const n of nodes) {
        const out = pack.renderNode!(n)
        const abs = join(deps.stagingRoot, out.relPath)
        mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, out.content)
      }
      // UI staging docs (node_id/node_type) so KnowledgeView/graph render the nodes.
      const staged = vaultToStagedDocs(wikiDir, deps.stagingRoot)
      return { artifacts: [{ name: ARTIFACTS.appliedWriteReport, data: { applied: [], proposals: staged, skipped: [] } }] }
    },

    VALIDATED: async (): Promise<DriverResult> => {
      if (!deps.substrate) {
        return { artifacts: [], status: 'failed', error: 'paper validate needs the substrate venv — bootstrap .venv-substrate (uv) or run on a machine with it' }
      }
      const report = await pack.validate!(join(deps.stagingRoot, 'wiki'), { substrate: deps.substrate })
      const artifacts = [{ name: ARTIFACTS.kernelLint, data: report }]
      return report.ok ? { artifacts } : { artifacts, status: 'failed', error: `kernel lint: ${report.issues.length} issue(s)` }
    },
  }
}
```

> NOTE: `readArtifact` is the local helper the existing drivers use (`artifactByName` in make-drivers.ts is module-private). Either export `artifactByName` from make-drivers.ts and import it here, or replicate its tiny body (read `ctx.runState.artifacts[state]`, find basename `${name}.json`, `ctx.store.readArtifact`). Match the existing helper exactly. Also confirm `ARTIFACTS.kernelLint` exists (it was added in #1); if the name differs, use the real one.

- [ ] **Step 4: Overlay in makeDrivers**

At the END of `makeDrivers` (before `return { ... }` of the project-docs drivers), capture the project-docs object and overlay:
```ts
  const base = { /* the existing returned driver object */ }
  if (deps.domainPack?.id === 'paper') {
    return { ...base, ...makePaperDrivers(deps) }
  }
  return base
```
(Refactor the existing `return { PROJECT_SCANNED: ..., ... }` to `const base = { ... }` then the overlay. Do NOT change any project-docs driver body.)

- [ ] **Step 5: Fill the stubbed tests, run GREEN + typecheck + suite**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/paper-drivers.test.ts`
Then: `pnpm exec vitest run packages/knowledge-harness` and `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: PASS, 0 errors, project-docs suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/runtime/paper-drivers.ts packages/knowledge-harness/src/runtime/paper-drivers.test.ts packages/knowledge-harness/src/runtime/make-drivers.ts
git commit -m "feat(knowledge-harness): paper-drivers overlay (extract -> render -> kernel-lint) routed by domainPack"
```

---

### Task 3: e2e (paper source fixture → HUMAN_REVIEW, lint green) + project-docs regression

**Files:**
- Create: `packages/knowledge-harness/src/runtime/paper-pipeline.e2e.test.ts`

**Interfaces:**
- Consumes: the full paper driver path (Tasks 1-2), a small source fixture, a fake runner returning canned paper nodes that match the golden contract, the real venv substrate (venv-gated).

- [ ] **Step 1: Write the venv-gated e2e**

Build a run whose `raw/` holds a tiny source doc, whose engine runner is FAKE and returns a canned `{ nodes: [...] }` of valid paper nodes (reuse the golden papers/modules node fields so lint passes), with `domainPack: paperPack` and a REAL `PythonKernelAdapter` substrate (gated on `core.lock` venv + `winRunnable`, skipping on native Windows). Advance the run; assert it reaches `HUMAN_REVIEW_REQUIRED`, the `VALIDATED` artifact `ok===true`, and `<stagingRoot>/wiki/papers/<slug>.md` + `<stagingRoot>/nodes/<slug>.md` exist. Mirror the gating + structure of `paper-phase1.e2e.test.ts`.

> NOTE: use the same `HarnessRunner` + `FeatureGate(ALL_OPEN)` + `RunArtifactStore` setup as `paper-phase1.e2e.test.ts`; the only differences are (a) `domainPack: paperPack` + real substrate in deps, and (b) the fake runner returns paper nodes instead of using fixture drivers.

- [ ] **Step 2: Run it (skips on native Windows; controller verifies under WSL)**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/paper-pipeline.e2e.test.ts`
Expected: skipped on native Windows (Linux venv); on Linux/CI — green (reaches HUMAN_REVIEW, lint ok, staging nodes present). Report DONE_WITH_CONCERNS if the venv can't run here — do NOT fake a pass.

- [ ] **Step 3: Full regression + typecheck**

Run: `pnpm exec vitest run` (root) and `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: all pass / 0 errors. **project-docs runs must be unchanged.**

- [ ] **Step 4: Commit**

```bash
git add packages/knowledge-harness/src/runtime/paper-pipeline.e2e.test.ts
git commit -m "test(knowledge-harness): paper pipeline e2e — source -> extract -> render -> kernel-lint green"
```

---

## Self-Review

**Spec coverage:** Plan 4 realizes §4.3 (per-domain drivers; STAGING_WRITTEN→renderNode, VALIDATED→validate) + the routing that makes `domain==='paper'` produce a paper wiki. Task 1 threads the pack + substrate (no behavior change), Task 2 is the overlay (extract→render→lint), Task 3 proves it e2e while pinning project-docs unchanged. PDF-via-autosci-read ingest, typed-edge construction from the lead, electron-builder packaging of `wiki-domains/`, and a real LLM run on the user's workspace are DEFERRED to Plan 5.

**Placeholder scan:** Code is concrete for Task 1 and the Task 2 implementation; the two stubbed Task 2 tests + the e2e carry explicit NOTE callouts to match existing ctx/StagingVault/e2e structure (the implementer reads those files) — these are "match the existing pattern" instructions, not requirement placeholders. Flagged honestly because the RunnerContext/StagingVault internals are best matched in-context.

**Type consistency:** `DriverDeps.domainPack?: DomainPack` / `substrate?: WikiSubstrate`; `makePaperDrivers(deps: DriverDeps)`; paper nodes typed `PaperNode` end to end; `buildVenvSubstrate(repoRoot: string): WikiSubstrate | undefined`.

---

## Follow-on (Plan 5)

PDF ingest via autosci-read (`WikiSubstrate.checkSources` → parsed text feeding the extractor); typed-edge construction (`uses_module`/etc → `wiki/graph/edges.jsonl`); package `wiki-domains/` into the Electron build (electron-builder `extraResources` + verify `APC_PAPER_CONTRACT_DIR`/`resolvePaperContractDir` in the packaged app); then a REAL LLM run on the user's papers workspace.

---

## Execution Handoff

(see skill — offered after save)
