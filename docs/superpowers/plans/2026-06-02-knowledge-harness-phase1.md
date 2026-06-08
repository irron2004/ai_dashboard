# Knowledge Harness — Phase 1 (계약 + 런타임 골격) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@apc/knowledge-harness` 패키지의 런타임 골격을 만든다 — 12-state 머신을 구동하고, feature gate로 단계를 통제하며, run-당 artifact를 `runs/RUN-*/`에 영속하고, 실패/중단 지점부터 resume 가능한 `HarnessRunner`. 실제 LLM agent는 Phase 2에서 주입한다(이 단계는 fake driver로 전 구간을 검증).

**Architecture:** 계약 스키마(Zod)는 `@apc/shared/kh-schema.ts`에 두어 런타임·테스트·향후 데스크톱 렌더러가 공유한다. 런타임은 순수 함수형 state machine + fs 기반 artifact store + lockfile + 평평한 feature-gate 파서 + driver-주입형 orchestrator로 구성한다. driver는 `state → Driver` 맵으로 주입되므로 Phase 1 테스트는 canned artifact를 반환하는 fake driver를, Phase 2는 실제 agent를 꽂는다.

**Tech Stack:** TypeScript(ESM, `.js` 지정자), Zod ^3.23, Node 24 내장 `node:fs`/`node:path`, Vitest ^2. 빌드 스텝 없음(패키지 `main: ./src/index.ts`). 외부 의존 추가 없음.

---

## File Structure

`@apc/shared` (기존 패키지, 파일 추가):
- `packages/shared/src/kh-schema.ts` — Zod 계약: `KhStateSchema`, `KhNodeProposalSchema`, `KhWritePlanSchema`, `KhEvalReportSchema`, `RunStateSchema` (+ `z.infer` 타입). **책임:** harness 전 구간의 데이터 계약 한 곳.
- `packages/shared/src/kh-schema.test.ts` — round-trip 단위 테스트.
- `packages/shared/src/index.ts` — `export * from './kh-schema.js'` 추가(수정).

새 패키지 `@apc/knowledge-harness` (`packages/knowledge-harness/`):
- `package.json` — name/type/main/deps.
- `src/index.ts` — public re-export.
- `src/runtime/run-state-machine.ts` (+ `.test.ts`) — 상태 목록, 파이프라인 순서+gate, 전이 합법성. **책임:** "다음 상태가 무엇이고 합법인가"만.
- `src/runtime/feature-gate.ts` (+ `.test.ts`) — 평평한 `key: bool` 파서 + `FeatureGate.gate(name)`. **책임:** 자동화 on/off 판정만.
- `src/runtime/run-artifact-store.ts` (+ `.test.ts`) — `runs/RUN-*/` fs 읽기·쓰기. **책임:** 영속화만.
- `src/runtime/run-lock.ts` (+ `.test.ts`) — 프로젝트당 1 run lockfile. **책임:** 동시성 가드만.
- `src/runtime/harness-runner.ts` (+ `.test.ts`) — driver 주입형 orchestrator. **책임:** 상태 진행·gate 확인·영속·resume 조율만.

설정/문서 파일(repo 루트):
- `harness/feature-gates.yml` — 설계 §7의 22개 플래그.
- `harness/harness-rules.md` — 설계 §6 규칙 전문(LLM preamble; Phase 2에서 사용, Phase 1은 배치만).
- `harness/run-state-machine.yml` — 문서용 사본(실제 source of truth는 TS).

---

## Task 1: `kh-schema` 계약 (shared)

**Files:**
- Create: `packages/shared/src/kh-schema.ts`
- Test: `packages/shared/src/kh-schema.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/kh-schema.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  KhStateSchema, KhNodeProposalSchema, KhWritePlanSchema, KhEvalReportSchema, RunStateSchema,
} from './kh-schema.js'

describe('kh-schema', () => {
  test('KhState accepts the 12 pipeline states and rejects others', () => {
    expect(KhStateSchema.parse('CREATED')).toBe('CREATED')
    expect(KhStateSchema.parse('HUMAN_REVIEW_REQUIRED')).toBe('HUMAN_REVIEW_REQUIRED')
    expect(() => KhStateSchema.parse('NOPE')).toThrow()
  })

  test('NodeProposal applies evidence/claim defaults', () => {
    const p = KhNodeProposalSchema.parse({
      proposal_id: 'NP-1', proposal_type: 'create_or_update_node', proposed_by: 'reader',
      created_at: '2026-06-02T00:00:00+09:00',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a.jsonl', evidence_type: 'decision' }],
    })
    expect(p.node.scope).toBe('project')
    expect(p.claim_policy.minimum_evidence_count).toBe(1)
    expect(p.review.requires_human_review).toBe(true)
  })

  test('WritePlan defaults forbidden-op flags to false and mode to apply', () => {
    const wp = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [{ op: 'create_file', path: '_shared/concepts/x.md' }],
    })
    expect(wp.target_vault).toBe('vault-staging')
    expect(wp.operations[0].mode).toBe('apply')
    expect(wp.forbidden_operations_checked.raw_modified).toBe(false)
  })

  test('EvalReport fills all metric groups with zeros', () => {
    const e = KhEvalReportSchema.parse({})
    expect(e.coverage.raw_sources_total).toBe(0)
    expect(e.safety.raw_modified).toBe(false)
  })

  test('RunState round-trips through parse', () => {
    const rs = RunStateSchema.parse({
      runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED',
      history: [{ state: 'CREATED', at: '2026-06-02T00:00:00Z' }],
    })
    expect(rs.artifacts).toEqual({})
    expect(rs.history[0].state).toBe('CREATED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/kh-schema.test.ts`
Expected: FAIL — `Cannot find module './kh-schema.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/kh-schema.ts`:

```ts
import { z } from 'zod'

export const KhStateSchema = z.enum([
  'CREATED', 'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
  'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN',
  'VALIDATED', 'HUMAN_REVIEW_REQUIRED', 'MERGED', 'FAILED',
])
export type KhState = z.infer<typeof KhStateSchema>

const Confidence = z.enum(['low', 'medium', 'high'])
const Risk = z.enum(['low', 'medium', 'high'])

export const KhEvidenceSchema = z.object({
  evidence_id: z.string(),
  source_id: z.string(),
  source_path: z.string(),
  evidence_type: z.string(),
  quote_or_summary: z.string().default(''),
  confidence: Confidence.default('medium'),
})
export type KhEvidence = z.infer<typeof KhEvidenceSchema>

export const KhClaimSchema = z.object({
  claim_id: z.string(),
  text: z.string(),
  claim_type: z.string().default('observation'),
  confidence: Confidence.default('medium'),
  inference: z.boolean().default(false),
  inference_note: z.string().optional(),
  evidence_ids: z.array(z.string()).default([]),
})
export type KhClaim = z.infer<typeof KhClaimSchema>

export const KhNodeProposalSchema = z.object({
  proposal_id: z.string(),
  proposal_type: z.string().default('create_or_update_node'),
  proposed_by: z.string(),
  source_type: z.string().default('agent_session'),
  created_at: z.string(),
  node: z.object({
    id: z.string(),
    type: z.string(),                 // ConceptNode | DecisionNode | ExperimentNode | ...
    scope: z.string().default('project'),  // project | shared_candidate | shared
    title: z.string(),
    summary: z.string().default(''),
    project_ids: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  }),
  claims: z.array(KhClaimSchema).default([]),
  evidence: z.array(KhEvidenceSchema).default([]),
  claim_policy: z.object({
    minimum_evidence_count: z.number().int().default(1),
    requires_direct_source: z.boolean().default(true),
    allow_inference: z.boolean().default(true),
    inference_note_required: z.boolean().default(true),
  }).default({}),
  actions: z.array(z.object({
    action_type: z.string(),
    target_path: z.string(),
    link: z.string().optional(),
  })).default([]),
  risk: z.object({ level: Risk.default('low'), reason: z.string().default('') }).default({}),
  review: z.object({ requires_human_review: z.boolean().default(true), reviewer_question: z.string().default('') }).default({}),
})
export type KhNodeProposal = z.infer<typeof KhNodeProposalSchema>

export const KhWriteOpSchema = z.object({
  op: z.string(),                     // create_file | update_frontmatter | add_backlink | append_section
  path: z.string(),
  source_proposal: z.string().optional(),
  content_template: z.string().optional(),
  content: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
  link: z.string().optional(),
  mode: z.enum(['apply', 'proposal_only']).default('apply'),
  risk: Risk.default('low'),
  reason: z.string().optional(),
})
export type KhWriteOp = z.infer<typeof KhWriteOpSchema>

export const KhWritePlanSchema = z.object({
  write_plan_id: z.string(),
  created_by: z.string(),
  based_on_proposals: z.array(z.string()).default([]),
  target_vault: z.string().default('vault-staging'),
  requires_human_approval: z.boolean().default(true),
  operations: z.array(KhWriteOpSchema).default([]),
  forbidden_operations_checked: z.object({
    raw_modified: z.boolean().default(false),
    delete_operation: z.boolean().default(false),
    canonical_direct_overwrite: z.boolean().default(false),
  }).default({}),
  validation_required: z.array(z.string()).default([]),
})
export type KhWritePlan = z.infer<typeof KhWritePlanSchema>

export const KhEvalReportSchema = z.object({
  coverage: z.object({
    raw_sources_total: z.number().default(0),
    raw_sources_classified: z.number().default(0),
    task_mapped_sources: z.number().default(0),
    unmapped_sources: z.number().default(0),
  }).default({}),
  evidence_quality: z.object({
    node_proposals_total: z.number().default(0),
    proposals_without_evidence: z.number().default(0),
    proposals_with_minimum_evidence: z.number().default(0),
    inference_without_note: z.number().default(0),
  }).default({}),
  graph_quality: z.object({
    orphan_nodes: z.number().default(0),
    duplicate_candidates: z.number().default(0),
    broken_links: z.number().default(0),
    missing_backlinks: z.number().default(0),
  }).default({}),
  safety: z.object({
    raw_modified: z.boolean().default(false),
    secret_warnings: z.number().default(0),
    canonical_direct_overwrite_attempts: z.number().default(0),
    delete_attempts: z.number().default(0),
  }).default({}),
  usefulness: z.object({
    current_update_proposals: z.number().default(0),
    next_task_candidates: z.number().default(0),
    shared_promotion_candidates: z.number().default(0),
  }).default({}),
})
export type KhEvalReport = z.infer<typeof KhEvalReportSchema>

export const RunStateSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  engine: z.string(),
  state: KhStateSchema,
  history: z.array(z.object({ state: KhStateSchema, at: z.string() })).default([]),
  artifacts: z.record(z.array(z.string())).default({}),  // state -> relative artifact paths under the run dir
  error: z.string().optional(),
})
export type RunState = z.infer<typeof RunStateSchema>
```

- [ ] **Step 4: Wire the export**

Edit `packages/shared/src/index.ts` — append after the existing exports:

```ts
export * from './kh-schema.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/kh-schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/kh-schema.ts packages/shared/src/kh-schema.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): kh-schema — knowledge-harness contracts (NodeProposal/WritePlan/EvalReport/RunState)"
```

---

## Task 2: `@apc/knowledge-harness` 패키지 스캐폴드

**Files:**
- Create: `packages/knowledge-harness/package.json`
- Create: `packages/knowledge-harness/src/index.ts`
- Test: `packages/knowledge-harness/src/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/smoke.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { HARNESS_VERSION } from './index.js'

describe('knowledge-harness package', () => {
  test('exposes a version constant', () => {
    expect(HARNESS_VERSION).toBe('0.0.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/smoke.test.ts`
Expected: FAIL — module/index not found.

- [ ] **Step 3: Create package.json**

`packages/knowledge-harness/package.json`:

```json
{
  "name": "@apc/knowledge-harness",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@apc/shared": "workspace:*",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 4: Create index.ts**

`packages/knowledge-harness/src/index.ts`:

```ts
export const HARNESS_VERSION = '0.0.0'
```

- [ ] **Step 5: Install so pnpm links the new workspace package**

Run: `pnpm install`
Expected: lockfile updates; `@apc/knowledge-harness` linked. No errors.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/smoke.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge-harness/package.json packages/knowledge-harness/src/index.ts packages/knowledge-harness/src/smoke.test.ts pnpm-lock.yaml
git commit -m "feat(knowledge-harness): scaffold @apc/knowledge-harness package"
```

---

## Task 3: RunStateMachine

**Files:**
- Create: `packages/knowledge-harness/src/runtime/run-state-machine.ts`
- Test: `packages/knowledge-harness/src/runtime/run-state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/runtime/run-state-machine.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { PIPELINE, canTransition, assertTransition, stepFor } from './run-state-machine.js'

describe('run-state-machine', () => {
  test('pipeline is the 9-step happy path ending at HUMAN_REVIEW_REQUIRED', () => {
    expect(PIPELINE.map(s => s.to)).toEqual([
      'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED', 'NODE_PROPOSALS_CREATED',
      'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED',
    ])
  })

  test('forward steps along the pipeline are legal; skips are not', () => {
    expect(canTransition('CREATED', 'PROJECT_SCANNED')).toBe(true)
    expect(canTransition('NODE_PROPOSALS_CREATED', 'LEAD_MERGED')).toBe(true)
    expect(canTransition('CREATED', 'LEAD_MERGED')).toBe(false)
    expect(canTransition('SOURCES_EXTRACTED', 'CREATED')).toBe(false)
  })

  test('any state may fail, and human review may merge', () => {
    expect(canTransition('STAGING_WRITTEN', 'FAILED')).toBe(true)
    expect(canTransition('HUMAN_REVIEW_REQUIRED', 'MERGED')).toBe(true)
    expect(canTransition('CREATED', 'MERGED')).toBe(false)
  })

  test('assertTransition throws on illegal transition', () => {
    expect(() => assertTransition('CREATED', 'LEAD_MERGED')).toThrow(/illegal transition/)
  })

  test('stepFor returns the gate attached to a target state', () => {
    expect(stepFor('SOURCES_EXTRACTED')?.gate).toBe('enable_conversation_history_reader')
    expect(stepFor('PROJECT_SCANNED')?.gate).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/run-state-machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/knowledge-harness/src/runtime/run-state-machine.ts`:

```ts
import type { KhState } from '@apc/shared'

/** Happy-path pipeline: each step names the target state and the feature gate (if any) that must be open. */
export type PipelineStep = { to: KhState; gate?: string }

export const PIPELINE: PipelineStep[] = [
  { to: 'PROJECT_SCANNED' },
  { to: 'SOURCES_EXTRACTED', gate: 'enable_conversation_history_reader' },
  { to: 'DOCUMENTS_CLASSIFIED', gate: 'auto_classify_documents' },
  { to: 'NODE_PROPOSALS_CREATED', gate: 'auto_create_node_proposals' },
  { to: 'LEAD_MERGED' },
  { to: 'WRITE_PLAN_CREATED', gate: 'auto_create_write_plan' },
  { to: 'STAGING_WRITTEN', gate: 'auto_write_to_staging' },
  { to: 'VALIDATED' },
  { to: 'HUMAN_REVIEW_REQUIRED' },
]

const ORDER = new Map<KhState, number>(
  (['CREATED', ...PIPELINE.map(s => s.to)] as KhState[]).map((s, i) => [s, i]),
)

/** Legal forward step along the pipeline, plus any → FAILED, and HUMAN_REVIEW_REQUIRED → MERGED. */
export function canTransition(from: KhState, to: KhState): boolean {
  if (to === 'FAILED') return true
  if (from === 'HUMAN_REVIEW_REQUIRED' && to === 'MERGED') return true
  const a = ORDER.get(from), b = ORDER.get(to)
  return a !== undefined && b !== undefined && b === a + 1
}

export function assertTransition(from: KhState, to: KhState): void {
  if (!canTransition(from, to)) throw new Error(`illegal transition ${from} -> ${to}`)
}

/** The pipeline step whose target is `to` (for gate lookup / driver dispatch). */
export function stepFor(to: KhState): PipelineStep | undefined {
  return PIPELINE.find(s => s.to === to)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/run-state-machine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-harness/src/runtime/run-state-machine.ts packages/knowledge-harness/src/runtime/run-state-machine.test.ts
git commit -m "feat(knowledge-harness): run-state-machine — 12 states, pipeline order + gates, transition legality"
```

---

## Task 4: FeatureGate

**Files:**
- Create: `packages/knowledge-harness/src/runtime/feature-gate.ts`
- Test: `packages/knowledge-harness/src/runtime/feature-gate.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/runtime/feature-gate.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { parseFeatureGates, FeatureGate } from './feature-gate.js'

const SAMPLE = `# comment
features:
  auto_classify_documents: true
  auto_write_to_real_vault: false
  enable_conversation_history_reader: true

  auto_delete: false
`

describe('feature-gate', () => {
  test('parses the flat key:bool map, ignoring comments/blank/header', () => {
    expect(parseFeatureGates(SAMPLE)).toEqual({
      auto_classify_documents: true,
      auto_write_to_real_vault: false,
      enable_conversation_history_reader: true,
      auto_delete: false,
    })
  })

  test('gate() returns the flag; unknown flags fail safe to false', () => {
    const g = new FeatureGate(parseFeatureGates(SAMPLE))
    expect(g.gate('auto_classify_documents')).toBe(true)
    expect(g.gate('auto_write_to_real_vault')).toBe(false)
    expect(g.gate('does_not_exist')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/feature-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/knowledge-harness/src/runtime/feature-gate.ts`:

```ts
import { readFileSync } from 'node:fs'

/** Parse the flat `key: true|false` feature-gates file (a YAML subset — no nesting beyond the `features:` header). */
export function parseFeatureGates(text: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line === 'features:') continue
    const m = line.match(/^([A-Za-z0-9_]+):\s*(true|false)\s*$/)
    if (m) out[m[1]] = m[2] === 'true'
  }
  return out
}

export class FeatureGate {
  constructor(private readonly flags: Record<string, boolean>) {}

  static fromFile(path: string): FeatureGate {
    return new FeatureGate(parseFeatureGates(readFileSync(path, 'utf8')))
  }

  /** Unknown flags default to false (fail safe — never auto-enable something undeclared). */
  gate(name: string): boolean {
    return this.flags[name] === true
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/feature-gate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-harness/src/runtime/feature-gate.ts packages/knowledge-harness/src/runtime/feature-gate.test.ts
git commit -m "feat(knowledge-harness): feature-gate — flat yml parser, fail-safe gate()"
```

---

## Task 5: RunArtifactStore

**Files:**
- Create: `packages/knowledge-harness/src/runtime/run-artifact-store.ts`
- Test: `packages/knowledge-harness/src/runtime/run-artifact-store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/runtime/run-artifact-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStateSchema } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'

describe('RunArtifactStore', () => {
  let dir: string
  let store: RunArtifactStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-run-')); store = new RunArtifactStore(dir) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('init creates the run subdirectories', () => {
    store.init()
    for (const d of ['inputs', 'artifacts', 'proposals', 'validation']) {
      expect(existsSync(join(dir, d))).toBe(true)
    }
  })

  test('saveRunState / loadRunState round-trips via schema', () => {
    const rs = RunStateSchema.parse({ runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED' })
    store.saveRunState(rs)
    expect(store.loadRunState()).toEqual(rs)
  })

  test('writeArtifact persists JSON under artifacts/<STATE>/ and returns its relative path; readArtifact reads it back', () => {
    const rel = store.writeArtifact('PROJECT_SCANNED', 'report', { hello: 'world' })
    expect(rel).toBe(join('artifacts', 'PROJECT_SCANNED', 'report.json'))
    expect(store.readArtifact(rel)).toEqual({ hello: 'world' })
  })

  test('exists reflects whether run.json is present', () => {
    expect(store.exists()).toBe(false)
    store.saveRunState(RunStateSchema.parse({ runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED' }))
    expect(store.exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/run-artifact-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/knowledge-harness/src/runtime/run-artifact-store.ts`:

```ts
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { RunStateSchema, type RunState, type KhState } from '@apc/shared'

/** Reads/writes one run directory: runs/RUN-<id>/. The only component that touches the run's filesystem. */
export class RunArtifactStore {
  /** @param runDir absolute path to the run directory. */
  constructor(private readonly runDir: string) {}

  init(): void {
    for (const d of ['inputs', 'artifacts', 'proposals', 'validation']) {
      mkdirSync(join(this.runDir, d), { recursive: true })
    }
  }

  saveRunState(state: RunState): void {
    mkdirSync(this.runDir, { recursive: true })
    writeFileSync(join(this.runDir, 'run.json'), JSON.stringify(state, null, 2))
  }

  loadRunState(): RunState {
    return RunStateSchema.parse(JSON.parse(readFileSync(join(this.runDir, 'run.json'), 'utf8')))
  }

  /** Persist one artifact as artifacts/<STATE>/<name>.json; returns its path relative to runDir. */
  writeArtifact(state: KhState, name: string, data: unknown): string {
    mkdirSync(join(this.runDir, 'artifacts', state), { recursive: true })
    const rel = join('artifacts', state, `${name}.json`)
    writeFileSync(join(this.runDir, rel), JSON.stringify(data, null, 2))
    return rel
  }

  readArtifact<T = unknown>(rel: string): T {
    return JSON.parse(readFileSync(join(this.runDir, rel), 'utf8')) as T
  }

  exists(): boolean {
    return existsSync(join(this.runDir, 'run.json'))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/run-artifact-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-harness/src/runtime/run-artifact-store.ts packages/knowledge-harness/src/runtime/run-artifact-store.test.ts
git commit -m "feat(knowledge-harness): run-artifact-store — fs persistence for runs/RUN-*/"
```

---

## Task 6: RunLock

**Files:**
- Create: `packages/knowledge-harness/src/runtime/run-lock.ts`
- Test: `packages/knowledge-harness/src/runtime/run-lock.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/runtime/run-lock.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunLock } from './run-lock.js'

describe('RunLock', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-lock-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('acquire then a second acquire for the same project throws', () => {
    const a = new RunLock(dir, 'p1')
    a.acquire('RUN-1')
    const b = new RunLock(dir, 'p1')
    expect(() => b.acquire('RUN-2')).toThrow(/already in progress/)
  })

  test('release frees the lock so a new run can acquire', () => {
    const a = new RunLock(dir, 'p1')
    a.acquire('RUN-1')
    a.release()
    const b = new RunLock(dir, 'p1')
    expect(() => b.acquire('RUN-2')).not.toThrow()
  })

  test('different projects do not contend', () => {
    new RunLock(dir, 'p1').acquire('RUN-1')
    expect(() => new RunLock(dir, 'p2').acquire('RUN-2')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/run-lock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/knowledge-harness/src/runtime/run-lock.ts`:

```ts
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** One run per project: an exclusive lockfile holding the owning runId. */
export class RunLock {
  private readonly file: string
  constructor(lockDir: string, projectId: string) { this.file = join(lockDir, `${projectId}.lock`) }

  acquire(runId: string): void {
    mkdirSync(dirname(this.file), { recursive: true })
    try {
      writeFileSync(this.file, runId, { flag: 'wx' })  // wx: fail if it already exists (atomic)
    } catch {
      const owner = existsSync(this.file) ? readFileSync(this.file, 'utf8') : 'unknown'
      throw new Error(`run already in progress for this project (owner=${owner})`)
    }
  }

  release(): void {
    if (existsSync(this.file)) rmSync(this.file)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/run-lock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-harness/src/runtime/run-lock.ts packages/knowledge-harness/src/runtime/run-lock.test.ts
git commit -m "feat(knowledge-harness): run-lock — one run per project (atomic lockfile)"
```

---

## Task 7: HarnessRunner (driver-주입 orchestrator + resume)

**Files:**
- Create: `packages/knowledge-harness/src/runtime/harness-runner.ts`
- Test: `packages/knowledge-harness/src/runtime/harness-runner.test.ts`

The runner exposes `createRun()` (state=CREATED, persisted) and `advance(store)` which walks `PIPELINE` from the run's current state, checking each step's gate, invoking the injected driver, persisting its artifacts, and saving `run.json` after every step. A closed gate stops the walk at the current state; a driver throw records `FAILED`. `advance` resumes correctly from any persisted state because it derives the start index from `runState.state`.

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/runtime/harness-runner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KhState } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner, type Driver } from './harness-runner.js'

const ALL_OPEN = {
  enable_conversation_history_reader: true, auto_classify_documents: true,
  auto_create_node_proposals: true, auto_create_write_plan: true, auto_write_to_staging: true,
}

// A driver per pipeline state that emits one named artifact echoing its state.
function fakeDrivers(): Partial<Record<KhState, Driver>> {
  const states: KhState[] = ['PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
    'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED']
  const map: Partial<Record<KhState, Driver>> = {}
  for (const s of states) map[s] = async () => ({ artifacts: [{ name: 'out', data: { state: s } }] })
  return map
}

describe('HarnessRunner', () => {
  let dir: string
  let store: RunArtifactStore
  const now = () => '2026-06-02T00:00:00Z'
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-runner-')); store = new RunArtifactStore(dir) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('createRun persists a CREATED run', () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: {}, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    expect(store.loadRunState().state).toBe('CREATED')
  })

  test('advance walks the full pipeline to HUMAN_REVIEW_REQUIRED, persisting each artifact', async () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(rs.history.map(h => h.state)).toEqual([
      'CREATED', 'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED', 'NODE_PROPOSALS_CREATED',
      'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED',
    ])
    expect(store.readArtifact(rs.artifacts['NODE_PROPOSALS_CREATED'][0])).toEqual({ state: 'NODE_PROPOSALS_CREATED' })
  })

  test('a closed gate stops the walk at the prior state', async () => {
    const gates = new FeatureGate({ ...ALL_OPEN, auto_create_node_proposals: false })
    const runner = new HarnessRunner({ gates, drivers: fakeDrivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('DOCUMENTS_CLASSIFIED')  // stopped before NODE_PROPOSALS_CREATED
  })

  test('reopening the gate and calling advance again resumes from where it stopped', async () => {
    const closed = new FeatureGate({ ...ALL_OPEN, auto_create_node_proposals: false })
    const r1 = new HarnessRunner({ gates: closed, drivers: fakeDrivers(), now })
    r1.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    await r1.advance(store)
    const r2 = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now })
    const rs = await r2.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
  })

  test('a driver that throws records FAILED with the error message', async () => {
    const drivers = fakeDrivers()
    drivers['LEAD_MERGED'] = async () => { throw new Error('boom') }
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.error).toContain('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/harness-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/knowledge-harness/src/runtime/harness-runner.ts`:

```ts
import { RunStateSchema, type RunState } from '@apc/shared'
import { PIPELINE, assertTransition } from './run-state-machine.js'
import type { FeatureGate } from './feature-gate.js'
import type { RunArtifactStore } from './run-artifact-store.js'

export type DriverArtifact = { name: string; data: unknown }
export type DriverResult = { artifacts: DriverArtifact[] }
export type RunnerContext = { runId: string; projectId: string; engine: string; store: RunArtifactStore; runState: RunState }
export type Driver = (ctx: RunnerContext) => Promise<DriverResult>

export type HarnessRunnerDeps = {
  gates: FeatureGate
  drivers: Partial<Record<RunState['state'], Driver>>
  now: () => string
}

export class HarnessRunner {
  constructor(private readonly deps: HarnessRunnerDeps) {}

  /** Create and persist a fresh run in the CREATED state. */
  createRun(store: RunArtifactStore, input: { runId: string; projectId: string; engine: string }): RunState {
    const rs = RunStateSchema.parse({
      runId: input.runId, projectId: input.projectId, engine: input.engine,
      state: 'CREATED', history: [{ state: 'CREATED', at: this.deps.now() }], artifacts: {},
    })
    store.init()
    store.saveRunState(rs)
    return rs
  }

  /** Walk PIPELINE from the run's current state to HUMAN_REVIEW_REQUIRED, a closed gate, or FAILED. Resumable. */
  async advance(store: RunArtifactStore): Promise<RunState> {
    let runState = store.loadRunState()
    const ctx: RunnerContext = {
      runId: runState.runId, projectId: runState.projectId, engine: runState.engine, store, runState,
    }

    // runState.state is the last COMPLETED state; resume from the next pipeline step.
    const startIdx = PIPELINE.findIndex(s => s.to === runState.state)
    for (let i = startIdx + 1; i < PIPELINE.length; i++) {
      const step = PIPELINE[i]
      if (step.gate && !this.deps.gates.gate(step.gate)) return runState  // gate closed → stop here
      try {
        const result = (await this.deps.drivers[step.to]?.(ctx)) ?? { artifacts: [] }
        assertTransition(runState.state, step.to)
        const paths = result.artifacts.map(a => store.writeArtifact(step.to, a.name, a.data))
        runState = {
          ...runState,
          state: step.to,
          history: [...runState.history, { state: step.to, at: this.deps.now() }],
          artifacts: { ...runState.artifacts, [step.to]: paths },
        }
        store.saveRunState(runState)
        ctx.runState = runState
      } catch (err) {
        runState = {
          ...runState,
          state: 'FAILED',
          history: [...runState.history, { state: 'FAILED', at: this.deps.now() }],
          error: err instanceof Error ? err.message : String(err),
        }
        store.saveRunState(runState)
        return runState
      }
    }
    return runState
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/harness-runner.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Export the runtime from the package index**

Edit `packages/knowledge-harness/src/index.ts` to:

```ts
export const HARNESS_VERSION = '0.0.0'
export * from './runtime/run-state-machine.js'
export * from './runtime/feature-gate.js'
export * from './runtime/run-artifact-store.js'
export * from './runtime/run-lock.js'
export * from './runtime/harness-runner.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/runtime/harness-runner.ts packages/knowledge-harness/src/runtime/harness-runner.test.ts packages/knowledge-harness/src/index.ts
git commit -m "feat(knowledge-harness): harness-runner — driver-injected pipeline walk, persistence, resume, FAILED"
```

---

## Task 8: `harness/` 설정·문서 파일

**Files:**
- Create: `harness/feature-gates.yml`
- Create: `harness/harness-rules.md`
- Create: `harness/run-state-machine.yml`
- Test: `packages/knowledge-harness/src/runtime/feature-gate.config.test.ts`

- [ ] **Step 1: Write the failing test** (asserts the shipped config matches the design's MVP gate policy and loads via `FeatureGate.fromFile`)

`packages/knowledge-harness/src/runtime/feature-gate.config.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FeatureGate } from './feature-gate.js'

// repo root = up from packages/knowledge-harness/src/runtime/
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

describe('shipped feature-gates.yml (MVP policy)', () => {
  const g = FeatureGate.fromFile(gatesPath)

  test('automation that creates proposals/staging is ON', () => {
    for (const k of ['auto_classify_documents', 'auto_create_node_proposals', 'auto_create_write_plan',
      'auto_write_to_staging', 'enable_conversation_history_reader', 'use_staging_vault']) {
      expect(g.gate(k)).toBe(true)
    }
  })

  test('dangerous automation is OFF', () => {
    for (const k of ['auto_write_to_real_vault', 'auto_shared_promotion', 'auto_deprecate',
      'auto_delete', 'auto_graph_update', 'auto_update_current', 'auto_update_adr']) {
      expect(g.gate(k)).toBe(false)
    }
  })

  test('safety/review gates are ON', () => {
    for (const k of ['enable_policy_guard', 'enable_secret_scan', 'enable_evidence_required',
      'enable_human_review_for_shared', 'enable_human_review_for_canonical', 'require_git_diff_before_merge']) {
      expect(g.gate(k)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/feature-gate.config.test.ts`
Expected: FAIL — `ENOENT` (harness/feature-gates.yml missing).

- [ ] **Step 3: Create `harness/feature-gates.yml`** (verbatim from design §7)

`harness/feature-gates.yml`:

```yaml
features:
  auto_classify_documents: true
  auto_create_node_proposals: true
  auto_create_write_plan: true
  auto_write_to_staging: true
  auto_write_to_real_vault: false
  auto_shared_promotion: false
  auto_deprecate: false
  auto_delete: false
  auto_graph_update: false
  auto_update_current: false
  auto_update_adr: false
  enable_conversation_history_reader: true
  enable_claude_history_reader: false
  enable_codex_history_reader: false
  enable_opencode_history_reader: false
  enable_policy_guard: true
  enable_secret_scan: true
  enable_evidence_required: true
  enable_human_review_for_shared: true
  enable_human_review_for_canonical: true
  use_staging_vault: true
  require_git_diff_before_merge: true
```

- [ ] **Step 4: Create `harness/harness-rules.md`** — this file is the LLM preamble used in Phase 2; Phase 1 only places it.

`harness/harness-rules.md`:

```markdown
# Knowledge Harness Rules

## 1. Immutable Sources
- `raw/` 아래 원본은 절대 수정하지 않는다.
- `raw/` 아래 원본은 삭제하지 않는다.
- raw source는 evidence로만 사용한다.
- 민감정보가 포함된 raw source를 그대로 wiki/shared/canonical 문서로 승격하지 않는다.

## 2. Proposal First
- 모든 worker agent는 직접 문서를 수정하지 않는다.
- worker agent는 `NodeProposal`, `DocumentIntentReport`, `TaskMappingReport`만 생성한다.
- worker agent의 출력은 모두 `inbox/proposals/`에 저장한다.
- proposal에는 반드시 evidence가 있어야 한다.

## 3. Lead Merge
- `WikiGraphLeadAgent`만 proposal을 병합할 수 있다.
- Lead는 기존 node와 중복 여부를 반드시 확인한다.
- Lead는 기존 canonical 문서와 충돌 여부를 확인한다.
- Lead는 직접 문서를 쓰지 않고 `WritePlan`을 생성한다.

## 4. Shared Promotion
- shared 승격은 최소 2개 이상의 evidence 또는 2개 이상의 project relevance가 있어야 한다.
- shared 승격은 자동 적용하지 않는다.
- shared 승격은 human review가 필요하다.
- 프로젝트 특수 결정은 shared로 승격하지 않는다.

## 5. Safe Write
- `ObsidianWikiWriterAgent`는 승인된 `WritePlan`만 실행한다.
- `current.md`, `PRD.md`, `ADR-*` 문서는 직접 덮어쓰지 않고 diff proposal을 만든다.
- 삭제는 금지한다.
- 삭제가 필요하면 `deprecated` 또는 `superseded` 상태로 표시한다.

## 6. Evidence
- 모든 `ConceptNode`, `DecisionNode`, `ExperimentNode`는 source reference를 가져야 한다.
- 추론은 `inference_note`에 명시한다.
- evidence 없는 node는 canonical/shared/wiki에 반영하지 않고 proposal 상태로 둔다.
- evidence는 source path와 source id를 포함해야 한다.

## 7. Validation
- write 후 Markdown/YAML validation을 수행한다.
- Obsidian `[[wiki-link]]`가 깨졌는지 확인한다.
- graph node id와 문서 frontmatter의 `node_id`가 일치해야 한다.
- duplicate node, orphan node, broken backlink를 report로 남긴다.

## 8. Human Review
- shared 승격은 human review가 필요하다.
- canonical 문서 수정은 human review가 필요하다.
- secret/privacy 경고가 있는 proposal은 human review 전까지 적용하지 않는다.
```

- [ ] **Step 5: Create `harness/run-state-machine.yml`** — documentation copy only; runtime source of truth is `run-state-machine.ts`.

`harness/run-state-machine.yml`:

```yaml
run_state_machine:
  states:
    - CREATED
    - PROJECT_SCANNED
    - SOURCES_EXTRACTED
    - DOCUMENTS_CLASSIFIED
    - NODE_PROPOSALS_CREATED
    - LEAD_MERGED
    - WRITE_PLAN_CREATED
    - STAGING_WRITTEN
    - VALIDATED
    - HUMAN_REVIEW_REQUIRED
    - MERGED
    - FAILED
  artifacts:
    PROJECT_SCANNED:
      - ProjectDiscoveryReport
    SOURCES_EXTRACTED:
      - SourceInventoryReport
      - ConversationHistoryReport
    DOCUMENTS_CLASSIFIED:
      - DocumentIntentReport
    NODE_PROPOSALS_CREATED:
      - NodeProposal[]
    LEAD_MERGED:
      - GraphUpdatePlan
      - SharedPromotionPlan
      - StaleDocReport
    WRITE_PLAN_CREATED:
      - WritePlan
    STAGING_WRITTEN:
      - AppliedWriteReport
      - GitDiffReport
    VALIDATED:
      - GraphValidationReport
      - LinkValidationReport
      - SecretScanReport
      - MarkdownYamlValidationReport
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/feature-gate.config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add harness/feature-gates.yml harness/harness-rules.md harness/run-state-machine.yml packages/knowledge-harness/src/runtime/feature-gate.config.test.ts
git commit -m "feat(knowledge-harness): ship harness/ config (feature-gates, rules, state-machine doc)"
```

---

## Task 9: End-to-end integration (gates 그대로 → 전 구간) + 전체 테스트

**Files:**
- Test: `packages/knowledge-harness/src/runtime/pipeline.e2e.test.ts`

This proves the pieces compose: load the *shipped* gates, create a run in a temp run dir, advance with fake drivers, and confirm the run reaches `HUMAN_REVIEW_REQUIRED` with artifacts on disk and a resumable `run.json`.

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/runtime/pipeline.e2e.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { KhState } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner, type Driver } from './harness-runner.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

function fakeDrivers(): Partial<Record<KhState, Driver>> {
  const states: KhState[] = ['PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
    'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED']
  const map: Partial<Record<KhState, Driver>> = {}
  for (const s of states) map[s] = async () => ({ artifacts: [{ name: 'out', data: { state: s } }] })
  return map
}

describe('pipeline e2e with shipped gates', () => {
  let workspace: string
  beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'kh-ws-')) })
  afterEach(() => { rmSync(workspace, { recursive: true, force: true }) })

  test('a run reaches HUMAN_REVIEW_REQUIRED and persists run.json + artifacts', async () => {
    const store = new RunArtifactStore(join(workspace, 'runs', 'RUN-1'))
    const runner = new HarnessRunner({ gates: FeatureGate.fromFile(gatesPath), drivers: fakeDrivers(), now: () => '2026-06-02T00:00:00Z' })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)

    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(existsSync(join(workspace, 'runs', 'RUN-1', 'run.json'))).toBe(true)
    expect(existsSync(join(workspace, 'runs', 'RUN-1', 'artifacts', 'VALIDATED', 'out.json'))).toBe(true)

    // run.json on disk is loadable and self-consistent (resumability contract).
    const reloaded = new RunArtifactStore(join(workspace, 'runs', 'RUN-1')).loadRunState()
    expect(reloaded.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(Object.keys(reloaded.artifacts)).toContain('NODE_PROPOSALS_CREATED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/pipeline.e2e.test.ts`
Expected: PASS immediately (all collaborators already exist from Tasks 3–8). If it fails, the failure localizes the integration gap — fix before committing.

- [ ] **Step 3: Run the FULL suite to confirm no regressions**

Run: `pnpm test`
Expected: all packages green, including the pre-existing `@apc/llm-wiki`, `@apc/app-services`, desktop tests.

- [ ] **Step 4: Commit**

```bash
git add packages/knowledge-harness/src/runtime/pipeline.e2e.test.ts
git commit -m "test(knowledge-harness): e2e pipeline run with shipped gates → HUMAN_REVIEW_REQUIRED + resumable run.json"
```

---

## Phase 1 완료 기준

- `@apc/knowledge-harness`가 워크스페이스에 링크되고 `pnpm test`가 green.
- `HarnessRunner`가 fake driver로 CREATED→HUMAN_REVIEW_REQUIRED 전 구간을 주파하고, 각 단계 artifact와 `run.json`을 `runs/RUN-*/`에 남긴다.
- feature gate가 닫히면 해당 단계에서 멈추고, 다시 열고 `advance`하면 resume된다.
- driver throw 시 `FAILED`가 기록된다.
- `harness/feature-gates.yml`이 설계 §7 MVP 정책과 일치한다.

## Phase 1 비포함 (다음 Phase)

- 실제 LLM agent driver (Phase 2: ProjectDiscovery, ConversationHistoryReader, DocumentIntentClassifier, KnowledgeNodeExtractor, WikiGraphLead, ObsidianWikiWriter + StagingVault).
- agent별 report 스키마(ProjectDiscoveryReport, DocumentIntentReport 등)는 해당 agent와 함께 Phase 2에서 추가.
- PolicyGuard / GraphIntegrity / validators / EvalReport 산출 (Phase 3).
- CLI bin + 데스크톱 IPC/UI + promote 경로 (Phase 4).
