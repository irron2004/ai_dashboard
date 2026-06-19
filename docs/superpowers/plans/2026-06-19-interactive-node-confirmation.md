# Interactive Node-Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위키 생성 중 노드 제안 직후 파이프라인을 일시정지하고, 사용자가 노드 목록을 편집·승인하면 그 목록으로 위키를 쓰게 한다 (project-docs 도메인).

**Architecture:** 기존 게이트-정지/재개 위에, 드라이버가 `DriverResult.status:'paused'`를 반환하면 러너가 현재 상태에 머문 채 `RunState.awaiting`을 세팅하고 멈춘다. `interactive` run은 `WRITE_PLAN_CREATED` 드라이버에서 `approved-nodes` 아티팩트가 없으면 paused → `LEAD_MERGED`에 정지. `harnessConfirmNodes` IPC가 승인 목록을 아티팩트로 저장 후 resume하고, `STAGING_WRITTEN`이 그 목록으로 proposals를 필터/렌더한다.

**Tech Stack:** TypeScript(ESM), pnpm, vitest, zod(@apc/shared), Electron IPC, React(renderer).

## Global Constraints

- 비-interactive run은 **100% 기존과 동일**(정지 없음). `interactive` 미지정이 기본.
- 테스트는 레포 루트에서 `pnpm exec vitest run <path-from-root>`. (`pnpm --filter ... -- name` 형은 이 레포에서 안 먹음.)
- 새 파이프라인 상태를 추가하지 않는다. 정지는 `LEAD_MERGED` 체류 + `RunState.awaiting` 마커로 표현.
- 노드 렌더는 `STAGING_WRITTEN`에서 일어난다(`make-drivers.ts`의 proposals→`renderNodeDoc`). 승인 목록 소비는 거기서.
- 빈 `KhNodeProposal`(claims/evidence 없음)은 valid — "제목으로 추가" 노드를 최소 proposal로 합성 가능.
- Conventional Commits. 각 Task 끝 커밋. `git add`는 명시 경로만.

**권위 스펙:** `docs/superpowers/specs/2026-06-19-interactive-node-confirmation-design.md`.

---

## File Structure

**수정**
- `packages/knowledge-harness/src/runtime/harness-runner.ts` — `DriverResult.status:'paused'` + `awaiting`, advance가 paused 시 정지.
- `packages/shared/src/kh-schema.ts` — `RunState.awaiting?`, `KhApprovedNodesSchema`.
- `packages/knowledge-harness/src/runtime/make-drivers.ts` — `ARTIFACTS.approvedNodes`; `DriverDeps.interactive`; `WRITE_PLAN_CREATED` paused 게이팅; `STAGING_WRITTEN` 승인목록 소비.
- `packages/app-services/src/harness-service.ts` — `run` 입력 `interactive`; `runnerFor`가 makeDrivers에 전달; `confirmNodes()`.
- `apps/desktop/src/shared/ipc-contract.ts` — `HarnessRunReq.interactive`; `CH.harnessConfirmNodes`; `HarnessConfirmNodesReq/Res`.
- `apps/desktop/src/main/{ipc,container,preload}.ts` — confirmNodes 배선.
- `apps/desktop/src/renderer/components/WikiGenDashboard.tsx` (+ harness-store) — 확인 모드 토글 + 확인 패널.

**신규 테스트**
- `harness-runner.test.ts`(추가), `make-drivers` 관련 드라이버 테스트, `harness-service` confirmNodes 테스트, `interactive.e2e.test.ts`, UI 컴포넌트 테스트.

---

## Task 1: 러너 일시정지 계약 (`status:'paused'` + `awaiting`)

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/harness-runner.ts`
- Modify: `packages/shared/src/kh-schema.ts` (RunState.awaiting)
- Test: `packages/knowledge-harness/src/runtime/harness-runner.test.ts`

**Interfaces:**
- Produces: `DriverResult = { artifacts: DriverArtifact[]; status?: 'ok' | 'failed' | 'paused'; error?: string; awaiting?: string }`. 드라이버가 `status:'paused'`를 반환하면 러너는 그 단계 artifacts를 저장하고, **전이하지 않고** `runState.awaiting=result.awaiting`를 세팅한 뒤 멈춰 반환한다. 'ok' 전이 시 `awaiting`은 해제된다.
- `RunState`에 `awaiting?: string`.

- [ ] **Step 1: Write the failing test**

`harness-runner.test.ts`의 `describe('HarnessRunner', …)`에 추가:

```ts
test('a driver returning status:paused stops at the prior state with an awaiting marker (not FAILED)', async () => {
  const drivers: Partial<Record<KhState, Driver>> = {
    PROJECT_SCANNED: async () => ({ artifacts: [{ name: 'out', data: { s: 'PROJECT_SCANNED' } }] }),
    SOURCES_EXTRACTED: async () => ({ artifacts: [], status: 'paused', awaiting: 'node-confirmation' }),
  }
  const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
  runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
  const rs = await runner.advance(store)
  expect(rs.state).toBe('PROJECT_SCANNED')        // stayed at the last completed state
  expect(rs.awaiting).toBe('node-confirmation')
  expect(rs.error).toBeUndefined()                 // paused is not a failure
})

test('resuming a paused run advances once the driver no longer pauses', async () => {
  let pause = true
  const drivers: Partial<Record<KhState, Driver>> = {
    PROJECT_SCANNED: async () => ({ artifacts: [{ name: 'out', data: {} }] }),
    SOURCES_EXTRACTED: async () => pause ? { artifacts: [], status: 'paused', awaiting: 'x' } : { artifacts: [{ name: 'out', data: {} }] },
  }
  const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
  runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
  await runner.advance(store)
  expect(store.loadRunState().awaiting).toBe('x')
  pause = false
  const rs = await runner.advance(store)
  expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
  expect(rs.awaiting).toBeUndefined()              // cleared on advance
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/harness-runner.test.ts`
Expected: FAIL — `status:'paused'` 미지원이라 SOURCES_EXTRACTED로 전이(또는 awaiting 없음).

- [ ] **Step 3: Add `awaiting` to RunState**

`packages/shared/src/kh-schema.ts`의 `RunStateSchema`에서 `error: z.string().optional(),` 다음 줄에 추가:

```ts
  awaiting: z.string().optional(),  // non-empty when the run is paused waiting for user input (e.g. 'node-confirmation')
```

- [ ] **Step 4: Extend DriverResult and the advance loop**

`harness-runner.ts`에서 `DriverResult` 타입 교체:

```ts
export type DriverResult = { artifacts: DriverArtifact[]; status?: 'ok' | 'failed' | 'paused'; error?: string; awaiting?: string }
```

`advance`의 `try { … }` 블록에서, `const paths = result.artifacts.map(...)` 다음, `if (result.status === 'failed') { … }` 블록 **앞**에 paused 처리를 추가하고, 정상 전이 객체에 `awaiting: undefined`를 넣어 해제한다:

```ts
          const paths = result.artifacts.map(a => store.writeArtifact(step.to, a.name, a.data))
          if (result.status === 'paused') {
            // 정지: 전이하지 않고 현재 상태에 머문다(FAILED 아님). 재개 시 이 단계를 다시 실행.
            runState = {
              ...runState,
              artifacts: { ...runState.artifacts, [step.to]: paths },
              awaiting: result.awaiting ?? 'paused',
            }
            store.saveRunState(runState)
            onProgress?.(runState)
            return runState
          }
          if (result.status === 'failed') {
            assertTransition(runState.state, 'FAILED')
            runState = {
              ...runState,
              state: 'FAILED',
              history: [...runState.history, { state: 'FAILED', at: this.deps.now() }],
              artifacts: { ...runState.artifacts, [step.to]: paths },
              error: result.error ?? `${step.to} reported failure`,
            }
            store.saveRunState(runState)
            onProgress?.(runState)
            return runState
          }
          assertTransition(runState.state, step.to)
          runState = {
            ...runState,
            state: step.to,
            history: [...runState.history, { state: step.to, at: this.deps.now() }],
            artifacts: { ...runState.artifacts, [step.to]: paths },
            awaiting: undefined,
          }
```

(나머지 `store.saveRunState(runState); ctx.runState = runState; onProgress?.(runState)`와 `catch`는 그대로.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/harness-runner.test.ts`
Expected: PASS (신규 2 + 기존 전부 green).

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/runtime/harness-runner.ts packages/knowledge-harness/src/runtime/harness-runner.test.ts packages/shared/src/kh-schema.ts
git commit -m "feat(harness): DriverResult.status:'paused' — pause at current state with an awaiting marker"
```

---

## Task 2: 승인목록 스키마 + interactive 플래그 배선

**Files:**
- Modify: `packages/shared/src/kh-schema.ts` (`KhApprovedNodesSchema`)
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (`ARTIFACTS.approvedNodes`, `DriverDeps.interactive`)
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (`HarnessRunReq.interactive`)
- Modify: `packages/app-services/src/harness-service.ts` (`run` input + `runnerFor` → makeDrivers)
- Test: `packages/shared/src/kh-schema.test.ts`

**Interfaces:**
- Produces: `KhApprovedNodes = { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> }`; `ARTIFACTS.approvedNodes = 'approved-nodes'`; `DriverDeps.interactive?: boolean`; `HarnessRunReq.interactive?: boolean`; `HarnessService.run(input.interactive)`.

- [ ] **Step 1: Write the failing schema test**

`packages/shared/src/kh-schema.test.ts`에 추가:

```ts
test('KhApprovedNodesSchema accepts kept, renamed, and title-only nodes', () => {
  const v = KhApprovedNodesSchema.parse({ nodes: [
    { id: 'a', title: 'A', type: 'ConceptNode', source_proposal_id: 'p1' },
    { title: 'New One' },
  ] })
  expect(v.nodes).toHaveLength(2)
  expect(v.nodes[1].title).toBe('New One')
})
```
(import 줄에 `KhApprovedNodesSchema` 추가.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/kh-schema.test.ts`
Expected: FAIL — `KhApprovedNodesSchema` 없음.

- [ ] **Step 3: Add the schema**

`packages/shared/src/kh-schema.ts`의 `KhNodeProposalSchema` export 뒤에 추가:

```ts
export const KhApprovedNodesSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().optional(),               // 기존 제안 노드의 id (있으면 그 proposal 사용)
    title: z.string().min(1),
    type: z.string().optional(),
    source_proposal_id: z.string().optional(),
  })).default([]),
})
export type KhApprovedNodes = z.infer<typeof KhApprovedNodesSchema>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/kh-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Add ARTIFACTS key + DriverDeps flag**

`make-drivers.ts`의 `ARTIFACTS`에 추가(`processedSources` 줄 근처):

```ts
  approvedNodes: 'approved-nodes',
```

같은 파일 `DriverDeps` 타입(주석 `// Phase 3 will add: policy, validators` 근처)에 추가:

```ts
  /** 확인 모드: WRITE_PLAN_CREATED가 approved-nodes 아티팩트가 없으면 paused로 정지한다. */
  interactive?: boolean
```

- [ ] **Step 6: Thread interactive through HarnessRunReq + service**

`apps/desktop/src/shared/ipc-contract.ts:106`의 `HarnessRunReq`에 `interactive?: boolean` 추가:

```ts
export type HarnessRunReq = { projectId: string; engine: AgentType; materialize?: boolean; engineOptions?: EngineOptions; workerConcurrency?: number; fullRegen?: boolean; interactive?: boolean }
```

`harness-service.ts`의 `run(input: {...})` 시그니처에 `interactive?: boolean` 추가, 그리고 `runnerFor(...)` 호출과 시그니처에 `interactive`를 전달해 `makeDrivers({ ..., interactive })`에 넣는다. 구체적으로:
- `run`의 `input` 타입에 `; interactive?: boolean` 추가.
- `runnerFor(runId, projectId, vaultRoot, projectCwd?, onEngineLog?, engineOptions?, workerConcurrency?, onNodes?, ignoreLedger?)` 끝에 `, interactive?: boolean` 파라미터 추가.
- `runnerFor` 내부 `makeDrivers({ runner, vaultRoot, … })` 객체에 `interactive,` 추가.
- `run`에서 `this.runnerFor(runId, input.projectId, vaultRoot, input.repoPaths?.[0], onEngineLog, input.engineOptions, input.workerConcurrency, onNodes, input.fullRegen)` 호출 끝에 `, input.interactive` 추가.

- [ ] **Step 7: Typecheck**

Run: `pnpm exec tsc -p tsconfig.typecheck.json --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/kh-schema.ts packages/shared/src/kh-schema.test.ts packages/knowledge-harness/src/runtime/make-drivers.ts apps/desktop/src/shared/ipc-contract.ts packages/app-services/src/harness-service.ts
git commit -m "feat(harness): KhApprovedNodes schema + interactive flag plumbing"
```

---

## Task 3: WRITE_PLAN_CREATED 정지 게이팅 + STAGING_WRITTEN 승인목록 소비

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (WRITE_PLAN_CREATED, STAGING_WRITTEN)
- Test: `packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts` (신규)

**Interfaces:**
- Consumes: `DriverDeps.interactive`(Task 2), `ARTIFACTS.approvedNodes`(Task 2), `DriverResult.status:'paused'`(Task 1), `KhApprovedNodes`(Task 2), `ctx.store`(RunnerContext).
- Produces: WRITE_PLAN_CREATED가 interactive+미승인 시 `{ artifacts:[], status:'paused', awaiting:'node-confirmation' }`. STAGING_WRITTEN가 `approved-nodes`로 proposals를 필터/이름수정/합성 후 렌더.

- [ ] **Step 1: Write the failing driver tests**

`packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts` (신규). 헬퍼: 최소 ctx + 미리 채운 아티팩트로 드라이버를 직접 호출한다.

```ts
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from './run-artifact-store.js'
import { makeDrivers, ARTIFACTS } from './make-drivers.js'
import { FakeAgentRunner } from '@apc/llm-wiki'
import type { RunnerContext } from './harness-runner.js'

function ctxWith(store: RunArtifactStore, seed: Array<{ state: string; name: string; data: unknown }>): RunnerContext {
  const artifacts: Record<string, string[]> = {}
  for (const s of seed) (artifacts[s.state] ??= []).push(store.writeArtifact(s.state as never, s.name, s.data))
  const runState = { runId: 'R', projectId: 'p', engine: 'claude', state: 'LEAD_MERGED', history: [], artifacts } as never
  return { runId: 'R', projectId: 'p', engine: 'claude', store, runState } as RunnerContext
}

describe('interactive WRITE_PLAN_CREATED gating', () => {
  let dir: string, store: RunArtifactStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-int-')); store = new RunArtifactStore(join(dir, 'run')); store.init() })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('interactive run with no approved-nodes pauses', async () => {
    const drivers = makeDrivers({ runner: new FakeAgentRunner([]), vaultRoot: dir, stagingRoot: dir, preamble: '', interactive: true })
    const ctx = ctxWith(store, [{ state: 'LEAD_MERGED', name: ARTIFACTS.leadWritePlan, data: { operations: [] } }])
    const res = await drivers.WRITE_PLAN_CREATED!(ctx)
    expect(res.status).toBe('paused')
    expect(res.awaiting).toBe('node-confirmation')
  })

  test('interactive run with approved-nodes proceeds (no pause)', async () => {
    const drivers = makeDrivers({ runner: new FakeAgentRunner([]), vaultRoot: dir, stagingRoot: dir, preamble: '', interactive: true })
    const ctx = ctxWith(store, [
      { state: 'LEAD_MERGED', name: ARTIFACTS.leadWritePlan, data: { operations: [] } },
      { state: 'LEAD_MERGED', name: ARTIFACTS.approvedNodes, data: { nodes: [{ id: 'a', title: 'A' }] } },
    ])
    const res = await drivers.WRITE_PLAN_CREATED!(ctx)
    expect(res.status ?? 'ok').toBe('ok')
  })
})

describe('STAGING_WRITTEN consumes approved-nodes', () => {
  let dir: string, store: RunArtifactStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-stg-')); store = new RunArtifactStore(join(dir, 'run')); store.init() })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const proposal = (id: string, title: string) => ({
    proposal_id: `pp-${id}`, proposed_by: 'x', created_at: '2026-01-01T00:00:00Z',
    node: { id, type: 'ConceptNode', title, scope: 'project' }, claims: [], evidence: [],
  })

  test('removing a node from the approved list drops its rendered doc', async () => {
    const drivers = makeDrivers({ runner: new FakeAgentRunner([]), vaultRoot: dir, stagingRoot: dir, preamble: '', interactive: true })
    const ctx = ctxWith(store, [
      { state: 'NODE_PROPOSALS_CREATED', name: ARTIFACTS.nodeProposals, data: { proposals: [proposal('a', 'A'), proposal('b', 'B')] } },
      { state: 'LEAD_MERGED', name: ARTIFACTS.graphUpdatePlan, data: { node_ops: [], edge_ops: [] } },
      { state: 'WRITE_PLAN_CREATED', name: ARTIFACTS.writePlan, data: { operations: [] } },
      { state: 'LEAD_MERGED', name: ARTIFACTS.approvedNodes, data: { nodes: [{ id: 'a', title: 'A', source_proposal_id: 'pp-a' }] } },
    ])
    const res = await drivers.STAGING_WRITTEN!(ctx)
    const applied = res.artifacts.find((a) => a.name === ARTIFACTS.appliedWriteReport)!.data as { applied: string[] }
    const nodePaths = applied.applied.filter((p) => /nodes\/.+\.md$/.test(p))
    expect(nodePaths.some((p) => p.includes('a.md'))).toBe(true)
    expect(nodePaths.some((p) => p.includes('b.md'))).toBe(false)  // b removed by the user
  })
})
```

> NOTE: `STAGING_WRITTEN`이 실제로 어떤 형태의 AppliedWriteReport를 내는지 구현 중 확인하고(현재 `applied`/`proposals` 배열 구조), 위 단언을 그 실형태에 맞춰 미세조정한다. 핵심 단언("제거한 노드 b는 렌더되지 않는다")은 유지.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts`
Expected: FAIL — 게이팅/소비 미구현(현재 interactive 무시, b도 렌더됨).

- [ ] **Step 3: Implement WRITE_PLAN_CREATED pause gating**

`make-drivers.ts`의 `WRITE_PLAN_CREATED: async (ctx) => { … }`를 교체:

```ts
    WRITE_PLAN_CREATED: async (ctx) => {
      // 확인 모드: 사용자가 노드 목록을 승인하기 전엔 쓰기를 멈춘다(approved-nodes 아티팩트가 신호).
      // approved-nodes는 LEAD_MERGED 키에 저장된다(재실행되지 않는 단계 → 인덱스가 안정적;
      // WRITE_PLAN_CREATED 키에 두면 이 드라이버가 재개 시 자기 산출물로 인덱스를 덮어써 사라진다).
      if (deps.interactive) {
        const approved = artifactByName(ctx, 'LEAD_MERGED', ARTIFACTS.approvedNodes)
        if (!approved) return { artifacts: [], status: 'paused', awaiting: 'node-confirmation' }
      }
      const writePlan = artifactByName(ctx, 'LEAD_MERGED', ARTIFACTS.leadWritePlan)
      return { artifacts: [{ name: ARTIFACTS.writePlan, data: writePlan }] }
    },
```

- [ ] **Step 4: Implement STAGING_WRITTEN approved-set consumption**

`make-drivers.ts`의 `STAGING_WRITTEN` 드라이버에서, `const proposals = artifactByName<{ proposals: KhNodeProposal[] }>(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals)?.proposals ?? []` **다음 줄**에 승인목록 적용을 삽입:

```ts
      // 확인 모드에서 사용자가 승인한 목록이 있으면, 그 목록으로 proposals를 재구성한다:
      // 유지(부분집합) + 제목 이름수정 + (id 없는) 제목-only 신규 노드 합성.
      const approved = artifactByName<{ nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> }>(ctx, 'LEAD_MERGED', ARTIFACTS.approvedNodes)
      const effectiveProposals: KhNodeProposal[] = approved
        ? approved.nodes.map((n) => {
            const src = proposals.find((p) => p.proposal_id === n.source_proposal_id || p.node?.id === n.id)
            if (src) return { ...src, node: { ...src.node, title: n.title } }   // 유지 + 이름수정
            // 신규(제목-only): 최소 proposal 합성 (빈 claims/evidence는 valid)
            const id = (n.id ?? n.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || `node-${Math.random().toString(36).slice(2, 8)}`
            return { proposal_id: `approved-${id}`, proposed_by: 'user', created_at: deps.now?.() ?? new Date().toISOString(),
              node: { id, type: n.type ?? 'ConceptNode', title: n.title, scope: 'project', summary: '', project_ids: [], tags: [] },
              claims: [], evidence: [] } as KhNodeProposal
          })
        : proposals
```

그리고 그 아래에서 노드 렌더에 쓰는 `proposals`를 **`effectiveProposals`로 교체**한다 (현재 `const nodeDocOps = proposals.filter(...).map(...)` → `effectiveProposals`로). 그래프 node 검증에 쓰이는 `proposals.map((p) => p.node?.id)`도 `effectiveProposals`로 맞춘다.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts`
Expected: PASS — paused 게이팅 + 제거한 노드 미렌더.

- [ ] **Step 6: Guard against regressions + typecheck**

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/make-drivers.test.ts && pnpm exec tsc -p tsconfig.typecheck.json --noEmit`
Expected: 기존 make-drivers 테스트 green, 0 type errors. (`deps.now`가 DriverDeps에 없으면 `new Date().toISOString()` fallback이 쓰이므로 무방.)

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge-harness/src/runtime/make-drivers.ts packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts
git commit -m "feat(harness): pause before write in interactive mode; STAGING consumes the approved node set"
```

---

## Task 4: `harnessConfirmNodes` (service + IPC)

**Files:**
- Modify: `packages/app-services/src/harness-service.ts` (`confirmNodes`)
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (CH + req/res types)
- Modify: `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/container.ts`, `apps/desktop/src/main/preload.ts`
- Test: `packages/app-services/src/harness-service.test.ts` (추가)

**Interfaces:**
- Consumes: `HarnessService.resume`(기존), `KhApprovedNodes`(Task 2), `ARTIFACTS.approvedNodes`(Task 2).
- Produces: `HarnessService.confirmNodes({ runId, approvedNodes }): Promise<HarnessRunResult>` — approved-nodes 아티팩트를 `LEAD_MERGED` 키로 저장(+인덱스 append) 후 `resume`. IPC `c:harnessConfirmNodes` + `HarnessConfirmNodesReq = { runId: string; approvedNodes: KhApprovedNodes }`.

- [ ] **Step 1: Write the failing service test**

`packages/app-services/src/harness-service.test.ts`에 추가(기존 fake-runner harness 패턴 사용). 확인 모드 run이 정지하면, confirmNodes가 승인목록 저장+재개해 HUMAN_REVIEW_REQUIRED에 도달:

```ts
test('confirmNodes writes approved-nodes and resumes a paused interactive run', async () => {
  const svc = makeTestService()  // 기존 테스트 헬퍼 (fake LLM runner)
  const run = await svc.run({ projectId: 'p1', engine: 'claude', interactive: true })
  expect(run.finalState).toBe('LEAD_MERGED')          // paused before write
  const res = await svc.confirmNodes({ runId: run.runId, approvedNodes: { nodes: [{ id: 'n1', title: 'N1', source_proposal_id: 'pp1' }] } })
  expect(res.finalState).toBe('HUMAN_REVIEW_REQUIRED')
})
```

> NOTE: 구현 중 기존 harness-service 테스트의 서비스 구성 헬퍼/픽스처(fake runner가 노드를 1개 이상 제안하도록)에 맞춘다. 핵심: interactive run이 LEAD_MERGED에서 멈추고, confirmNodes 후 끝까지 간다.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/app-services/src/harness-service.test.ts`
Expected: FAIL — `confirmNodes` 없음.

- [ ] **Step 3: Implement confirmNodes**

`harness-service.ts`의 `resume(...)` 메서드 뒤에 추가:

```ts
  /** 사용자가 확정한 노드 목록을 LEAD_MERGED 키 아티팩트로 저장하고(artifactByName이 찾도록 인덱스에도 추가),
   *  run을 재개한다. LEAD_MERGED는 재개 시 재실행되지 않아 인덱스가 안정적이다. */
  async confirmNodes(input: { runId: string; approvedNodes: KhApprovedNodes }): Promise<HarnessRunResult> {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, runId: input.runId, finalState: 'FAILED', reason: `run not found: ${input.runId}` }
    const approved = KhApprovedNodesSchema.parse(input.approvedNodes)
    const rel = store.writeArtifact('LEAD_MERGED', ARTIFACTS.approvedNodes, approved)
    // artifactByName은 runState.artifacts 인덱스에서 읽으므로(파일만 써선 못 찾음), LEAD_MERGED 목록에 append.
    const rs = store.loadRunState()
    const lead = rs.artifacts['LEAD_MERGED'] ?? []
    store.saveRunState({
      ...rs,
      awaiting: undefined,
      artifacts: { ...rs.artifacts, ['LEAD_MERGED']: lead.includes(rel) ? lead : [...lead, rel] },
    })
    return this.resume({ runId: input.runId })
  }
```

`harness-service.ts` 상단 import에 `KhApprovedNodesSchema`(@apc/shared)와 `ARTIFACTS`(@apc/knowledge-harness, 이미 makeDrivers와 함께 import 중이면 추가만)를 보장한다.

- [ ] **Step 4: Wire IPC**

`ipc-contract.ts`의 `CH`에 추가: `harnessConfirmNodes: 'c:harnessConfirmNodes',` 그리고 타입:

```ts
export type HarnessConfirmNodesReq = { runId: string; approvedNodes: { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> } }
```

`container.ts`: `harnessConfirmNodes: (req: HarnessConfirmNodesReq) => harness.confirmNodes(req)` 추가 + export 목록에 포함. `ipc.ts` 핸들러 맵에 `[CH.harnessConfirmNodes]: async (p) => container.harnessConfirmNodes(p as HarnessConfirmNodesReq),` 추가. `preload.ts`에 renderer 브릿지 `harnessConfirmNodes: (req) => ipcRenderer.invoke(CH.harnessConfirmNodes, req)` 추가(기존 harnessResume 패턴과 동일하게).

- [ ] **Step 5: Run + typecheck**

Run: `pnpm exec vitest run packages/app-services/src/harness-service.test.ts && pnpm exec tsc -p tsconfig.typecheck.json --noEmit && pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.test.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/container.ts apps/desktop/src/main/preload.ts
git commit -m "feat(ipc): harnessConfirmNodes — persist approved nodes and resume the paused run"
```

---

## Task 5: e2e — 확인 모드 정지 → confirm → 결과 반영

**Files:**
- Test: `packages/app-services/src/harness-service.interactive.e2e.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1-4 전부 (service.run interactive, confirmNodes, paused, staging 소비).

- [ ] **Step 1: Write the e2e test**

기존 e2e 패턴(faked LLM runner가 정해진 proposals를 내도록)을 사용한다. 핵심 가치: **승인목록에서 노드를 제거하면 최종 staging에 그 노드가 빠진다** + **비-interactive는 정지 없이 그대로**.

```ts
import { describe, expect, test } from 'vitest'
// ... 기존 e2e 헬퍼 import (fake runner, tmp vault, service 구성)

describe('interactive node-confirmation e2e', () => {
  test('non-interactive run is unchanged (no pause, reaches review)', async () => {
    const svc = makeE2EService(/* fake runner proposes nodes a,b */)
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(['HUMAN_REVIEW_REQUIRED', 'MERGED']).toContain(r.finalState)
    expect(r.awaiting ?? null).toBeNull()
  })

  test('interactive run pauses, and dropping a node removes it from staging', async () => {
    const svc = makeE2EService(/* fake runner proposes nodes a,b */)
    const run = await svc.run({ projectId: 'p1', engine: 'claude', interactive: true })
    expect(run.finalState).toBe('LEAD_MERGED')
    // 사용자가 b를 빼고 a만 승인
    const done = await svc.confirmNodes({ runId: run.runId, approvedNodes: { nodes: [{ id: 'a', title: 'A', source_proposal_id: 'pp-a' }] } })
    expect(done.finalState).toBe('HUMAN_REVIEW_REQUIRED')
    // staging에 a.md만, b.md 없음
    const staged = listStagedNodeFiles(svc, run.runId)   // 헬퍼: vault-staging/nodes/*.md 나열
    expect(staged.some((p) => p.endsWith('a.md'))).toBe(true)
    expect(staged.some((p) => p.endsWith('b.md'))).toBe(false)
  })
})
```

> NOTE: 구현 중 기존 e2e 헬퍼(예: `pipeline.e2e.test.ts`/`ipc.test.ts`의 fake runner 구성)를 재사용해 `makeE2EService`/`listStagedNodeFiles`를 맞춘다. fake runner는 최소 2개 노드(a,b)를 제안해야 한다.

- [ ] **Step 2: Run**

Run: `pnpm exec vitest run packages/app-services/src/harness-service.interactive.e2e.test.ts`
Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/app-services/src/harness-service.interactive.e2e.test.ts
git commit -m "test(harness): e2e — interactive pause + confirm changes staging output"
```

---

## Task 6: UI — 확인 모드 토글 + 노드 확인 패널

**Files:**
- Modify: `apps/desktop/src/renderer/components/WikiGenDashboard.tsx` (실행 트리거에 "확인 모드" 토글; awaiting 시 확인 패널)
- Modify: `apps/desktop/src/renderer/harness-store.*` (run의 `awaiting` 노출 + `confirmNodes` 액션)
- Create: `apps/desktop/src/renderer/components/NodeConfirmPanel.tsx`
- Test: `apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx`

**Interfaces:**
- Consumes: `api.harnessConfirmNodes`(preload, Task 4), run 상태의 `awaiting`(Task 1), `node-proposals`/`graph-update-plan` 아티팩트(`show`/getRun로 노출).
- Produces: `NodeConfirmPanel`이 제안 노드 목록을 편집해 `{ nodes: [...] }`(KhApprovedNodes 형태)로 `harnessConfirmNodes` 호출.

- [ ] **Step 1: Write the failing component test**

`NodeConfirmPanel.test.tsx` — 제안 노드 목록을 받아 렌더하고, 하나를 제거 후 「이대로 생성」을 누르면 남은 노드만 담아 `onConfirm`을 호출한다.

```tsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NodeConfirmPanel } from './NodeConfirmPanel.js'

test('removing a node then confirming sends only the kept nodes', () => {
  const onConfirm = vi.fn()
  const proposed = [
    { id: 'a', title: 'A', type: 'ConceptNode', source_proposal_id: 'pp-a' },
    { id: 'b', title: 'B', type: 'ConceptNode', source_proposal_id: 'pp-b' },
  ]
  render(<NodeConfirmPanel proposed={proposed} onConfirm={onConfirm} />)
  fireEvent.click(screen.getByLabelText('제거 B'))     // drop node B
  fireEvent.click(screen.getByText('이대로 생성'))
  expect(onConfirm).toHaveBeenCalledWith({ nodes: [expect.objectContaining({ id: 'a', title: 'A' })] })
})
```

> NOTE: 셀렉터는 구현하는 마크업(제거 버튼 라벨 등)에 맞춰 조정한다. 핵심 단언: 제거 후 확인하면 남은 노드만 `{nodes:[...]}`로 전달.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx`
Expected: FAIL — 컴포넌트 없음.

- [ ] **Step 3: Implement NodeConfirmPanel**

> 범위: **keep/remove/rename만.** "제목으로 새 노드 추가"는 연기됨 — 근거 없는(evidence-less) 신규 노드는 PolicyGuard의 evidence-required 게이트에 막히므로, 확인 단계는 에이전트가 *근거를 갖고 제안한* 노드를 큐레이션(유지/제거/이름수정)하는 데 한정한다.

`NodeConfirmPanel.tsx`: props `{ proposed: Array<{id?:string;title:string;type?:string;source_proposal_id?:string}>; onConfirm: (a: { nodes: typeof proposed }) => void }`. 로컬 상태로 각 행의 keep(checkbox)·title(인라인 편집) 보관. 「이대로 생성」 클릭 시 keep된 행만 `{ nodes }`로 `onConfirm`. (제거 = keep 해제 후 제외.) "추가" 입력은 두지 않는다.

```tsx
import { useState } from 'react'
type Row = { id?: string; title: string; type?: string; source_proposal_id?: string; keep: boolean }
export function NodeConfirmPanel({ proposed, onConfirm }: {
  proposed: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }>
  onConfirm: (a: { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> }) => void
}) {
  const [rows, setRows] = useState<Row[]>(proposed.map((p) => ({ ...p, keep: true })))
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const confirm = () => onConfirm({ nodes: rows.filter((r) => r.keep).map(({ keep, ...n }) => n) })
  return (
    <div className="node-confirm">
      <h3>생성할 노드 확인</h3>
      <ul>
        {rows.map((r, i) => (
          <li key={r.source_proposal_id ?? r.id ?? i}>
            <input type="checkbox" aria-label={`keep ${r.title}`} checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} />
            <input aria-label={`title ${i}`} value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
            <button type="button" aria-label={`제거 ${r.title}`} onClick={() => set(i, { keep: false })}>제거</button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={confirm}>이대로 생성</button>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into WikiGenDashboard + store**

`WikiGenDashboard.tsx`: (a) 실행 트리거 영역에 "확인 모드" 체크박스 → `api.harnessRun({ ..., interactive })`. (b) 현재 run의 `awaiting === 'node-confirmation'`이면 `NodeConfirmPanel`을 띄우고, 제안 노드는 run 아티팩트(`node-proposals`의 `proposals[].node` → `{id,title,type,source_proposal_id:proposal_id}`)에서 뽑아 전달. (c) `onConfirm` → `api.harnessConfirmNodes({ runId, approvedNodes })` 후 run 상태 갱신(폴링/이벤트는 기존 진행표시 메커니즘 재사용). harness-store에 `confirmNodes` 액션과 `awaiting` 셀렉터 추가.

> 구현 중 기존 store 액션(harnessRun/harnessResume)과 진행 이벤트 패턴을 그대로 따른다. 새 IPC 호출은 Task 4의 `api.harnessConfirmNodes`.

- [ ] **Step 6: Typecheck + targeted tests**

Run: `pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit && pnpm exec vitest run apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx`
Expected: 0 type errors; component tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/NodeConfirmPanel.tsx apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx apps/desktop/src/renderer/components/WikiGenDashboard.tsx apps/desktop/src/renderer/harness-store.ts
git commit -m "feat(ui): node-confirmation panel + interactive toggle in Wiki Gen"
```

---

## 검증 (전체 완료 후)

스펙 §9 성공 기준 대응:
1. interactive run이 LEAD_MERGED 정지 + `awaiting:'node-confirmation'` — Task 1+3 (e2e Task 5).
2. 제안 노드 목록 UI 편집 — Task 6.
3. 「이대로 생성」 → confirmNodes 저장+재개 — Task 4 (UI Task 6).
4. 승인 목록대로 위키 작성(원안과 다르면 결과도 다름) — Task 3 단위 + Task 5 e2e (봉인).
5. HUMAN_REVIEW_REQUIRED 완주, staging이 승인 목록 반영 — Task 5.
6. 비-interactive run 100% 동일 — Task 5 첫 테스트 + 전체 스위트.

전체: `node scripts/bootstrap-substrate.mjs && pnpm test` (substrate venv-gated 테스트 포함 전부 green).
