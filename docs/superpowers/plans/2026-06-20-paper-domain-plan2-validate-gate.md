# Paper Domain — Plan 2: DomainPack Validate Gate (kernel lint)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `DomainPack` a `validate(wikiDir, {substrate})` capability so a generated paper wiki can be gated by the autosci **kernel lint** (the authoritative paper-domain check), proven by golden(green)+broken(fail) tests — with `contractDir` resolution robust enough to fail loudly (not silently) when the contract is missing.

**Architecture:** Extend the minimal `DomainPack` (Plan 1) with an optional `validate`. The `paper` pack delegates to an injected `WikiSubstrate` (`PythonKernelAdapter` over a uv venv) — `substrate.lint({ contractDir: <paper contract>, wikiDir })` — keeping the pack pure (no subprocess spawning of its own) and unit-testable with a fake substrate. The `project-docs` pack omits `validate` (its existing TS validators stay the gate). No change to the live `make-drivers` pipeline — wiring lands in Plan 4.

**Tech Stack:** TypeScript (pnpm monorepo), `@apc/wiki-substrate` (`WikiSubstrate`/`PythonKernelAdapter`), Zod, Vitest, a uv-managed `.venv-substrate` + `vendor/autosci-core` (already bootstrapped in #1).

## Global Constraints

- The paper validation gate is **kernel lint** via `WikiSubstrate.lint(vault: { contractDir, wikiDir }) → KhKernelLintReport` where `KhKernelLintReport = { generated_by: string; ok: boolean; exit_code: number; issues: string[] }`.
- `DomainPack` stays minimal otherwise — `validate` is the ONLY field added this plan. Do NOT add `renderNode`/`nodeSchema`/`buildExtractorPrompt` (those are Plan 3).
- The pack MUST NOT spawn Python itself — it receives a `WikiSubstrate` via `deps.substrate`. The caller owns substrate construction.
- `project-docs` behavior unchanged: `projectDocsPack.validate` stays `undefined`.
- venv-gated tests skip cleanly when the venv is absent — gate on `core.lock`'s `venv_python` exactly like `packages/knowledge-harness/src/runtime/paper-phase1.e2e.test.ts:12-19`.
- Tests run from repo root: `pnpm exec vitest run <path>`. Typecheck authority: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`.
- Paper contract dir = repo-root `wiki-domains/paper/runtime` (exists). Golden wiki = `packages/wiki-substrate/test/fixtures/paper-golden/wiki` (exists).

---

## File Structure

- `packages/knowledge-harness/src/domains/types.ts` — add optional `validate` to `DomainPack`.
- `packages/knowledge-harness/src/domains/paper-pack.ts` — add `resolvePaperContractDir()` + `paperPack.validate`.
- `packages/knowledge-harness/src/domains/paper-pack.validate.test.ts` — fake-substrate unit tests (non-venv).
- `packages/knowledge-harness/src/domains/paper-pack.lint.int.test.ts` — venv-gated golden/broken integration tests.

---

### Task 1: `DomainPack.validate` + `paperPack.validate` + robust contractDir

**Files:**
- Modify: `packages/knowledge-harness/src/domains/types.ts`
- Modify: `packages/knowledge-harness/src/domains/paper-pack.ts`
- Test: `packages/knowledge-harness/src/domains/paper-pack.validate.test.ts`

**Interfaces:**
- Consumes: `DomainPack` (Plan 1, `domains/types.ts`); `WikiSubstrate`, `WikiVault` from `@apc/wiki-substrate`; `KhKernelLintReport`, `KhKernelLintReportSchema` from `@apc/shared`.
- Produces:
  - `DomainPack.validate?(wikiDir: string, deps: { substrate: WikiSubstrate }): Promise<KhKernelLintReport>`
  - `resolvePaperContractDir(): string` (exported from `paper-pack.ts`) — `process.env.APC_PAPER_CONTRACT_DIR` if set, else the source-relative `wiki-domains/paper/runtime`. Does NOT throw (existence is checked in `validate`).
  - `paperPack.validate` (defined; `projectDocsPack.validate` stays undefined).

- [ ] **Step 1: Write the failing test**

```ts
// packages/knowledge-harness/src/domains/paper-pack.validate.test.ts
import { describe, expect, test, afterEach } from 'vitest'
import { KhKernelLintReportSchema, type KhKernelLintReport } from '@apc/shared'
import type { WikiSubstrate, WikiVault } from '@apc/wiki-substrate'
import { paperPack } from './paper-pack.js'
import { projectDocsPack } from './project-docs-pack.js'

const fakeSubstrate = (report: KhKernelLintReport, sink: WikiVault[]): WikiSubstrate => ({
  lint: async (v) => { sink.push(v); return report },
  rebuildIndex: async () => {},
  checkSources: async () => ({ ok: true, output: '' }),
})

afterEach(() => { delete process.env.APC_PAPER_CONTRACT_DIR })

describe('paperPack.validate', () => {
  test('lints the given wiki dir against the paper contract and returns the report', async () => {
    const seen: WikiVault[] = []
    const ok = KhKernelLintReportSchema.parse({ ok: true, exit_code: 0, issues: [] })
    const r = await paperPack.validate!('/tmp/some/wiki', { substrate: fakeSubstrate(ok, seen) })
    expect(seen).toHaveLength(1)
    expect(seen[0].wikiDir).toBe('/tmp/some/wiki')
    expect(seen[0].contractDir).toMatch(/wiki-domains[\\/]paper[\\/]runtime$/)
    expect(r.ok).toBe(true)
  })

  test('throws an actionable error (not lint) when the contract dir is missing', async () => {
    process.env.APC_PAPER_CONTRACT_DIR = '/definitely/not/here'
    const seen: WikiVault[] = []
    const ok = KhKernelLintReportSchema.parse({ ok: true, exit_code: 0, issues: [] })
    await expect(paperPack.validate!('/tmp/w', { substrate: fakeSubstrate(ok, seen) })).rejects.toThrow(/paper contract not found/i)
    expect(seen).toHaveLength(0) // never reached lint
  })

  test('project-docs pack has no validate (TS validators remain the gate)', () => {
    expect(projectDocsPack.validate).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.validate.test.ts`
Expected: FAIL — `paperPack.validate` is `undefined` (not yet defined), so `paperPack.validate!(...)` throws "is not a function".

- [ ] **Step 3: Extend the interface**

In `packages/knowledge-harness/src/domains/types.ts`, add imports at the top and the field:
```ts
import type { WikiSubstrate } from '@apc/wiki-substrate'
import type { KhKernelLintReport } from '@apc/shared'
```
Add to the `DomainPack` interface (after `contractDir`):
```ts
  /** Validate a generated wiki dir against this domain's contract. paper → kernel lint (authoritative);
   *  project-docs leaves this undefined and keeps its existing TS validators. The caller injects the
   *  substrate so the pack never spawns Python itself. */
  validate?(wikiDir: string, deps: { substrate: WikiSubstrate }): Promise<KhKernelLintReport>
```

- [ ] **Step 4: Implement in paper-pack.ts**

Replace the body of `packages/knowledge-harness/src/domains/paper-pack.ts` with:
```ts
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { WikiSubstrate } from '@apc/wiki-substrate'
import type { KhKernelLintReport } from '@apc/shared'
import type { DomainPack } from './types.js'

// repo-root/wiki-domains/paper/runtime, resolved relative to this file
// (packages/knowledge-harness/src/domains/ -> up 4 to repo root).
const here = dirname(fileURLToPath(import.meta.url))
const sourceContractDir = join(here, '..', '..', '..', '..', 'wiki-domains', 'paper', 'runtime')

/** The paper contract dir. An `APC_PAPER_CONTRACT_DIR` override lets a packaged build (where the
 *  source-relative path does not exist) point at the bundled contract. Does NOT assert existence —
 *  `validate` checks that and fails loudly, so importing the pack is always safe. */
export function resolvePaperContractDir(): string {
  return process.env.APC_PAPER_CONTRACT_DIR ?? sourceContractDir
}

export const paperPack: DomainPack = {
  id: 'paper',
  contractDir: resolvePaperContractDir(),
  async validate(wikiDir: string, deps: { substrate: WikiSubstrate }): Promise<KhKernelLintReport> {
    const contractDir = resolvePaperContractDir()
    if (!existsSync(contractDir)) {
      throw new Error(
        `paper contract not found at ${contractDir} — bundle wiki-domains/paper/runtime with the app ` +
        `or set APC_PAPER_CONTRACT_DIR`,
      )
    }
    return deps.substrate.lint({ contractDir, wikiDir })
  },
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Re-run Plan 1's selector test + typecheck (no regression)**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/index.test.ts`
Then: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: index.test PASS (the `contractDir` regex still matches `resolvePaperContractDir()`'s default), 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge-harness/src/domains/types.ts packages/knowledge-harness/src/domains/paper-pack.ts packages/knowledge-harness/src/domains/paper-pack.validate.test.ts
git commit -m "feat(knowledge-harness): DomainPack.validate + paperPack kernel-lint gate (substrate injected)"
```

---

### Task 2: venv-gated integration test — golden lints green, broken node fails

**Files:**
- Test: `packages/knowledge-harness/src/domains/paper-pack.lint.int.test.ts`

**Interfaces:**
- Consumes: `paperPack.validate` (Task 1), `PythonKernelAdapter` from `@apc/wiki-substrate`, the golden fixture at `packages/wiki-substrate/test/fixtures/paper-golden/wiki`, and `core.lock`'s `venv_python`.
- Produces: nothing new — this task is the integration proof that the gate actually fires against real kernel lint.

- [ ] **Step 1: Write the venv-gated test**

```ts
// packages/knowledge-harness/src/domains/paper-pack.lint.int.test.ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonKernelAdapter } from '@apc/wiki-substrate'
import { paperPack } from './paper-pack.js'

// Gate on the bootstrapped substrate venv, exactly like paper-phase1.e2e.test.ts.
const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../../..')
const lockPath = join(repoRoot, 'core.lock')
const venvPython = existsSync(lockPath)
  ? join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python)
  : ''
const haveVenv = venvPython !== '' && existsSync(venvPython)
const d = haveVenv ? describe : describe.skip

const goldenWikiDir = join(repoRoot, 'packages/wiki-substrate/test/fixtures/paper-golden/wiki')

d('paperPack.validate over real kernel lint', () => {
  const substrate = new PythonKernelAdapter({ python: venvPython, cwd: repoRoot })

  test('golden wiki lints green (ok, no issues)', async () => {
    const report = await paperPack.validate!(goldenWikiDir, { substrate })
    expect(report.ok).toBe(true)
    expect(report.issues).toHaveLength(0)
  }, 30_000)

  test('a node with its title removed fails the lint with issues preserved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-pack-lint-'))
    try {
      const broken = join(dir, 'wiki')
      cpSync(goldenWikiDir, broken, { recursive: true })
      const papers = join(broken, 'papers')
      const f = join(papers, readdirSync(papers).find((n) => n.endsWith('.md'))!)
      writeFileSync(f, readFileSync(f, 'utf8').replace(/^title:.*$/m, '')) // drop required field
      const report = await paperPack.validate!(broken, { substrate })
      expect(report.ok).toBe(false)
      expect(report.issues.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
```

- [ ] **Step 2: Bootstrap the substrate venv (if not present) and run the test**

Run (one-time, idempotent): `node scripts/bootstrap-substrate.mjs`
Then: `pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.lint.int.test.ts`
Expected: with the venv present, 2 tests PASS (golden green, broken fails with issues). Without the venv, the `describe.skip` reports the file as skipped — that is an acceptable pass for this task ONLY if the venv genuinely cannot be bootstrapped in this environment; otherwise bootstrap it and get real green.

> If `bootstrap-substrate.mjs` fails (no `uv`/python), report DONE_WITH_CONCERNS: the unit gate (Task 1) is proven, but the integration proof is skip-gated here and must be run on a machine with the venv. Do not fake a pass.

- [ ] **Step 3: Confirm the suite stays green + typecheck**

Run: `pnpm exec vitest run packages/knowledge-harness`
Then: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: PASS, 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/knowledge-harness/src/domains/paper-pack.lint.int.test.ts
git commit -m "test(knowledge-harness): venv-gated proof paperPack.validate gates golden green / broken fail"
```

---

## Self-Review

**Spec coverage:** Plan 2's slice of the design (§4.3 VALIDATED via `WikiSubstrate.lint`; §6 [6] issue→FAILED; §9 risk "venv/Windows path") — Task 1 adds the `validate` capability + actionable missing-contract error (the deferred Plan-1 contractDir concern), Task 2 proves the gate fires on real kernel lint with the negative case (the design's core de-risking value). `renderNode`/ingest/extraction and the `make-drivers` wiring are explicitly DEFERRED to Plans 3–4 — not gaps.

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one conditional (Task 2 skip when no venv) has an explicit DONE_WITH_CONCERNS rule so it cannot be silently faked.

**Type consistency:** `validate?(wikiDir: string, deps: { substrate: WikiSubstrate }): Promise<KhKernelLintReport>` is identical in the interface (types.ts) and the impl (paper-pack.ts) and the test call sites; `resolvePaperContractDir(): string` matches its uses.

---

## Follow-on plans (after Plan 2)

- **Plan 3 — Paper ingest + LLM typed-node extraction + `renderNode`:** `WikiSubstrate` ingest (autosci-read) of `raw/`; paper extractor prompt + `nodeSchema` → typed proposals; `paperPack.renderNode(node) → { relPath, content }` (typed node → `wiki/<type>/<slug>.md` + UI frontmatter); typed-edge merge; PolicyGuard domain-awareness.
- **Plan 4 — Wire `make-drivers` + route papers + e2e:** `STAGING_WRITTEN` → `domainPack.renderNode`, `VALIDATED` → `domainPack.validate` (with the substrate constructed from the resolved venv python); route `domain==='paper'` projects; package `wiki-domains/` into the Electron build (verify `resolvePaperContractDir()` resolves there); e2e (papers fixture → HUMAN_REVIEW + index/graph), negative, project-docs regression, UI graph smoke.

---

## Execution Handoff

(see skill — offered after save)
