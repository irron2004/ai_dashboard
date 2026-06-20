# Paper Domain — Plan 3: paperPack.renderNode (typed node → vault md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the paper `DomainPack` a deterministic `renderNode(node) → { relPath, content }` that writes a typed paper node to the autosci vault layout (`wiki/<type>/<slug>.md` with contract YAML frontmatter), proven by a render→validate round-trip: rendering every golden node's data and linting the result stays green (composing Plan 2's `validate`).

**Architecture:** `renderNode` is pure and contract-agnostic — it takes a typed node `{ type, slug, fields, body? }` and serializes `fields` as YAML frontmatter via `gray-matter` (already in the monorepo). The kernel-lint gate (Plan 2) remains the authority on whether `fields` satisfy the paper contract, so `renderNode` does not duplicate the schema. No LLM, no make-drivers change (the extractor that produces typed nodes, and the wiring, are later plans).

**Tech Stack:** TypeScript (pnpm monorepo), `gray-matter` (YAML frontmatter), `@apc/wiki-substrate` (validate round-trip), Vitest, the venv-gated substrate.

## Global Constraints

- `renderNode` is the ONLY `DomainPack` field added this plan. Do NOT add `nodeSchema`/`buildExtractorPrompt`/ingest (later plans).
- Output path layout: `wiki/<type>/<slug>.md` where `type ∈ { papers, modules, pipelines, pipeline_trials }` (matches `wiki-domains/paper/runtime/schema/entities.yaml` `dir:` values and the golden fixture).
- Frontmatter is YAML produced by `gray-matter.stringify(body, fields)` — `fields` is the contract frontmatter object verbatim (title/slug/type-specific). Key order/formatting need NOT match the golden byte-for-byte; the kernel parses YAML, so the round-trip asserts **lint-green**, not string equality.
- `renderNode` must NOT spawn Python or validate — validation is Plan 2's `validate`.
- `project-docs` pack gets NO `renderNode` (stays undefined).
- venv-gated tests skip cleanly on native Windows (Linux `bin/` venv) — reuse the `winRunnable` gate from `paper-pack.lint.int.test.ts`.
- Tests from repo root: `pnpm exec vitest run <path>`. Typecheck: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`.

## File Structure

- `packages/knowledge-harness/package.json` — add `gray-matter` dependency.
- `packages/knowledge-harness/src/domains/types.ts` — add optional `renderNode` + `PaperNode`/`RenderedNode` types.
- `packages/knowledge-harness/src/domains/paper-pack.ts` — implement `paperPack.renderNode`.
- `packages/knowledge-harness/src/domains/paper-pack.render.test.ts` — unit tests (non-venv).
- `packages/knowledge-harness/src/domains/paper-pack.render-validate.int.test.ts` — venv-gated round-trip.

---

### Task 1: `renderNode` + types + gray-matter dependency

**Files:**
- Modify: `packages/knowledge-harness/package.json`
- Modify: `packages/knowledge-harness/src/domains/types.ts`
- Modify: `packages/knowledge-harness/src/domains/paper-pack.ts`
- Test: `packages/knowledge-harness/src/domains/paper-pack.render.test.ts`

**Interfaces:**
- Produces:
  - `type PaperEntityType = 'papers' | 'modules' | 'pipelines' | 'pipeline_trials'`
  - `type TypedNode = { type: PaperEntityType; slug: string; fields: Record<string, unknown>; body?: string }`
  - `type RenderedNode = { relPath: string; content: string }`
  - `DomainPack.renderNode?(node: TypedNode): RenderedNode`
  - `paperPack.renderNode` (defined; `projectDocsPack.renderNode` stays undefined)

- [ ] **Step 1: Add the gray-matter dependency**

In `packages/knowledge-harness/package.json`, add to `dependencies` (match the version already resolved in the monorepo — `packages/vault` / `packages/harness` use `gray-matter`; use the SAME version range they declare, e.g. `"gray-matter": "^4.0.3"`):
```json
    "gray-matter": "^4.0.3",
```
Then install (links from the existing store — no new download): `pnpm install --config.minimumReleaseAge=0`
Verify: `node -e "require('gray-matter')"` exits 0 from repo root.

- [ ] **Step 2: Write the failing test**

```ts
// packages/knowledge-harness/src/domains/paper-pack.render.test.ts
import { describe, expect, test } from 'vitest'
import matter from 'gray-matter'
import { paperPack } from './paper-pack.js'
import { projectDocsPack } from './project-docs-pack.js'

describe('paperPack.renderNode', () => {
  test('writes wiki/<type>/<slug>.md with the fields as YAML frontmatter', () => {
    const node = { type: 'papers' as const, slug: 'attnembed-2402-05370', fields: {
      title: 'Attention as Robust Representation for Time Series Forecasting',
      slug: 'attnembed-2402-05370', year: 2024,
    } }
    const out = paperPack.renderNode!(node)
    expect(out.relPath).toBe('wiki/papers/attnembed-2402-05370.md')
    const parsed = matter(out.content)
    expect(parsed.data.title).toBe('Attention as Robust Representation for Time Series Forecasting')
    expect(parsed.data.slug).toBe('attnembed-2402-05370')
    expect(parsed.data.year).toBe(2024)
  })

  test('serializes nested objects and arrays (modules fields round-trip through YAML)', () => {
    const node = { type: 'modules' as const, slug: 'attention-embedding', fields: {
      title: 'Shared Self-Attention Embedding', slug: 'attention-embedding', kind: 'encoder', stage: 'encode',
      source_papers: ['attnembed-2402-05370'],
      evidence: [{ source: 'attnembed-2402-05370', metric: 'MSE', result: '-3.6% rel', confidence: 'high' }],
      input_contract: { modality: 'windowed_time_series' },
    } }
    const out = paperPack.renderNode!(node)
    expect(out.relPath).toBe('wiki/modules/attention-embedding.md')
    const d = matter(out.content).data
    expect(d.source_papers).toEqual(['attnembed-2402-05370'])
    expect(d.evidence[0].confidence).toBe('high')
    expect(d.input_contract.modality).toBe('windowed_time_series')
  })

  test('includes the body after the frontmatter when provided', () => {
    const out = paperPack.renderNode!({ type: 'papers' as const, slug: 's', fields: { title: 'T', slug: 's' }, body: 'Notes.' })
    expect(matter(out.content).content.trim()).toBe('Notes.')
  })

  test('project-docs pack has no renderNode', () => {
    expect(projectDocsPack.renderNode).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.render.test.ts`
Expected: FAIL — `paperPack.renderNode` is undefined, so `paperPack.renderNode!(node)` throws "is not a function".

- [ ] **Step 4: Extend the interface (types.ts)**

Add to `packages/knowledge-harness/src/domains/types.ts` (above `DomainPack`):
```ts
export type PaperEntityType = 'papers' | 'modules' | 'pipelines' | 'pipeline_trials'

/** A typed domain node ready to render. `fields` is the contract frontmatter (title/slug/type-specific);
 *  the kernel-lint gate (DomainPack.validate) is the authority on whether the fields satisfy the contract. */
export type TypedNode = { type: PaperEntityType; slug: string; fields: Record<string, unknown>; body?: string }

export type RenderedNode = { relPath: string; content: string }
```
Add to the `DomainPack` interface (after `validate`):
```ts
  /** Render a typed node to this domain's vault layout. paper → wiki/<type>/<slug>.md with YAML
   *  frontmatter; project-docs leaves this undefined (its existing render path stays). */
  renderNode?(node: TypedNode): RenderedNode
```

- [ ] **Step 5: Implement in paper-pack.ts**

Add the import at the top:
```ts
import matter from 'gray-matter'
```
Add `renderNode` to the `paperPack` object (after `validate`):
```ts
  renderNode(node) {
    // gray-matter.stringify writes `---\n<yaml>\n---\n<body>`. fields is the contract frontmatter
    // verbatim; the kernel (validate) judges contract-validity, so renderNode stays schema-agnostic.
    const content = matter.stringify(node.body ?? '', node.fields)
    return { relPath: `wiki/${node.type}/${node.slug}.md`, content }
  },
```
Update the `TypedNode`/`RenderedNode` type imports if your `DomainPack` import line needs them — they come from `./types.js`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.render.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Regression + typecheck**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/index.test.ts packages/knowledge-harness/src/domains/paper-pack.validate.test.ts`
Then: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: PASS, 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/knowledge-harness/package.json pnpm-lock.yaml packages/knowledge-harness/src/domains/types.ts packages/knowledge-harness/src/domains/paper-pack.ts packages/knowledge-harness/src/domains/paper-pack.render.test.ts
git commit -m "feat(knowledge-harness): paperPack.renderNode (typed node -> wiki/<type>/<slug>.md via gray-matter)"
```

---

### Task 2: venv-gated render→validate round-trip over the golden nodes

**Files:**
- Test: `packages/knowledge-harness/src/domains/paper-pack.render-validate.int.test.ts`

**Interfaces:**
- Consumes: `paperPack.renderNode` (Task 1), `paperPack.validate` (Plan 2), `PythonKernelAdapter`, the golden vault at `packages/wiki-substrate/test/fixtures/paper-golden/wiki`, `gray-matter`.
- Produces: nothing new — the integration proof that rendered nodes lint green.

- [ ] **Step 1: Write the venv-gated round-trip test**

```ts
// packages/knowledge-harness/src/domains/paper-pack.render-validate.int.test.ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { PythonKernelAdapter } from '@apc/wiki-substrate'
import { paperPack } from './paper-pack.js'
import type { PaperEntityType } from './types.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../../..')
const lockPath = join(repoRoot, 'core.lock')
const venvPython = existsSync(lockPath)
  ? join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python)
  : ''
const winRunnable = process.platform !== 'win32' || /[\\/]scripts[\\/]/i.test(venvPython)
const haveVenv = venvPython !== '' && existsSync(venvPython) && winRunnable
const d = haveVenv ? describe : describe.skip

const goldenWikiDir = join(repoRoot, 'packages/wiki-substrate/test/fixtures/paper-golden/wiki')
const TYPES: PaperEntityType[] = ['papers', 'modules', 'pipelines', 'pipeline_trials']

d('renderNode output passes kernel lint (render -> validate round-trip)', () => {
  const substrate = new PythonKernelAdapter({ python: venvPython, cwd: repoRoot })

  test('re-rendering every golden node from its parsed fields lints green', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-render-'))
    try {
      const wikiDir = join(root, 'wiki')
      // Render each golden node from its parsed frontmatter via paperPack.renderNode.
      for (const type of TYPES) {
        const dir = join(goldenWikiDir, type)
        if (!existsSync(dir)) continue
        for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
          const parsed = matter(readFileSync(join(dir, name), 'utf8'))
          const slug = String(parsed.data.slug ?? name.replace(/\.md$/, ''))
          const out = paperPack.renderNode!({ type, slug, fields: parsed.data, body: parsed.content })
          const abs = join(wikiDir, out.relPath.replace(/^wiki\//, ''))
          mkdirSync(dirname(abs), { recursive: true })
          writeFileSync(abs, out.content)
        }
      }
      // Edges are out of renderNode's scope — copy the golden edge set so the graph lints intact.
      const graphSrc = join(goldenWikiDir, 'graph')
      if (existsSync(graphSrc)) cpSync(graphSrc, join(wikiDir, 'graph'), { recursive: true })

      const report = await paperPack.validate!(wikiDir, { substrate })
      expect(report.issues).toEqual([])
      expect(report.ok).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
})
```

- [ ] **Step 2: Run it**

Run: `pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.render-validate.int.test.ts`
Expected: on a machine with the (runnable) venv — 1 test PASS (rendered golden lints green). On native Windows with the Linux venv — the file is reported skipped (exit 0), which is acceptable here; the controller runs the real proof under WSL.

> If the rendered vault lints with issues (not green), the renderNode frontmatter is losing/altering a field gray-matter can't round-trip (e.g. a date being re-quoted differently than the contract requires). Report DONE_WITH_CONCERNS with the exact lint issue lines — do NOT loosen the assertion.

- [ ] **Step 3: Suite + typecheck**

Run: `pnpm exec vitest run packages/knowledge-harness`
Then: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: PASS (the new int test skips on Windows), 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/knowledge-harness/src/domains/paper-pack.render-validate.int.test.ts
git commit -m "test(knowledge-harness): render->validate round-trip — rendered golden nodes lint green"
```

---

## Self-Review

**Spec coverage:** Plan 3's slice (§4.3 STAGING_WRITTEN render to `wiki/<type>/<slug>.md`; §4.4 typed node) — Task 1 adds `renderNode` + the `TypedNode` shape, Task 2 proves rendered output satisfies the kernel via the Plan-2 gate (render→validate). Ingest (autosci-read), the LLM extractor (prompt + nodeSchema), typed-edge merge, PolicyGuard domain-awareness, and the make-drivers wiring are explicitly DEFERRED to later plans — not gaps.

**Placeholder scan:** No TBD/TODO; every code step shows full code. The Task 2 skip-on-Windows conditional has an explicit no-fake-pass / DONE_WITH_CONCERNS rule.

**Type consistency:** `TypedNode`/`RenderedNode`/`PaperEntityType` defined in types.ts and used identically in paper-pack.ts and both tests; `renderNode?(node: TypedNode): RenderedNode` matches the impl.

---

## Follow-on plans (after Plan 3)

- **Plan 3b — Paper ingest + LLM typed-node extraction:** `WikiSubstrate` ingest (autosci-read) of `raw/`; a paper extractor (prompt injecting the paper contract entities/edges + autosci skill) + a `nodeSchema` producing `TypedNode[]`; typed-edge construction (`uses_module`/`pipeline_from_paper`/`alternative_to` → `wiki/graph/edges.jsonl`).
- **Plan 4 — Wire make-drivers + route papers + e2e:** `STAGING_WRITTEN` → `domainPack.renderNode`, `VALIDATED` → `domainPack.validate` (substrate from the resolved venv python); route `domain==='paper'`; package `wiki-domains/`; e2e + project-docs regression + UI graph smoke.

---

## Execution Handoff

(see skill — offered after save)
