# Knowledge Harness — Phase 2 (Worker + Lead + Writer LLM agents + Staging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use `- [ ]` tracking.

**Goal:** Phase 1의 fake driver를 **실제 LLM agent driver**로 교체한다. 6개 LLM agent
(ProjectDiscovery, ConversationHistoryReader, DocumentIntentClassifier, KnowledgeNodeExtractor,
WikiGraphLead, ObsidianWikiWriter)와 StagingVault를 구현하고, 이들을 `Driver` map으로 묶는
`makeDrivers(deps)` 팩토리로 `HarnessRunner`에 주입한다. 모든 테스트는 `FakeAgentRunner`로
canned JSON을 주입해 실제 LLM 호출 없이 검증한다.

**Architecture decision — driver factory, runner unchanged:** Phase 1의 `Driver` 계약
(`(ctx: RunnerContext) => Promise<DriverResult>`)은 그대로 둔다. LLM agent는 `vault`/`staging`/
`runner` 같은 더 풍부한 의존이 필요하므로, 그것을 closure로 잡는 `makeDrivers(deps)` 팩토리가
`Partial<Record<KhState, Driver>>`를 만들어 runner에 넘긴다. 이렇게 하면 `harness-runner.ts`는
한 줄도 안 바뀌고, Phase 1 테스트도 그대로 green.

**Tech Stack:** 기존 자산 재사용 — `AgentRunner`/`FakeAgentRunner` + `unwrapAgentJson`/
`parseStructured` (`@apc/llm-wiki`), `AgentIngestAdapter`→`NormalizedSession` (`@apc/agents`),
`VaultAdapter`(`@apc/vault`). 새 의존: `@apc/llm-wiki`, `@apc/agents`, `@apc/vault`를
`@apc/knowledge-harness/package.json`에 추가. Node `node:fs`/`node:child_process`(git diff). Vitest.

---

## File Structure

`@apc/shared` (파일 수정):
- `packages/shared/src/kh-schema.ts` — Phase 2 report 스키마 7종 추가
  (`ProjectDiscoveryReport`, `SourceInventoryReport`, `ConversationHistoryReport`,
  `DocumentIntentReport`, `GraphUpdatePlan`, `SharedPromotionPlan`, `StaleDocReport`).

`@apc/knowledge-harness`:
- `package.json` — deps에 `@apc/llm-wiki`, `@apc/agents`, `@apc/vault` 추가.
- `src/agents/llm-agent.ts` (+ test) — preamble+role prompt 조립 → runner.run → unwrap → parseStructured.
- `src/agents/preamble.ts` (+ test) — `harness/harness-rules.md` 로드 + 캐시.
- `src/agents/project-discovery.ts` — role prompt + 출력 스키마.
- `src/agents/conversation-history-reader.ts`
- `src/agents/document-intent-classifier.ts`
- `src/agents/knowledge-node-extractor.ts`
- `src/agents/wiki-graph-lead.ts`
- `src/agents/obsidian-wiki-writer.ts` — WritePlan을 staging에 실행(LLM 아님: 결정론 실행기).
- `src/staging/staging-vault.ts` (+ test) — vault→vault-staging 복사, git diff.
- `src/runtime/make-drivers.ts` (+ test) — agents+staging을 Driver map으로 묶음.
- `src/runtime/harness-pipeline.e2e.test.ts` — FakeAgentRunner로 전 구간 LLM 주파.

---

## Task 1: Phase-2 report 스키마 (shared/kh-schema.ts 확장)

**Files:** Modify `packages/shared/src/kh-schema.ts`; add cases to `packages/shared/src/kh-schema.test.ts`.

- [ ] **Step 1: Add failing test cases** — append inside the existing `describe('kh-schema')`:

```ts
  test('ProjectDiscoveryReport defaults lists to empty', () => {
    const r = KhProjectDiscoveryReportSchema.parse({ project_id: 'p1', generated_by: 'discovery' })
    expect(r.repos).toEqual([])
    expect(r.canonical_docs).toEqual([])
  })

  test('DocumentIntentReport carries classified docs with intent', () => {
    const r = KhDocumentIntentReportSchema.parse({
      generated_by: 'classifier',
      documents: [{ path: 'current.md', intent: 'canonical', confidence: 'high' }],
    })
    expect(r.documents[0].intent).toBe('canonical')
  })

  test('GraphUpdatePlan / SharedPromotionPlan / StaleDocReport parse with defaults', () => {
    expect(KhGraphUpdatePlanSchema.parse({ created_by: 'lead' }).node_ops).toEqual([])
    expect(KhSharedPromotionPlanSchema.parse({ created_by: 'lead' }).candidates).toEqual([])
    expect(KhStaleDocReportSchema.parse({ generated_by: 'lead' }).stale).toEqual([])
  })

  test('ConversationHistoryReport + SourceInventoryReport parse', () => {
    expect(KhSourceInventoryReportSchema.parse({ generated_by: 'reader' }).sources).toEqual([])
    expect(KhConversationHistoryReportSchema.parse({ generated_by: 'reader', session_id: 's1' }).highlights).toEqual([])
  })
```

- [ ] **Step 2: Run, see fail** — `pnpm exec vitest run packages/shared/src/kh-schema.test.ts`

- [ ] **Step 3: Append to `kh-schema.ts`** (after `RunStateSchema`):

```ts
export const KhProjectDiscoveryReportSchema = z.object({
  project_id: z.string(),
  generated_by: z.string(),
  summary: z.string().default(''),
  repos: z.array(z.object({ path: z.string(), kind: z.string().default('repo') })).default([]),
  canonical_docs: z.array(z.object({ path: z.string(), role: z.string().default('canonical') })).default([]),
  topics: z.array(z.string()).default([]),
})
export type KhProjectDiscoveryReport = z.infer<typeof KhProjectDiscoveryReportSchema>

export const KhSourceInventoryReportSchema = z.object({
  generated_by: z.string(),
  sources: z.array(z.object({
    source_id: z.string(), source_path: z.string(), source_kind: z.string().default('agent_session'),
    mtime: z.string().default(''),
  })).default([]),
})
export type KhSourceInventoryReport = z.infer<typeof KhSourceInventoryReportSchema>

export const KhConversationHistoryReportSchema = z.object({
  generated_by: z.string(),
  session_id: z.string(),
  work_summary: z.string().default(''),
  highlights: z.array(z.object({
    text: z.string(), kind: z.string().default('decision'), source_path: z.string().default(''),
  })).default([]),
  files_touched: z.array(z.string()).default([]),
  open_problems: z.array(z.string()).default([]),
})
export type KhConversationHistoryReport = z.infer<typeof KhConversationHistoryReportSchema>

export const KhDocumentIntentReportSchema = z.object({
  generated_by: z.string(),
  documents: z.array(z.object({
    path: z.string(),
    intent: z.string(),                 // canonical | reference | scratch | raw
    confidence: z.enum(['low', 'medium', 'high']).default('medium'),
    reason: z.string().default(''),
  })).default([]),
})
export type KhDocumentIntentReport = z.infer<typeof KhDocumentIntentReportSchema>

export const KhGraphUpdatePlanSchema = z.object({
  created_by: z.string(),
  node_ops: z.array(z.object({
    op: z.string(),                     // create | update | merge | link
    node_id: z.string(),
    based_on_proposals: z.array(z.string()).default([]),
    note: z.string().default(''),
  })).default([]),
})
export type KhGraphUpdatePlan = z.infer<typeof KhGraphUpdatePlanSchema>

export const KhSharedPromotionPlanSchema = z.object({
  created_by: z.string(),
  candidates: z.array(z.object({
    node_id: z.string(), reason: z.string().default(''),
    evidence_count: z.number().int().default(0), requires_human_review: z.boolean().default(true),
  })).default([]),
})
export type KhSharedPromotionPlan = z.infer<typeof KhSharedPromotionPlanSchema>

export const KhStaleDocReportSchema = z.object({
  generated_by: z.string(),
  stale: z.array(z.object({
    path: z.string(), reason: z.string().default(''),
    suggested_status: z.enum(['deprecated', 'superseded', 'review']).default('review'),
  })).default([]),
})
export type KhStaleDocReport = z.infer<typeof KhStaleDocReportSchema>
```

- [ ] **Step 4: Update test import** — add the new names to the import in `kh-schema.test.ts`.
- [ ] **Step 5: Run, see pass.** Commit:
  `git commit -m "feat(shared): kh-schema phase-2 report schemas (discovery/intent/lead plans)"`

---

## Task 2: package deps + preamble loader

**Files:** Modify `packages/knowledge-harness/package.json`; create `src/agents/preamble.ts` (+ test).

- [ ] **Step 1: Failing test** `src/agents/preamble.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { loadPreamble } from './preamble.js'

describe('preamble', () => {
  test('loads the shipped harness-rules.md and includes the Immutable Sources rule', () => {
    const p = loadPreamble()
    expect(p).toContain('Immutable Sources')
    expect(p).toContain('raw/')
  })
})
```

- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Add deps** to `package.json` dependencies: `"@apc/llm-wiki": "workspace:*"`, `"@apc/agents": "workspace:*"`, `"@apc/vault": "workspace:*"`. Run `pnpm install`.
- [ ] **Step 4: Implement** `src/agents/preamble.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// repo root = up from packages/knowledge-harness/src/agents/
const RULES_PATH = join(fileURLToPath(new URL('../../../../', import.meta.url)), 'harness', 'harness-rules.md')
let cached: string | undefined

/** The harness-rules.md preamble injected into every LLM agent prompt. */
export function loadPreamble(path: string = RULES_PATH): string {
  if (path === RULES_PATH && cached !== undefined) return cached
  const text = readFileSync(path, 'utf8')
  if (path === RULES_PATH) cached = text
  return text
}
```

- [ ] **Step 5: Run, see pass.** Commit:
  `git commit -m "feat(knowledge-harness): preamble loader + agent deps (@apc/llm-wiki,@apc/agents,@apc/vault)"`

---

## Task 3: LlmAgent base

**Files:** `src/agents/llm-agent.ts` (+ test).

- [ ] **Step 1: Failing test** `src/agents/llm-agent.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { LlmAgent } from './llm-agent.js'

const Out = z.object({ value: z.string() })

describe('LlmAgent', () => {
  test('assembles preamble+role+input, runs, unwraps, and parses to schema', async () => {
    const runner = new FakeAgentRunner([JSON.stringify({ value: 'hi' })])
    const agent = new LlmAgent({
      name: 'test-agent', role: 'You output JSON.', schema: Out, preamble: 'RULES-PREAMBLE',
    })
    const out = await agent.run({ runner, engine: 'codex', input: { topic: 'x' }, timeoutMs: 1000 })
    expect(out).toEqual({ value: 'hi' })
    const prompt = runner.calls[0].prompt
    expect(prompt).toContain('RULES-PREAMBLE')
    expect(prompt).toContain('You output JSON.')
    expect(prompt).toContain('"topic"')
    expect(runner.calls[0].agent).toBe('codex')
  })

  test('throws when the runner reports not-ok', async () => {
    const runner = new FakeAgentRunner([])  // first call returns ok:false
    const agent = new LlmAgent({ name: 't', role: 'r', schema: Out, preamble: 'P' })
    await expect(agent.run({ runner, engine: 'claude', input: {}, timeoutMs: 10 })).rejects.toThrow(/failed/)
  })
})
```

- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement** `src/agents/llm-agent.ts`:

```ts
import type { ZodType } from 'zod'
import type { AgentType } from '@apc/shared'
import { type AgentRunner, unwrapAgentJson, parseStructured } from '@apc/llm-wiki'

export type LlmAgentConfig<O> = { name: string; role: string; schema: ZodType<O>; preamble: string }
export type LlmRunArgs = { runner: AgentRunner; engine: AgentType; input: unknown; timeoutMs?: number }

/** Base for the 6 LLM agents: preamble + role + input JSON → runner → unwrap → parseStructured. */
export class LlmAgent<O> {
  constructor(private readonly cfg: LlmAgentConfig<O>) {}
  get name(): string { return this.cfg.name }

  buildPrompt(input: unknown): string {
    return [
      this.cfg.preamble,
      `## Role: ${this.cfg.name}`,
      this.cfg.role,
      '## Input',
      '```json',
      JSON.stringify(input, null, 2),
      '```',
      '## Output',
      'Respond with ONLY a single JSON object matching the required schema. No prose.',
    ].join('\n\n')
  }

  async run(args: LlmRunArgs): Promise<O> {
    const res = await args.runner.run({ agent: args.engine, prompt: this.buildPrompt(args.input), timeoutMs: args.timeoutMs ?? 180000 })
    if (!res.ok) throw new Error(`${this.cfg.name} failed: agent runner returned not-ok`)
    return parseStructured(unwrapAgentJson(res.output, args.engine), this.cfg.schema)
  }
}
```

- [ ] **Step 4: Run, see pass.** Commit:
  `git commit -m "feat(knowledge-harness): LlmAgent base — prompt assembly + parse to schema"`

---

## Task 4: 6 concrete agents (role prompts + output schema binding)

Each agent is a thin `LlmAgent` subclass/factory binding a role prompt + its output schema.
`obsidian-wiki-writer` is NOT an LlmAgent — it is a deterministic executor of an approved WritePlan
(see Task 6). The other 5 are LlmAgents.

**Files:** `src/agents/project-discovery.ts`, `conversation-history-reader.ts`,
`document-intent-classifier.ts`, `knowledge-node-extractor.ts`, `wiki-graph-lead.ts` (+ one combined test).

- [ ] **Step 1: Failing test** `src/agents/agents.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { makeProjectDiscovery, makeKnowledgeNodeExtractor } from './index.js'

describe('concrete agents', () => {
  test('ProjectDiscovery parses a ProjectDiscoveryReport', async () => {
    const runner = new FakeAgentRunner([JSON.stringify({ project_id: 'p1', generated_by: 'discovery', repos: [{ path: '/r' }] })])
    const out = await makeProjectDiscovery('PREAMBLE').run({ runner, engine: 'claude', input: { projectId: 'p1' } })
    expect(out.repos[0].path).toBe('/r')
  })

  test('KnowledgeNodeExtractor parses NodeProposal[]', async () => {
    const proposals = [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a.jsonl', evidence_type: 'decision' }],
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    }]
    const runner = new FakeAgentRunner([JSON.stringify({ proposals })])
    const out = await makeKnowledgeNodeExtractor('PREAMBLE').run({ runner, engine: 'claude', input: {} })
    expect(out.proposals[0].node.id).toBe('n1')
  })
})
```

- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement** each agent file as a `make<Name>(preamble)` factory returning `new LlmAgent({...})`.
  - `project-discovery.ts` → schema `KhProjectDiscoveryReportSchema`, role: "Scan the project; list repos, canonical docs, topics."
  - `conversation-history-reader.ts` → `KhConversationHistoryReportSchema`, role: "Summarize the agent session into work_summary, highlights(decisions), files_touched, open_problems. Every highlight cites a source_path."
  - `document-intent-classifier.ts` → `KhDocumentIntentReportSchema`, role: "Classify each doc as canonical|reference|scratch|raw with confidence+reason."
  - `knowledge-node-extractor.ts` → schema `z.object({ proposals: z.array(KhNodeProposalSchema) })`, role: "Extract ConceptNode/DecisionNode/ExperimentNode proposals. EVERY claim needs ≥1 evidence with source_path+source_id. Never invent evidence."
  - `wiki-graph-lead.ts` → schema `z.object({ graph_update_plan: KhGraphUpdatePlanSchema, shared_promotion_plan: KhSharedPromotionPlanSchema, stale_doc_report: KhStaleDocReportSchema, write_plan: KhWritePlanSchema })`, role: "Merge proposals: dedupe vs existing nodes, build a WritePlan that writes ONLY to vault-staging, never overwrites canonical directly (mode: proposal_only), never deletes."
  - Add a barrel `src/agents/index.ts` re-exporting the factories.
- [ ] **Step 4: Run, see pass.** Commit:
  `git commit -m "feat(knowledge-harness): 5 LLM agents (discovery/reader/classifier/extractor/lead)"`

---

## Task 5: StagingVault

**Files:** `src/staging/staging-vault.ts` (+ test).

- [ ] **Step 1: Failing test** `src/staging/staging-vault.test.ts` — temp vault dir, `prepare()` copies to staging, write a file into staging, `diff()` returns a non-empty patch mentioning the new file.

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StagingVault } from './staging-vault.js'

describe('StagingVault', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kh-stage-'))
    mkdirSync(join(root, 'vault'), { recursive: true })
    writeFileSync(join(root, 'vault', 'a.md'), '# A\n')
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  test('prepare copies vault → vault-staging', () => {
    const sv = new StagingVault(join(root, 'vault'), join(root, 'vault-staging'))
    sv.prepare()
    expect(existsSync(join(root, 'vault-staging', 'a.md'))).toBe(true)
  })

  test('writeDoc writes only into staging; diff() reports the new file', () => {
    const sv = new StagingVault(join(root, 'vault'), join(root, 'vault-staging'))
    sv.prepare()
    sv.writeDoc('concepts/n1.md', '# N1\n')
    expect(existsSync(join(root, 'vault', 'concepts', 'n1.md'))).toBe(false)  // real vault untouched
    const patch = sv.diff()
    expect(patch).toContain('n1.md')
  })
})
```

- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement** `src/staging/staging-vault.ts` — `cpSync` recursive copy for `prepare()`,
  `writeDoc(relPath, body)` mkdir+write under staging, `diff()` = `spawnSync('git', ['diff','--no-index','--',vault,staging])`
  returning stdout (git exits 1 when differences exist — treat code 0|1 as success, else throw).
- [ ] **Step 4: Run, see pass.** Commit:
  `git commit -m "feat(knowledge-harness): StagingVault — copy vault→staging + git diff --no-index"`

---

## Task 6: ObsidianWikiWriter (deterministic WritePlan executor)

**Files:** `src/agents/obsidian-wiki-writer.ts` (+ test).

Executes an approved `KhWritePlan` against a `StagingVault`. Honors `mode: proposal_only`
(writes a `.proposal.md` sibling instead of overwriting). Refuses any op whose path escapes
the staging vault or targets `raw/` (defense in depth — PolicyGuard is the primary guard in Phase 3).

- [ ] **Step 1: Failing test** — given a WritePlan with one `create_file` op and one `proposal_only`
  op, `apply()` creates the first file in staging and a `.proposal.md` for the second, returning an
  `AppliedWriteReport`-shaped summary `{ applied: string[], proposals: string[], skipped: string[] }`.
- [ ] **Step 2–4:** Implement, test green. Commit:
  `git commit -m "feat(knowledge-harness): ObsidianWikiWriter — deterministic WritePlan executor (staging only)"`

---

## Task 7: makeDrivers factory (wire agents → Driver map)

**Files:** `src/runtime/make-drivers.ts` (+ test).

`makeDrivers(deps)` returns `Partial<Record<KhState, Driver>>` where each Driver:
reads its input artifact(s) from `ctx.store`, calls the bound agent with `deps.runner`+`ctx.engine`,
and returns `{ artifacts: [{ name, data }] }`. The WRITE/STAGING states use StagingVault+Writer.

```ts
export type DriverDeps = {
  runner: AgentRunner
  vaultRoot: string
  stagingRoot: string
  preamble: string
  // Phase 3 will add: policy, validators
}
export function makeDrivers(deps: DriverDeps): Partial<Record<KhState, Driver>> { /* ... */ }
```

- [ ] **Step 1: Failing test** — with a `FakeAgentRunner` primed with one canned output per LLM state,
  build drivers, run them through `HarnessRunner.advance` over a temp run dir + temp vault, and assert
  the run reaches `HUMAN_REVIEW_REQUIRED` with a real `NodeProposal[]` artifact and a `diff.patch`.
- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement** each state's driver. STAGING_WRITTEN driver: `staging.prepare()`,
  read WRITE_PLAN_CREATED's WritePlan, `writer.apply(plan, staging)`, `staging.diff()` → write `diff.patch`.
- [ ] **Step 4: Run, see pass.** Export `makeDrivers` + agents from the package index.
- [ ] **Step 5:** Commit:
  `git commit -m "feat(knowledge-harness): makeDrivers — wire LLM agents+staging into the pipeline"`

---

## Task 8: End-to-end with shipped gates + FakeAgentRunner + full suite

**Files:** `src/runtime/harness-pipeline.e2e.test.ts`.

- [ ] **Step 1:** Load the shipped `harness/feature-gates.yml`, prime a `FakeAgentRunner` with one
  realistic canned JSON per LLM state (discovery → reader → classifier → extractor → lead),
  run `createRun` + `advance` over temp dirs, assert final state `HUMAN_REVIEW_REQUIRED`,
  `runs/RUN-*/artifacts/NODE_PROPOSALS_CREATED/*.json` contains evidence-bearing proposals,
  and `diff.patch` exists.
- [ ] **Step 2:** `pnpm test` — full suite green (Phase 1 tests unchanged, new Phase 2 tests pass).
- [ ] **Step 3:** Commit:
  `git commit -m "test(knowledge-harness): phase-2 e2e — LLM agents (faked) → staging diff → HUMAN_REVIEW_REQUIRED"`

---

## Phase 2 완료 기준

- 6 agent + StagingVault + makeDrivers 구현, 전부 `FakeAgentRunner`/temp-dir로 단위 테스트.
- `HarnessRunner`가 **실제 driver**로 CREATED→HUMAN_REVIEW_REQUIRED를 완주하고, 진짜
  `NodeProposal[]`(evidence 포함) → `WritePlan` → staging write → `diff.patch`를 남긴다.
- 실제 `vault/`는 불변(staging에만 write).
- `harness-runner.ts`는 Phase 1에서 한 줄도 바뀌지 않음(driver factory로만 주입).
- `pnpm test` green.

## Phase 2 비포함 (다음 Phase)

- PolicyGuard / SecretScanner / GraphIntegrity / validators / EvalReport (Phase 3).
- CLI bin + 데스크톱 IPC/UI + promote (Phase 4).
- 실제 CLI LLM 호출(이 단계는 FakeAgentRunner만; 실제 `CliAgentRunner` 연결은 Phase 4 표면에서).
