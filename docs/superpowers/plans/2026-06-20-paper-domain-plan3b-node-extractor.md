# Paper Domain — Plan 3b: paper node extractor (LLM → TypedNode[])

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `makePaperNodeExtractor` agent that, given source documents, emits `{ nodes: TypedNode[] }` conforming to the paper contract — by injecting the contract (entities/edges/conventions) into the LLM prompt and parsing the response with a `PaperNodeSchema`. This is the generation half that Plan 3's `renderNode` writes and Plan 2's `validate` gates.

**Architecture:** Mirror the existing `makeKnowledgeNodeExtractor` (an `LlmAgent` with a ROLE string + output Zod schema). The paper extractor's ROLE embeds the paper contract text (read from `wiki-domains/paper/runtime/schema/*.yaml`) so the model knows each entity type's fields, the edge vocabulary, and the slug rule. The output schema is the loose `TypedNode` shape (`{ type, slug, fields, body? }`) — contract-validity is NOT re-checked here; the kernel-lint `validate` (Plan 2) remains the authority, and `renderNode` (Plan 3) writes the result. No make-drivers wiring (Plan 4), no real ingest (the extractor takes already-read `sources`, like the existing extractor; autosci-read wiring is Plan 4).

**Tech Stack:** TypeScript (pnpm monorepo), Zod, the existing `LlmAgent`/`AgentRunner` seam, Vitest (fake runner — no real LLM, no venv).

## Global Constraints

- Output shape: `{ nodes: PaperNode[] }`, `PaperNode = { type: PaperEntityType; slug: string; fields: Record<string, unknown>; body?: string }` — structurally a `TypedNode` (domains/types.ts). `slug` matches the contract slug rule `^[a-z0-9]+(-[a-z0-9]+)*$` (from `conventions.yaml`).
- The extractor is schema-AGNOSTIC about `fields` (free-form record) — the contract text in the prompt guides the model; the kernel-lint gate judges validity. Do NOT build a per-type Zod schema for fields.
- `PaperEntityType = 'papers' | 'modules' | 'pipelines' | 'pipeline_trials'` (reuse the type from `domains/types.ts`; do not redefine).
- Reuse `LlmAgent` (agents/llm-agent.ts) — do NOT write a new agent runner. The prompt-building/parse is `LlmAgent`'s job; this plan only supplies role + schema.
- Tests use a FAKE `AgentRunner` (deterministic) — no real LLM, no venv. Tests from repo root: `pnpm exec vitest run <path>`. Typecheck: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`.

## File Structure

- `packages/knowledge-harness/src/agents/paper-node-extractor.ts` — `PaperNodeSchema`, `PaperExtractorOutputSchema`, `loadPaperContractText`, `makePaperNodeExtractor`.
- `packages/knowledge-harness/src/agents/paper-node-extractor.test.ts` — unit tests (schema + contract text + fake-runner extraction).
- `packages/knowledge-harness/src/agents/index.ts` — export the new agent.

---

### Task 1: `PaperNodeSchema` + `loadPaperContractText`

**Files:**
- Create: `packages/knowledge-harness/src/agents/paper-node-extractor.ts` (schema + loader only this task)
- Test: `packages/knowledge-harness/src/agents/paper-node-extractor.test.ts`

**Interfaces:**
- Consumes: `PaperEntityType` from `../domains/types.js`; `resolvePaperContractDir` from `../domains/paper-pack.js`.
- Produces:
  - `PaperNodeSchema` (Zod) parsing `{ type, slug, fields, body? }`.
  - `PaperExtractorOutputSchema` (Zod) = `{ nodes: PaperNode[] }`.
  - `type PaperNode = z.infer<typeof PaperNodeSchema>`
  - `loadPaperContractText(contractDir?: string): string` — concatenates `schema/entities.yaml`, `schema/edges.yaml`, `schema/conventions.yaml` under labeled headers; throws an actionable error if the dir is missing.

- [ ] **Step 1: Write the failing test**

```ts
// packages/knowledge-harness/src/agents/paper-node-extractor.test.ts
import { describe, expect, test } from 'vitest'
import { PaperNodeSchema, PaperExtractorOutputSchema, loadPaperContractText } from './paper-node-extractor.js'

describe('PaperNodeSchema', () => {
  test('parses a typed node with free-form fields', () => {
    const n = PaperNodeSchema.parse({ type: 'modules', slug: 'attention-embedding', fields: { title: 'X', kind: 'encoder' } })
    expect(n.type).toBe('modules')
    expect(n.fields.kind).toBe('encoder')
  })
  test('rejects an unknown entity type', () => {
    expect(() => PaperNodeSchema.parse({ type: 'widgets', slug: 'x', fields: {} })).toThrow()
  })
  test('rejects a slug that violates the convention', () => {
    expect(() => PaperNodeSchema.parse({ type: 'papers', slug: 'Not A Slug', fields: {} })).toThrow()
  })
  test('output schema defaults nodes to []', () => {
    expect(PaperExtractorOutputSchema.parse({}).nodes).toEqual([])
  })
})

describe('loadPaperContractText', () => {
  test('includes the entity types, edge types, and slug rule', () => {
    const text = loadPaperContractText()
    for (const t of ['papers', 'modules', 'pipelines', 'pipeline_trials']) expect(text).toContain(t)
    for (const e of ['uses_module', 'pipeline_from_paper', 'alternative_to']) expect(text).toContain(e)
    expect(text).toContain('slug_rule')
  })
  test('throws an actionable error when the contract dir is missing', () => {
    expect(() => loadPaperContractText('/definitely/not/here')).toThrow(/paper contract/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/agents/paper-node-extractor.test.ts`
Expected: FAIL — module `./paper-node-extractor.js` does not exist.

- [ ] **Step 3: Implement the schema + loader**

```ts
// packages/knowledge-harness/src/agents/paper-node-extractor.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { PaperEntityType } from '../domains/types.js'
import { resolvePaperContractDir } from '../domains/paper-pack.js'

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ENTITY_TYPES = ['papers', 'modules', 'pipelines', 'pipeline_trials'] as const

export const PaperNodeSchema = z.object({
  type: z.enum(ENTITY_TYPES),
  slug: z.string().regex(SLUG_RE),
  fields: z.record(z.unknown()),
  body: z.string().optional(),
})
export type PaperNode = z.infer<typeof PaperNodeSchema>

export const PaperExtractorOutputSchema = z.object({
  nodes: z.array(PaperNodeSchema).default([]),
})
export type PaperExtractorOutput = z.infer<typeof PaperExtractorOutputSchema>

/** Read the paper contract YAML (entities/edges/conventions) as a labeled text block for the prompt,
 *  so the model knows each entity's fields, the edge vocabulary, and the slug rule. */
export function loadPaperContractText(contractDir: string = resolvePaperContractDir()): string {
  if (!existsSync(contractDir)) {
    throw new Error(`paper contract not found at ${contractDir} — set APC_PAPER_CONTRACT_DIR or bundle wiki-domains/paper/runtime`)
  }
  const part = (rel: string) => `### ${rel}\n${readFileSync(join(contractDir, rel), 'utf8').trim()}`
  return [
    part('schema/entities.yaml'),
    part('schema/edges.yaml'),
    part('schema/conventions.yaml'),
  ].join('\n\n')
}

void (null as unknown as PaperEntityType) // keep the type import live until makePaperNodeExtractor (Task 2) uses it
```

> The trailing `void` line is a placeholder to keep `PaperEntityType` imported without an unused-import error until Task 2. If your lint/tsc does not flag unused type imports, drop both the import and that line and re-add the import in Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/agents/paper-node-extractor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/agents/paper-node-extractor.ts packages/knowledge-harness/src/agents/paper-node-extractor.test.ts
git commit -m "feat(knowledge-harness): PaperNodeSchema + loadPaperContractText (paper extractor foundation)"
```

---

### Task 2: `makePaperNodeExtractor` (contract-injecting LlmAgent)

**Files:**
- Modify: `packages/knowledge-harness/src/agents/paper-node-extractor.ts`
- Modify: `packages/knowledge-harness/src/agents/index.ts`
- Test: `packages/knowledge-harness/src/agents/paper-node-extractor.test.ts` (add an extraction test)

**Interfaces:**
- Consumes: `LlmAgent` from `./llm-agent.js`; `AgentRunner` from `@apc/llm-wiki` (for the fake in tests); the Task 1 schema + loader.
- Produces: `makePaperNodeExtractor(preamble: string, contractDir?: string): LlmAgent<PaperExtractorOutput>` — an `LlmAgent` named `paper-node-extractor` whose role embeds the paper contract and the extraction rules.

- [ ] **Step 1: Write the failing test (append to the test file)**

```ts
// append to packages/knowledge-harness/src/agents/paper-node-extractor.test.ts
import type { AgentRunner, RunInput, RunResult } from '@apc/llm-wiki'
import { makePaperNodeExtractor } from './paper-node-extractor.js'

describe('makePaperNodeExtractor', () => {
  const fakeRunner = (output: string): AgentRunner & { last?: RunInput } => {
    const r: AgentRunner & { last?: RunInput } = {
      run: async (input: RunInput): Promise<RunResult> => { r.last = input; return { ok: true, output, raw: output } },
    }
    return r
  }

  test('embeds the paper contract vocabulary in the prompt', async () => {
    const runner = fakeRunner('{"nodes":[]}')
    const agent = makePaperNodeExtractor('PREAMBLE')
    await agent.run({ runner, engine: 'claude', input: { sources: [] } })
    const prompt = runner.last!.prompt
    expect(prompt).toContain('paper-node-extractor')
    expect(prompt).toContain('modules')          // entity type from the contract
    expect(prompt).toContain('uses_module')      // edge type from the contract
  })

  test('parses the model output into typed nodes', async () => {
    const out = JSON.stringify({ nodes: [
      { type: 'papers', slug: 'attnembed-2402-05370', fields: { title: 'Attn', slug: 'attnembed-2402-05370', year: 2024 } },
    ] })
    const agent = makePaperNodeExtractor('PREAMBLE')
    const result = await agent.run({ runner: fakeRunner(out), engine: 'claude', input: { sources: [] } })
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('papers')
    expect(result.nodes[0].slug).toBe('attnembed-2402-05370')
    expect(result.nodes[0].fields.year).toBe(2024)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/agents/paper-node-extractor.test.ts`
Expected: FAIL — `makePaperNodeExtractor` is not exported.

- [ ] **Step 3: Implement makePaperNodeExtractor**

Replace the trailing `void (...)` placeholder line in `paper-node-extractor.ts` with:
```ts
import { LlmAgent } from './llm-agent.js'

const ROLE_HEAD = [
  'You are the paper-node-extractor agent. From the provided sources, extract typed wiki nodes for a',
  'research-paper knowledge graph. Emit ONLY nodes that the sources evidence — never invent papers,',
  'modules, pipelines, or trial results. Each node has: `type` (one of papers|modules|pipelines|',
  'pipeline_trials), a `slug` matching the slug rule, and `fields` = the frontmatter for that entity',
  "type per the contract below (include every required field). Put any prose description in `body`.",
  'Produce { "nodes": [...] }. The contract (entities, edges, conventions) is authoritative:',
].join(' ')

export function makePaperNodeExtractor(preamble: string, contractDir?: string): LlmAgent<PaperExtractorOutput> {
  const role = `${ROLE_HEAD}\n\n${loadPaperContractText(contractDir)}`
  return new LlmAgent({ name: 'paper-node-extractor', role, schema: PaperExtractorOutputSchema, preamble })
}
```
(Keep the `PaperEntityType` import only if still referenced; otherwise remove it — `ENTITY_TYPES` already drives the enum. If you removed the `void` placeholder line, also remove the now-unused `PaperEntityType` import.)

- [ ] **Step 4: Export from the agents barrel**

In `packages/knowledge-harness/src/agents/index.ts`, add:
```ts
export * from './paper-node-extractor.js'
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm exec vitest run packages/knowledge-harness/src/agents/paper-node-extractor.test.ts`
Then: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: PASS (8 tests total), 0 type errors.

- [ ] **Step 6: Suite (no regression)**

Run: `pnpm exec vitest run packages/knowledge-harness`
Expected: PASS (existing + new; venv-gated tests skip on Windows).

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge-harness/src/agents/paper-node-extractor.ts packages/knowledge-harness/src/agents/index.ts packages/knowledge-harness/src/agents/paper-node-extractor.test.ts
git commit -m "feat(knowledge-harness): makePaperNodeExtractor — contract-injecting LlmAgent -> TypedNode[]"
```

---

## Self-Review

**Spec coverage:** Plan 3b's slice (§3 paper extractor prompt+schema; §4.4 typed node) — Task 1 defines the typed-node output schema + the contract-as-prompt loader; Task 2 builds the contract-injecting `LlmAgent` and proves (fake runner) that the prompt carries the contract vocabulary and the output parses to typed nodes. Real ingest (autosci-read of `raw/`), typed-edge construction (`wiki/graph/edges.jsonl`), PolicyGuard domain-awareness, and the make-drivers wiring are DEFERRED to Plan 4 — not gaps.

**Placeholder scan:** Code steps are complete. The one intentional placeholder (`void` line keeping a type import live across tasks) is called out with removal instructions; it is not a requirement placeholder.

**Type consistency:** `PaperNode = z.infer<PaperNodeSchema>` is structurally `TypedNode` ({type, slug, fields, body?}); `PaperExtractorOutput = { nodes: PaperNode[] }`; `makePaperNodeExtractor(...): LlmAgent<PaperExtractorOutput>` matches `LlmAgent`'s generic and `.run(...)` returns `PaperExtractorOutput`.

---

## Follow-on (Plan 4)

Wire it all: materialize `raw/` (autosci-read ingest, extend `WikiSubstrate.checkSources` → parsed text); make-drivers selects the paper pack when `domain==='paper'` — `NODE_PROPOSALS_CREATED` runs `makePaperNodeExtractor`, `STAGING_WRITTEN` calls `domainPack.renderNode` per node + builds `wiki/graph/edges.jsonl` from typed edges, `VALIDATED` calls `domainPack.validate`; route papers; package `wiki-domains/`; e2e (papers fixture → HUMAN_REVIEW + index/graph) + project-docs regression + UI graph smoke.

---

## Execution Handoff

(see skill — offered after save)
