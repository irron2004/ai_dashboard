# 위키생성 검수 화면 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위키생성 화면의 검수 탭에 항목별 승인/제외 판단을 추가하고, promote를 승인분만 반영으로 바꾸고, 탭 7개를 과업 기준 4개(개요/검수/구조/진행)로 재편한다.

**Architecture:** 판단은 `review-decisions` run artifact(파일 기반, `approved-nodes` 패턴과 동일)로 저장한다. 읽기는 기존 `harnessGetRun` bundle에 자동 포함되므로 쓰기 채널만 추가한다. `HarnessPromoteService`가 artifact를 읽어 승인된 proposal의 파일만 vault로 복사하고, 소스 ledger에는 승인 proposal이 인용한 소스만 기록한다. diff는 이미 bundle에 실려 오는 `git-diff-report` artifact의 patch를 `parseUnifiedDiff`로 파일별 분리해 쓴다(신규 IPC 불필요 — spec §5의 `readNodeDiff` 채널은 이 발견으로 대체). 원문 발췌는 `EvidenceVerifier`와 같은 공백정규화 매칭으로 인용 위치를 찾아 ±5줄을 돌려주는 신규 쿼리 채널로 제공한다.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React + zustand, Zod, vitest (+@testing-library/react), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-07-21-wikigen-review-redesign-design.md` (같은 브랜치에 커밋됨)

## Global Constraints

- 브랜치: `feat/wikigen-review-redesign` — base는 **`feat/resume-recall-surface`** (main 아님!). 이 브랜치의 PR은 PR #22 병합 후에 병합 가능(스택 PR).
- 커밋: Conventional Commits — `feat(shared)`, `feat(harness)`, `feat(app-services)`, `feat(desktop)`, `test(desktop)`, `refactor(desktop)` 등. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 타입 검사: `pnpm typecheck`가 권위 소스 — IDE 진단(`@xterm/…`, `@apc/node:sqlite not found`, `@homebridge/node-pty-prebuilt-multiarch`)은 오경보이므로 무시.
- 테스트 실행: repo root에서 `npx vitest run <파일경로>` (단일 파일), 전체는 `pnpm test`(~2.5분, 마지막 태스크에서만).
- IPC 채널 추가 규칙: invoke 기반 채널은 **3파일**을 배선한다 — `apps/desktop/src/shared/ipc-contract.ts`(CH+타입), `apps/desktop/src/renderer/api.ts`, `apps/desktop/src/main/ipc.ts`(+`container.ts` 메서드). `preload/index.ts`는 수정하지 않는다: preload는 제네릭 `invoke(channel, payload)` 패스스루를 노출하며 기존 모든 harness invoke 채널이 이 경로를 쓴다(개별 노출은 이벤트 스트림 전용). CLAUDE.md의 "4곳" 중 preload가 빠지는 이유를 커밋/PR 설명에 남길 것.
- Electron API(`shell` 등)가 필요한 핸들러는 `main/ipc.ts`의 `handlers()`(electron import 없는 테스트 가능 맵)가 아니라 **`main/index.ts`에 직접 등록**한다 — `CH.selectFolder`가 선례(`apps/desktop/src/main/index.ts:122`).
- 스키마 필드 규칙: DB/JSON 필드는 snake_case, TS는 camelCase — 단 `KhNodeProposal` 계열 artifact JSON은 전부 snake_case(`proposal_id` 등)이므로 새 `KhReviewDecision`도 snake_case를 따른다.
- `AgentKind`에 값 추가 금지(이 계획에서는 건드릴 일 없음).

## 파일 구조 (전체 조감)

```
packages/shared/src/kh-schema.ts                     [수정] KhReviewDecision(s) 스키마
packages/shared/src/kh-schema.review-decisions.test.ts [신규]
packages/knowledge-harness/src/runtime/make-drivers.ts [수정] ARTIFACTS.reviewDecisions + eval에 sharedPromotion 전달
packages/knowledge-harness/src/eval/eval-report.ts   [수정] shared_promotion_candidates 실계산
packages/knowledge-harness/src/eval/eval-report.test.ts [수정] 위 검증
packages/app-services/src/source-excerpt.ts          [신규] extractSourceExcerpt (순수함수)
packages/app-services/src/source-excerpt.test.ts     [신규]
packages/app-services/src/harness-service.ts         [수정] setReviewDecisions / readSourceExcerpt / resolveRawSourceFile / ledger 필터
packages/app-services/src/harness-promote-service.ts [수정] 승인분만 promote + danglingLinks
packages/app-services/src/harness-service.review.test.ts [신규] 위 서비스 로직 전체 테스트
packages/app-services/src/index.ts                   [수정] source-excerpt export
apps/desktop/src/shared/ipc-contract.ts              [수정] CH 3개 + 타입
apps/desktop/src/renderer/api.ts                     [수정] api 함수 3개
apps/desktop/src/main/ipc.ts                         [수정] 핸들러 2개 (setReviewDecisions, readSourceExcerpt)
apps/desktop/src/main/container.ts                   [수정] Container 타입 + 배선 2개
apps/desktop/src/main/index.ts                       [수정] harnessOpenSourceFile 핸들러 (shell.openPath)
apps/desktop/src/renderer/harness-utils.ts           [수정] readReviewDecisions 헬퍼
apps/desktop/src/renderer/store.ts                   [수정] harnessReviewDecisions + setReviewVerdict + 하이드레이션
apps/desktop/src/renderer/components/ReviewPanel.tsx [전면 수정] 3영역 + 판단 + 필터 + 발췌 + diff
apps/desktop/src/renderer/components/ReviewPanel.test.tsx [신규]
apps/desktop/src/renderer/components/OverviewPanel.tsx [신규] 개요 탭
apps/desktop/src/renderer/components/OverviewPanel.test.tsx [신규]
apps/desktop/src/renderer/components/WikiGenDashboard.tsx [수정] 4탭 재편 + promote 푸터
apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx [수정]
apps/desktop/src/renderer/components/QualityPanel.tsx [수정] next_task 행 제거
apps/desktop/src/renderer/components/QualityPanel.test.tsx [수정]
apps/desktop/src/renderer/components/ProposalsPanel.tsx      [삭제]
apps/desktop/src/renderer/components/ProposalsPanel.test.tsx [삭제]
apps/desktop/src/renderer/components/ReviewActions.tsx       [삭제]
apps/desktop/src/renderer/components/ReviewActions.test.tsx  [삭제]
```

핵심 사실(구현자가 알아야 할 기존 코드):
- `RunArtifactStore.writeArtifact(state, name, data)`는 `artifacts/<STATE>/<name>.json`에 쓰고 rel path를 반환. **run.json의 `artifacts` 인덱스에 rel을 append해야 `show()`/bundle에 노출됨** — `confirmNodes`(`harness-service.ts:608-616`)가 정확한 선례.
- `HUMAN_REVIEW_REQUIRED` 드라이버는 run이 그 상태에 도달한 뒤에는 재실행되지 않으므로(resume은 현재 상태 이후만 진행) 이 상태 키 아래 저장해도 인덱스가 안전하다.
- promote는 run 상태를 바꾸지 않는다(`MERGED` 전이는 없음). 따라서 promote 후에도 판단을 바꿔 재-promote할 수 있다(복사는 멱등). 판단 잠금은 상태 가드(`HUMAN_REVIEW_REQUIRED`만 허용)로 충분하다.
- `SourceReader`는 `source_id === source_path`(vault 상대 `raw/...`, 슬래시)로 소스를 만든다(`source-reader.ts:39`). `processed-sources` artifact의 `sourceId`가 곧 경로다.
- 노드 문서는 STAGING에서 `nodes/<node.id>.md`로 렌더되고 write-plan op에는 `source_proposal`이 실린다(`make-drivers.ts:605-612`). lead가 쓴 그 외 op는 `WRITE_PLAN_CREATED`의 `write-plan` artifact의 `operations[].source_proposal`로 소유자를 알 수 있다.
- 렌더된 노드의 위키링크는 `[[<node_id>]]` 형식(`render-node-doc.ts:55`).
- `git-diff-report` artifact data는 `{ patch: string }`(전체 unified diff)이며 bundle에 이미 포함된다. `parseUnifiedDiff(patch): HarnessDiffFile[]`가 `harness-utils.ts:958`에 있다.
- renderer 컴포넌트 테스트 패턴: `vi.hoisted` apiMock + `vi.mock('../api.js', () => ({ api: apiMock }))` + `useStore.setState({...})` (`WikiGenDashboard.test.tsx:8-17` 참조).
- 서비스 테스트 패턴: `FakeAgentRunner(cannedOutputs())` + tmp vault/runs 디렉터리 (`harness-service.test.ts:17-49` 참조).

---

### Task 1: KhReviewDecision 스키마 (shared)

**Files:**
- Modify: `packages/shared/src/kh-schema.ts` (KhApprovedNodesSchema 바로 뒤, ~line 99)
- Test: `packages/shared/src/kh-schema.review-decisions.test.ts` (신규)

**Interfaces:**
- Produces: `KhReviewVerdict`(`'approved' | 'excluded'`), `KhReviewDecisionSchema`/`KhReviewDecision`(`{ proposal_id, verdict, decided_at }`), `KhReviewDecisionsSchema`/`KhReviewDecisions`(`{ decisions: KhReviewDecision[] }`). 이후 모든 태스크가 이 이름을 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/shared/src/kh-schema.review-decisions.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { KhReviewDecisionsSchema } from './kh-schema.js'

describe('KhReviewDecisionsSchema', () => {
  test('parses a decisions list and rejects unknown verdicts', () => {
    const parsed = KhReviewDecisionsSchema.parse({
      decisions: [
        { proposal_id: 'NP-1', verdict: 'approved', decided_at: '2026-07-21T00:00:00Z' },
        { proposal_id: 'NP-2', verdict: 'excluded', decided_at: '2026-07-21T00:00:01Z' },
      ],
    })
    expect(parsed.decisions).toHaveLength(2)
    expect(() => KhReviewDecisionsSchema.parse({
      decisions: [{ proposal_id: 'NP-1', verdict: 'maybe', decided_at: 'x' }],
    })).toThrow()
  })

  test('defaults to an empty decisions list and rejects a duplicate proposal_id', () => {
    expect(KhReviewDecisionsSchema.parse({}).decisions).toEqual([])
    expect(() => KhReviewDecisionsSchema.parse({
      decisions: [
        { proposal_id: 'NP-1', verdict: 'approved', decided_at: 'x' },
        { proposal_id: 'NP-1', verdict: 'excluded', decided_at: 'y' },
      ],
    })).toThrow(/duplicate/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/shared/src/kh-schema.review-decisions.test.ts`
Expected: FAIL — `KhReviewDecisionsSchema` is not exported.

- [ ] **Step 3: 스키마 구현**

`packages/shared/src/kh-schema.ts`의 `KhApprovedNodesSchema` 블록(line 91-99) 바로 아래에 추가:

```ts
// 검수 탭의 항목별 사람 판단. 미결(pending)은 레코드 부재로 표현한다 — verdict enum에 넣지 않는다.
// HUMAN_REVIEW_REQUIRED 상태 키 아래 'review-decisions' run artifact로 저장되며(HarnessService.setReviewDecisions),
// promote가 승인분만 반영하는 근거가 된다.
export const KhReviewVerdict = z.enum(['approved', 'excluded'])
export type KhReviewVerdict = z.infer<typeof KhReviewVerdict>

export const KhReviewDecisionSchema = z.object({
  proposal_id: z.string().min(1),
  verdict: KhReviewVerdict,
  decided_at: z.string().min(1),
})
export type KhReviewDecision = z.infer<typeof KhReviewDecisionSchema>

export const KhReviewDecisionsSchema = z.object({
  decisions: z.array(KhReviewDecisionSchema).default([]),
})
  // 같은 proposal에 상반된 판단이 공존하면 promote 필터가 비결정적이 된다 — 파싱 단계에서 구조적으로 거부.
  .superRefine((r, ctx) => {
    const seen = new Set<string>()
    r.decisions.forEach((d, i) => {
      if (seen.has(d.proposal_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decisions', i, 'proposal_id'],
          message: `duplicate decision for proposal "${d.proposal_id}"` })
      }
      seen.add(d.proposal_id)
    })
  })
export type KhReviewDecisions = z.infer<typeof KhReviewDecisionsSchema>
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/shared/src/kh-schema.review-decisions.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/shared/src/kh-schema.ts packages/shared/src/kh-schema.review-decisions.test.ts
git commit -m "feat(shared): add KhReviewDecisions schema for per-proposal review verdicts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: review-decisions artifact 저장 — HarnessService.setReviewDecisions

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (ARTIFACTS 상수, line 106-134)
- Modify: `packages/app-services/src/harness-service.ts`
- Test: `packages/app-services/src/harness-service.review.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `KhReviewDecision`, `KhReviewDecisionsSchema`.
- Produces: `ARTIFACTS.reviewDecisions === 'review-decisions'`; `HarnessService.setReviewDecisions(input: { runId: string; decisions: KhReviewDecision[] }): { ok: true } | { ok: false; reason: string }`. artifact는 `artifacts/HUMAN_REVIEW_REQUIRED/review-decisions.json`에 저장되고 run.json 인덱스에 등록되어 `show()` bundle에 `name: 'review-decisions'`로 나타난다.

- [ ] **Step 1: ARTIFACTS 상수 추가**

`packages/knowledge-harness/src/runtime/make-drivers.ts`의 `ARTIFACTS` 객체(line 106-134)에서 `approvedNodes: 'approved-nodes',` 다음 줄에 추가:

```ts
  reviewDecisions: 'review-decisions',
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/app-services/src/harness-service.review.test.ts` 신규 생성. 이 파일은 Task 4·5의 테스트도 담게 되므로 아래 공통 픽스처를 포함해 작성한다. 두 개의 proposal(NP-1→노드 n1, NP-2→노드 n2), 각각 `raw/a`·`raw/b`를 인용, lead는 n1→n2 엣지와 NP-2 소유의 `concepts/extra.md` op를 만든다:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { RunArtifactStore } from '@apc/knowledge-harness'
import type { KhReviewDecision } from '@apc/shared'
import { HarnessService } from './harness-service.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

function cannedOutputs(): string[] {
  const proposals = { proposals: [
    {
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-07-21T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'Alpha' },
      evidence: [{ evidence_id: 'EV-1', source_id: 'raw/a', source_path: 'raw/a', evidence_type: 'doc' }],
      claims: [{ claim_id: 'CL-1', text: 'alpha claim', evidence_ids: ['EV-1'] }],
    },
    {
      proposal_id: 'NP-2', proposed_by: 'extractor', created_at: '2026-07-21T00:00:00Z',
      node: { id: 'n2', type: 'ConceptNode', title: 'Beta' },
      evidence: [{ evidence_id: 'EV-2', source_id: 'raw/b', source_path: 'raw/b', evidence_type: 'doc' }],
      claims: [{ claim_id: 'CL-2', text: 'beta claim', evidence_ids: ['EV-2'] }],
    },
  ] }
  const lead = {
    graph_update_plan: {
      created_by: 'lead',
      node_ops: [{ op: 'create', node_id: 'n1' }, { op: 'create', node_id: 'n2' }],
      edge_ops: [{ op: 'create', from_node_id: 'n1', to_node_id: 'n2', type: 'relates_to' }],
    },
    shared_promotion_plan: { created_by: 'lead' },
    stale_doc_report: { generated_by: 'lead' },
    write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [
      { op: 'create_file', path: 'concepts/extra.md', content: '# extra\n', source_proposal: 'NP-2' },
    ] },
  }
  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
    JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'raw/a', intent: 'reference' }] }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

describe('HarnessService review decisions', () => {
  let ws: string
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-review-'))
    mkdirSync(join(ws, 'vault', 'raw'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'README.md'), '# v\n')
    writeFileSync(join(ws, 'vault', 'raw', 'a'), 'alpha evidence source\n')
    writeFileSync(join(ws, 'vault', 'raw', 'b'), 'beta evidence source\n')
  })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function service(extra: Partial<ConstructorParameters<typeof HarnessService>[0]> = {}) {
    return new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-07-21T00:00:00Z',
      ...extra,
    })
  }

  async function reviewedRun(svc = service()) {
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')
    return r.runId
  }

  const decision = (proposal_id: string, verdict: 'approved' | 'excluded'): KhReviewDecision =>
    ({ proposal_id, verdict, decided_at: '2026-07-21T00:00:00Z' })

  test('setReviewDecisions persists the artifact and show() exposes it', async () => {
    const svc = service()
    const runId = await reviewedRun(svc)
    const res = svc.setReviewDecisions({ runId, decisions: [decision('NP-1', 'approved'), decision('NP-2', 'excluded')] })
    expect(res).toEqual({ ok: true })
    const shown = svc.show({ runId })
    expect(shown.ok).toBe(true)
    if (!shown.ok) return
    const artifact = shown.artifacts.find((a) => a.name === 'review-decisions')
    expect(artifact?.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect((artifact?.data as { decisions: unknown[] }).decisions).toHaveLength(2)
  })

  test('setReviewDecisions overwrites atomically without duplicating the index entry', async () => {
    const svc = service()
    const runId = await reviewedRun(svc)
    svc.setReviewDecisions({ runId, decisions: [decision('NP-1', 'approved')] })
    svc.setReviewDecisions({ runId, decisions: [decision('NP-1', 'excluded')] })
    const store = new RunArtifactStore(join(ws, 'runs', runId))
    const rs = store.loadRunState()
    const entries = (rs.artifacts['HUMAN_REVIEW_REQUIRED'] ?? []).filter((p) => p.endsWith('review-decisions.json'))
    expect(entries).toHaveLength(1)
    const data = store.readArtifact<{ decisions: Array<{ verdict: string }> }>(entries[0])
    expect(data.decisions[0].verdict).toBe('excluded')
  })

  test('setReviewDecisions rejects an unknown run, a wrong state, and an unknown proposal_id', async () => {
    const svc = service()
    expect(svc.setReviewDecisions({ runId: 'NOPE', decisions: [] })).toEqual({ ok: false, reason: 'run not found: NOPE' })

    const staleDir = join(ws, 'runs', 'RUN-stale')
    const staleStore = new RunArtifactStore(staleDir)
    staleStore.saveRunState({ runId: 'RUN-stale', projectId: 'p1', engine: 'claude', state: 'VALIDATED', history: [], artifacts: {} })
    const wrongState = svc.setReviewDecisions({ runId: 'RUN-stale', decisions: [] })
    expect(wrongState.ok).toBe(false)
    if (!wrongState.ok) expect(wrongState.reason).toMatch(/VALIDATED/)

    const runId = await reviewedRun(svc)
    const unknown = svc.setReviewDecisions({ runId, decisions: [decision('NP-999', 'approved')] })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reason).toMatch(/NP-999/)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run packages/app-services/src/harness-service.review.test.ts`
Expected: FAIL — `setReviewDecisions is not a function`.

- [ ] **Step 4: 구현**

`packages/app-services/src/harness-service.ts` 수정.

(a) import 라인 3-4 확장 — 기존:
```ts
import type { AgentType, RunState, KhProjectDiscoveryReport, KhProjectPolicyProposal, KhApprovedNodes } from '@apc/shared'
```
의 타입 목록에 `KhReviewDecision`을 추가하고, 그 다음 줄의 값 import(`KhProjectDiscoveryReportSchema, KhApprovedNodesSchema` 등이 있는 줄)에 `KhReviewDecisionsSchema`를 추가한다.

(b) `confirmNodes` 메서드(line 596-619) 아래에 추가:

```ts
  /** 검수 탭의 항목별 승인/제외 판단을 review-decisions artifact로 저장한다(전체 덮어쓰기 — 부분 병합 없음).
   * HUMAN_REVIEW_REQUIRED 상태에서만 허용: 그 전에는 proposal이 확정되지 않았고, promote가 이 상태를 요구한다.
   * confirmNodes와 같은 이유로 run.json 인덱스에도 등록해야 show()/bundle이 노출한다. */
  setReviewDecisions(input: { runId: string; decisions: KhReviewDecision[] }): { ok: true } | { ok: false; reason: string } {
    let store: RunArtifactStore
    try { store = this.storeFor(input.runId) }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const rs = store.loadRunState()
    if (rs.state !== 'HUMAN_REVIEW_REQUIRED') return { ok: false, reason: `run is ${rs.state}, expected HUMAN_REVIEW_REQUIRED` }

    let parsed
    try { parsed = KhReviewDecisionsSchema.parse({ decisions: input.decisions }) }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }

    const proposalsRel = (rs.artifacts['NODE_PROPOSALS_CREATED'] ?? []).find((p) => p.endsWith('node-proposals.json'))
    const known = new Set(
      (proposalsRel ? store.readArtifact<{ proposals?: Array<{ proposal_id: string }> }>(proposalsRel).proposals ?? [] : [])
        .map((p) => p.proposal_id))
    const unknown = parsed.decisions.filter((d) => !known.has(d.proposal_id))
    if (unknown.length) return { ok: false, reason: `unknown proposal_id: ${unknown.map((d) => d.proposal_id).join(', ')}` }

    const rel = store.writeArtifact('HUMAN_REVIEW_REQUIRED', ARTIFACTS.reviewDecisions, parsed)
    const cur = rs.artifacts['HUMAN_REVIEW_REQUIRED'] ?? []
    store.saveRunState({
      ...rs,
      artifacts: { ...rs.artifacts, HUMAN_REVIEW_REQUIRED: cur.includes(rel) ? cur : [...cur, rel] },
    })
    return { ok: true }
  }
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run packages/app-services/src/harness-service.review.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add packages/knowledge-harness/src/runtime/make-drivers.ts packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.review.test.ts
git commit -m "feat(app-services): persist per-proposal review decisions as a run artifact

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 원문 발췌 순수함수 — extractSourceExcerpt

**Files:**
- Create: `packages/app-services/src/source-excerpt.ts`
- Test: `packages/app-services/src/source-excerpt.test.ts`
- Modify: `packages/app-services/src/index.ts` (export 한 줄 추가)

**Interfaces:**
- Produces: `extractSourceExcerpt(text: string, quote: string | undefined, contextLines?: number): SourceExcerpt`, `SourceExcerpt = { matched: boolean; excerpt: string; line?: number }` (line은 1-기반). Task 4의 서비스 메서드가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/app-services/src/source-excerpt.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { extractSourceExcerpt } from './source-excerpt.js'

const TEXT = [
  'line one', 'line two', 'line three', 'line four', 'line five',
  'line six', 'the QUICK  brown fox', 'line eight', 'line nine',
  'line ten', 'line eleven', 'line twelve', 'line thirteen',
].join('\n')

describe('extractSourceExcerpt', () => {
  test('finds a quote despite whitespace and case drift, returning line and ±5 lines of context', () => {
    const r = extractSourceExcerpt(TEXT, 'The quick brown fox')
    expect(r.matched).toBe(true)
    expect(r.line).toBe(7)
    expect(r.excerpt.split('\n')[0]).toBe('line two')          // 7 - 5
    expect(r.excerpt.split('\n').at(-1)).toBe('line twelve')   // 7 + 5
  })

  test('clamps the window at file boundaries', () => {
    const r = extractSourceExcerpt(TEXT, 'line one')
    expect(r.matched).toBe(true)
    expect(r.line).toBe(1)
    expect(r.excerpt.split('\n')[0]).toBe('line one')
  })

  test('returns the file head unmatched when the quote is absent or empty', () => {
    const missing = extractSourceExcerpt(TEXT, 'not in the file at all')
    expect(missing.matched).toBe(false)
    expect(missing.line).toBeUndefined()
    expect(missing.excerpt.split('\n')[0]).toBe('line one')
    expect(extractSourceExcerpt(TEXT, undefined).matched).toBe(false)
    expect(extractSourceExcerpt(TEXT, '   ').matched).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/app-services/src/source-excerpt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`packages/app-services/src/source-excerpt.ts`:

```ts
export type SourceExcerpt = { matched: boolean; excerpt: string; line?: number }

const DEFAULT_CONTEXT_LINES = 5

/** 공백 붕괴 + 소문자 정규화 뷰와, 정규화 인덱스 → 원문 오프셋 맵을 함께 만든다. EvidenceVerifier와 같은
 *  정규화이므로 검증기가 verified로 판정한 인용은 여기서도 반드시 위치가 잡힌다. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) { pendingSpace = norm.length > 0; continue }
    if (pendingSpace) { norm += ' '; map.push(i); pendingSpace = false }
    norm += ch.toLowerCase()
    map.push(i)
  }
  return { norm, map }
}

/** 인용문 주변 원문 ±contextLines줄을 돌려준다. 미매칭이면 파일 머리를 폴백으로 준다(빈 발췌보다 낫다). */
export function extractSourceExcerpt(text: string, quote: string | undefined, contextLines = DEFAULT_CONTEXT_LINES): SourceExcerpt {
  const lines = text.split(/\r?\n/)
  const head = lines.slice(0, contextLines * 2 + 1).join('\n')
  const normQuote = (quote ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normQuote) return { matched: false, excerpt: head }
  const { norm, map } = normalizeWithMap(text)
  const idx = norm.indexOf(normQuote)
  if (idx < 0 || map[idx] === undefined) return { matched: false, excerpt: head }
  const line = text.slice(0, map[idx]).split(/\r?\n/).length
  const start = Math.max(0, line - 1 - contextLines)
  const end = Math.min(lines.length, line + contextLines)
  return { matched: true, excerpt: lines.slice(start, end).join('\n'), line }
}
```

`packages/app-services/src/index.ts`에 export 추가(기존 export 목록 형식에 맞춰):

```ts
export * from './source-excerpt.js'
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/app-services/src/source-excerpt.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/app-services/src/source-excerpt.ts packages/app-services/src/source-excerpt.test.ts packages/app-services/src/index.ts
git commit -m "feat(app-services): add whitespace-tolerant source excerpt extractor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: HarnessService.readSourceExcerpt / resolveRawSourceFile

**Files:**
- Modify: `packages/app-services/src/harness-service.ts`
- Test: `packages/app-services/src/harness-service.review.test.ts` (Task 2 파일에 describe 추가)

**Interfaces:**
- Consumes: Task 3의 `extractSourceExcerpt`; 기존 `resolveInside`·`isRaw`(`@apc/knowledge-harness`에서 star-export됨 — `vault-fs.ts`).
- Produces:
  - `readSourceExcerpt(input: { runId: string; sourcePath: string; quote?: string }): { ok: true; matched: boolean; excerpt: string; line?: number } | { ok: false; reason: string }`
  - `resolveRawSourceFile(input: { runId: string; sourcePath: string }): { ok: true; absPath: string } | { ok: false; reason: string }` — main/index.ts의 shell.openPath 핸들러(Task 6)가 소비.

- [ ] **Step 1: 실패하는 테스트 추가**

`packages/app-services/src/harness-service.review.test.ts` 파일 끝에 describe 추가(기존 픽스처 재사용):

```ts
describe('HarnessService source excerpt / open', () => {
  let ws: string
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-excerpt-'))
    mkdirSync(join(ws, 'vault', 'raw'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'README.md'), '# v\n')
    writeFileSync(join(ws, 'vault', 'raw', 'a'), 'before\nalpha evidence source\nafter\n')
    writeFileSync(join(ws, 'vault', 'raw', 'b'), 'beta evidence source\n')
  })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function service() {
    return new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-07-21T00:00:00Z',
    })
  }

  test('returns a matched excerpt with the quote line', async () => {
    const svc = service()
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    const res = svc.readSourceExcerpt({ runId: r.runId, sourcePath: 'raw/a', quote: 'ALPHA  evidence source' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.matched).toBe(true)
    expect(res.line).toBe(2)
    expect(res.excerpt).toContain('alpha evidence source')
  })

  test('rejects non-raw paths and path escapes', async () => {
    const svc = service()
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(svc.readSourceExcerpt({ runId: r.runId, sourcePath: 'README.md' }).ok).toBe(false)
    expect(svc.readSourceExcerpt({ runId: r.runId, sourcePath: 'raw/../../etc/passwd' }).ok).toBe(false)
    expect(svc.resolveRawSourceFile({ runId: r.runId, sourcePath: 'raw/../../etc/passwd' }).ok).toBe(false)
    expect(svc.resolveRawSourceFile({ runId: r.runId, sourcePath: 'README.md' }).ok).toBe(false)
  })

  test('resolveRawSourceFile returns the absolute path of an existing raw file only', async () => {
    const svc = service()
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    const okRes = svc.resolveRawSourceFile({ runId: r.runId, sourcePath: 'raw/a' })
    expect(okRes.ok).toBe(true)
    if (okRes.ok) expect(okRes.absPath.replace(/\\/g, '/')).toContain('/vault/raw/a')
    expect(svc.resolveRawSourceFile({ runId: r.runId, sourcePath: 'raw/missing' }).ok).toBe(false)
  })
})
```

주의: `raw/../../etc/passwd`는 문자열이 `raw/`로 시작해 `isRaw`를 통과하지만 `resolveInside`가 잡는다 — 두 가드 모두 필요함을 검증하는 케이스다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/app-services/src/harness-service.review.test.ts`
Expected: FAIL — `readSourceExcerpt is not a function` (Task 2의 3개 테스트는 계속 PASS).

- [ ] **Step 3: 구현**

`packages/app-services/src/harness-service.ts` 수정.

(a) `@apc/knowledge-harness` import 블록(line 6-17)에 `isRaw` 추가(이미 `resolveInside`는 있음).
(b) 파일 상단 로컬 import에 추가:
```ts
import { extractSourceExcerpt } from './source-excerpt.js'
```
(c) `readStagedDoc`(line 833-846) 아래에 추가:

```ts
  /** 검수 탭용: evidence가 인용한 raw 원본에서 인용 주변 원문을 읽는다. raw/ 밖·경로 이탈은 거부. */
  readSourceExcerpt(input: { runId: string; sourcePath: string; quote?: string }):
    { ok: true; matched: boolean; excerpt: string; line?: number } | { ok: false; reason: string } {
    const resolved = this.resolveRawSourceFile(input)
    if (!resolved.ok) return resolved
    try {
      return { ok: true, ...extractSourceExcerpt(readFileSync(resolved.absPath, 'utf8'), input.quote) }
    } catch { return { ok: false, reason: '원본 파일을 읽을 수 없습니다' } }
  }

  /** raw/ 원본의 절대경로를 검증해 돌려준다 — main의 shell.openPath 핸들러 전용.
   *  isRaw는 문자열 prefix만 보므로 resolveInside의 경로-이탈 가드와 반드시 함께 써야 한다. */
  resolveRawSourceFile(input: { runId: string; sourcePath: string }):
    { ok: true; absPath: string } | { ok: false; reason: string } {
    if (!isRaw(input.sourcePath)) return { ok: false, reason: 'raw/ 밖의 경로는 열 수 없습니다' }
    const vaultRoot = this.vaultFor(this.projectIdOf(input.runId)).localRoot
    let abs: string
    try { abs = resolveInside(vaultRoot, input.sourcePath) }
    catch { return { ok: false, reason: '허용되지 않는 경로' } }
    const st = statSync(abs, { throwIfNoEntry: false })
    if (!st?.isFile()) return { ok: false, reason: '원본 파일 없음' }
    if (st.size > 512 * 1024) return { ok: false, reason: `파일 크기 초과 (${Math.round(st.size / 1024)}KB > 512KB)` }
    return { ok: true, absPath: abs }
  }
```

`statSync`·`readFileSync`는 이미 파일 상단에서 import되어 있다(line 2).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/app-services/src/harness-service.review.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.review.test.ts
git commit -m "feat(app-services): serve raw-source excerpts and validated open paths for review

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Promote 승인분 필터 + 미해결 링크 집계 + ledger 필터

**Files:**
- Modify: `packages/app-services/src/harness-promote-service.ts`
- Modify: `packages/app-services/src/harness-service.ts` (`markRunSourcesProcessed`)
- Test: `packages/app-services/src/harness-service.review.test.ts` (describe 추가)

**Interfaces:**
- Consumes: Task 2의 review-decisions artifact(`artifacts/HUMAN_REVIEW_REQUIRED/review-decisions.json`).
- Produces: `HarnessPromoteResult` ok-분기 확장 — `{ ok: true; promoted: string[]; proposals: string[]; refusedCanonical: string[]; skippedByReview: string[]; danglingLinks: number }`. artifact 부재 시 `skippedByReview: []`, `danglingLinks: 0`으로 레거시 전체 promote. artifact 존재 + 승인 0건 → `{ ok: false, reason: '승인된 항목이 없습니다 — 검수 탭에서 항목을 승인한 뒤 반영하세요' }`.

- [ ] **Step 1: 실패하는 테스트 추가**

`packages/app-services/src/harness-service.review.test.ts`에 describe 추가(첫 describe의 픽스처와 동일 패턴):

```ts
describe('HarnessService promote with review decisions', () => {
  let ws: string
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-promote-'))
    mkdirSync(join(ws, 'vault', 'raw'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'README.md'), '# v\n')
    writeFileSync(join(ws, 'vault', 'raw', 'a'), 'alpha evidence source\n')
    writeFileSync(join(ws, 'vault', 'raw', 'b'), 'beta evidence source\n')
  })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  type Marked = { projectId: string; runId: string; sources: ReadonlyArray<{ sourceId: string; sourceHash: string }> }
  function fakeLedger(calls: Marked[]) {
    return {
      isProcessed: () => false,
      markProcessed: (projectId: string, runId: string, sources: ReadonlyArray<{ sourceId: string; sourceHash: string }>) => {
        calls.push({ projectId, runId, sources })
      },
    }
  }

  function service(calls: Marked[]) {
    return new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      sourceLedger: fakeLedger(calls),
      gatesPath, preamble: 'RULES', now: () => '2026-07-21T00:00:00Z',
    })
  }

  const decision = (proposal_id: string, verdict: 'approved' | 'excluded'): KhReviewDecision =>
    ({ proposal_id, verdict, decided_at: '2026-07-21T00:00:00Z' })

  test('promotes only approved proposals, reports skipped files and dangling links', async () => {
    const calls: Marked[] = []
    const svc = service(calls)
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    svc.setReviewDecisions({ runId: r.runId, decisions: [decision('NP-1', 'approved'), decision('NP-2', 'excluded')] })

    const promoted = svc.promote({ runId: r.runId })
    expect(promoted.ok).toBe(true)
    if (!promoted.ok) return
    expect(promoted.promoted).toContain('nodes/n1.md')
    expect(promoted.promoted).not.toContain('nodes/n2.md')
    expect(promoted.skippedByReview).toContain('nodes/n2.md')
    expect(promoted.skippedByReview).toContain('concepts/extra.md')   // lead op의 source_proposal=NP-2
    expect(promoted.danglingLinks).toBe(1)                            // n1이 [[n2]]를 참조
    expect(existsSync(join(ws, 'vault', 'nodes', 'n1.md'))).toBe(true)
    expect(existsSync(join(ws, 'vault', 'nodes', 'n2.md'))).toBe(false)
    expect(existsSync(join(ws, 'vault', 'concepts', 'extra.md'))).toBe(false)
  })

  test('marks only sources cited by approved proposals in the ledger', async () => {
    const calls: Marked[] = []
    const svc = service(calls)
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    svc.setReviewDecisions({ runId: r.runId, decisions: [decision('NP-1', 'approved'), decision('NP-2', 'excluded')] })
    svc.promote({ runId: r.runId })
    expect(calls).toHaveLength(1)
    const ids = calls[0].sources.map((s) => s.sourceId)
    expect(ids).toContain('raw/a')
    expect(ids).not.toContain('raw/b')
  })

  test('refuses promote when decisions exist but nothing is approved', async () => {
    const calls: Marked[] = []
    const svc = service(calls)
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    svc.setReviewDecisions({ runId: r.runId, decisions: [decision('NP-1', 'excluded'), decision('NP-2', 'excluded')] })
    const promoted = svc.promote({ runId: r.runId })
    expect(promoted.ok).toBe(false)
    if (!promoted.ok) expect(promoted.reason).toMatch(/승인된 항목이 없습니다/)
    expect(calls).toHaveLength(0)
  })

  test('without a decisions artifact promote keeps the legacy promote-everything behavior', async () => {
    const calls: Marked[] = []
    const svc = service(calls)
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    const promoted = svc.promote({ runId: r.runId })
    expect(promoted.ok).toBe(true)
    if (!promoted.ok) return
    expect(promoted.promoted).toEqual(expect.arrayContaining(['nodes/n1.md', 'nodes/n2.md', 'concepts/extra.md']))
    expect(promoted.skippedByReview).toEqual([])
    expect(promoted.danglingLinks).toBe(0)
    expect(calls[0].sources.map((s) => s.sourceId)).toEqual(expect.arrayContaining(['raw/a', 'raw/b']))
  })

  test('a pending (undecided) proposal is treated like excluded at promote time', async () => {
    const calls: Marked[] = []
    const svc = service(calls)
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    svc.setReviewDecisions({ runId: r.runId, decisions: [decision('NP-1', 'approved')] })  // NP-2는 미결
    const promoted = svc.promote({ runId: r.runId })
    expect(promoted.ok).toBe(true)
    if (!promoted.ok) return
    expect(promoted.promoted).not.toContain('nodes/n2.md')
    expect(promoted.skippedByReview).toContain('nodes/n2.md')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/app-services/src/harness-service.review.test.ts`
Expected: FAIL — `skippedByReview`가 undefined (promote 결과에 없음) 등.

- [ ] **Step 3: HarnessPromoteService 구현**

`packages/app-services/src/harness-promote-service.ts` 수정.

(a) 결과 타입(line 7-9) 교체:

```ts
export type HarnessPromoteResult =
  | { ok: true; promoted: string[]; proposals: string[]; refusedCanonical: string[]; skippedByReview: string[]; danglingLinks: number }
  | { ok: false; reason: string }
```

(b) `promote()`(line 77-104)를 다음으로 교체:

```ts
  promote(input: { runId: string; allowSecrets?: boolean; allowInvalid?: boolean }): HarnessPromoteResult {
    const store = new RunArtifactStore(resolveInside(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const rs = store.loadRunState()
    const blocked = this.gate(store, rs, input)
    if (blocked) return { ok: false, reason: blocked }

    const appliedPaths = rs.artifacts['STAGING_WRITTEN'] ?? []
    const rel = appliedPaths.find(p => p.endsWith('applied-write-report.json'))
    if (!rel) return { ok: false, reason: 'no applied-write-report in run' }
    const report = store.readArtifact<{ applied: string[]; proposals: string[] }>(rel)

    // 검수 판단이 있으면 승인된 proposal의 파일만 반영한다. artifact 부재 = 레거시(전체 반영) —
    // headless 실행·기존 테스트 호환. 데스크톱 UI는 promote 전 항상 판단을 저장하므로 UI 경로는 항상 필터링된다.
    const review = this.reviewFilter(store, rs, report.applied)
    if (!review.ok) return review
    const { toPromote, skippedByReview, skippedNodeIds } = review

    const staging = this.stagingDir(input.runId)
    const copy = (relPath: string): boolean => {
      const from = resolveInside(staging, relPath)          // source must be inside staging
      const to = resolveInside(this.deps.vaultRoot, relPath) // target must be inside the vault
      if (!existsSync(from)) return false
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
      return true
    }

    // Belt: a canonical path must never be copied into the real vault, even if it leaked into applied[].
    const refusedCanonical = toPromote.filter(isCanonical)
    const promoted = toPromote.filter(p => !isCanonical(p)).filter(copy)
    const proposals = report.proposals.filter(copy)  // .proposal.md siblings — never overwrite canonical

    // 제외 노드를 [[링크]]로 참조하는 승인 문서 수 집계 — Obsidian식 위키에서 미해결 링크는 허용되므로
    // 차단하지 않고 결과 메시지용으로만 센다.
    let danglingLinks = 0
    for (const p of promoted) {
      if (!/\.md$/i.test(p)) continue
      const abs = resolveInside(staging, p)
      if (!existsSync(abs)) continue
      const body = readFileSync(abs, 'utf8')
      for (const id of skippedNodeIds) if (body.includes(`[[${id}]]`)) danglingLinks++
    }
    return { ok: true, promoted, proposals, refusedCanonical, skippedByReview, danglingLinks }
  }

  /** review-decisions artifact 기준으로 applied[]를 승인분/제외분으로 가른다. 파일→proposal 매핑은
   * (1) write-plan op의 source_proposal, (2) 렌더 규약 nodes/<node.id>.md 두 경로로 찾는다 —
   * 어느 쪽으로도 소유자를 알 수 없는 파일(인덱스 등 부수 산출물)은 항상 반영한다. */
  private reviewFilter(store: RunArtifactStore, rs: RunState, applied: string[]):
    | { ok: true; toPromote: string[]; skippedByReview: string[]; skippedNodeIds: string[] }
    | { ok: false; reason: string } {
    const norm = (p: string) => p.replace(/\\/g, '/')
    const decisionsRel = (rs.artifacts['HUMAN_REVIEW_REQUIRED'] ?? []).find(p => p.endsWith('review-decisions.json'))
    if (!decisionsRel) return { ok: true, toPromote: applied, skippedByReview: [], skippedNodeIds: [] }

    const decisions = store.readArtifact<{ decisions: Array<{ proposal_id: string; verdict: string }> }>(decisionsRel)
    const approved = new Set(decisions.decisions.filter(d => d.verdict === 'approved').map(d => d.proposal_id))
    if (approved.size === 0) return { ok: false, reason: '승인된 항목이 없습니다 — 검수 탭에서 항목을 승인한 뒤 반영하세요' }

    const proposalsRel = (rs.artifacts['NODE_PROPOSALS_CREATED'] ?? []).find(p => p.endsWith('node-proposals.json'))
    const proposals = proposalsRel
      ? store.readArtifact<{ proposals?: Array<{ proposal_id: string; node: { id: string } }> }>(proposalsRel).proposals ?? []
      : []
    const planRel = (rs.artifacts['WRITE_PLAN_CREATED'] ?? []).find(p => p.endsWith('write-plan.json'))
    const planOps = planRel
      ? store.readArtifact<{ operations?: Array<{ path: string; source_proposal?: string }> }>(planRel).operations ?? []
      : []
    const ownerByPath = new Map(planOps.filter(o => o.source_proposal).map(o => [norm(o.path), o.source_proposal!]))
    const proposalByNodeId = new Map(proposals.map(p => [p.node.id, p.proposal_id]))
    const owner = (relPath: string): string | undefined => {
      const p = norm(relPath)
      const byPlan = ownerByPath.get(p)
      if (byPlan) return byPlan
      const m = /(^|\/)nodes\/(.+)\.md$/i.exec(p)
      return m ? proposalByNodeId.get(m[2]) : undefined
    }
    const skippedByReview = applied.filter(p => { const o = owner(p); return o !== undefined && !approved.has(o) })
    const skippedSet = new Set(skippedByReview)
    const skippedNodeIds = skippedByReview
      .map(p => /(^|\/)nodes\/(.+)\.md$/i.exec(norm(p))?.[2])
      .filter((x): x is string => !!x)
    return { ok: true, toPromote: applied.filter(p => !skippedSet.has(p)), skippedByReview, skippedNodeIds }
  }
```

주의: 파일 상단 import(line 1-5)는 이미 `readFileSync`를 포함한다 — 추가 import 불필요. `RunState`는 이미 type import되어 있다.

- [ ] **Step 4: ledger 필터 구현**

`packages/app-services/src/harness-service.ts`의 `markRunSourcesProcessed`(line 887-898)를 다음으로 교체:

```ts
  /** Record a promoted run's consumed sources in the idempotency ledger (best-effort; promotion already
   * succeeded). Reads the processed-sources artifact the HUMAN_REVIEW step recorded. With review decisions
   * present, only sources cited by an APPROVED proposal are marked — 제외/미결 노드만 인용한 소스는 미처리로
   * 남아 다음 run이 다시 시도한다. (SourceReader에서 sourceId === source_path.) */
  private markRunSourcesProcessed(runId: string): void {
    const ledger = this.deps.sourceLedger
    if (!ledger) return
    try {
      const store = this.storeFor(runId)
      const rs = store.loadRunState()
      const rel = (rs.artifacts['HUMAN_REVIEW_REQUIRED'] ?? []).find((p) => p.endsWith('processed-sources.json'))
      if (!rel) return
      const data = store.readArtifact<{ sources: { sourceId: string; sourceHash: string }[] }>(rel)
      let sources = data.sources ?? []
      const decisionsRel = (rs.artifacts['HUMAN_REVIEW_REQUIRED'] ?? []).find((p) => p.endsWith('review-decisions.json'))
      if (decisionsRel) {
        const decisions = store.readArtifact<{ decisions: Array<{ proposal_id: string; verdict: string }> }>(decisionsRel)
        const approved = new Set(decisions.decisions.filter((d) => d.verdict === 'approved').map((d) => d.proposal_id))
        const proposalsRel = (rs.artifacts['NODE_PROPOSALS_CREATED'] ?? []).find((p) => p.endsWith('node-proposals.json'))
        const proposals = proposalsRel
          ? store.readArtifact<{ proposals?: Array<{ proposal_id: string; evidence: Array<{ source_path: string }> }> }>(proposalsRel).proposals ?? []
          : []
        const citedByApproved = new Set(
          proposals.filter((p) => approved.has(p.proposal_id)).flatMap((p) => p.evidence.map((e) => e.source_path)))
        sources = sources.filter((s) => citedByApproved.has(s.sourceId))
      }
      ledger.markProcessed(rs.projectId, runId, sources, this.now())
    } catch { /* ledger is an optimization; never fail a successful promote over it */ }
  }
```

- [ ] **Step 5: 통과 확인 (기존 테스트 포함)**

Run: `npx vitest run packages/app-services/src/`
Expected: review.test 11개 전부 PASS + 기존 app-services 테스트 회귀 없음. (기존 테스트 중 promote 결과를 `toEqual`로 전량 비교하는 곳이 있으면 새 필드 `skippedByReview: []`/`danglingLinks: 0` 추가로 맞춘다.)

- [ ] **Step 6: 커밋**

```bash
git add packages/app-services/src/harness-promote-service.ts packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.review.test.ts
git commit -m "feat(app-services): promote only review-approved proposals and scope the source ledger

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: IPC 배선 — 채널 3개 + HarnessPromoteRes 확장

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/renderer/api.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: Task 2·4·5의 서비스 메서드.
- Produces (renderer가 쓸 표면):
  - `api.harnessSetReviewDecisions(req: HarnessSetReviewDecisionsReq): Promise<HarnessSetReviewDecisionsRes>`
  - `api.harnessReadSourceExcerpt(req: HarnessReadSourceExcerptReq): Promise<HarnessReadSourceExcerptRes>`
  - `api.harnessOpenSourceFile(req: HarnessOpenSourceFileReq): Promise<HarnessOpenSourceFileRes>`
  - `HarnessPromoteRes`에 `skippedByReview?: string[]; danglingLinks?: number` 추가.

- [ ] **Step 1: ipc-contract.ts**

(a) `CH` 상수 — `harnessReadStagedDoc: 'c:harnessReadStagedDoc',`(line 47) 앞줄에 추가:

```ts
  harnessSetReviewDecisions: 'c:harnessSetReviewDecisions',
  harnessOpenSourceFile: 'c:harnessOpenSourceFile',
```

그리고 쿼리 블록의 `harnessReadLog: 'q:harnessReadLog',`(line 112) 다음 줄에:

```ts
  harnessReadSourceExcerpt: 'q:harnessReadSourceExcerpt',
```

(b) `HarnessPromoteRes`(line 353) 교체:

```ts
export type HarnessPromoteRes = { ok: boolean; promoted?: string[]; proposals?: string[]; refusedCanonical?: string[]; skippedByReview?: string[]; danglingLinks?: number; reason?: string }
```

(c) `HarnessCanonicalProposalsRes`(line 357) 아래에 타입 추가:

```ts
// 검수 탭의 항목별 판단 저장(전체 덮어쓰기) + 원문 발췌 + 원본 파일 열기.
export type HarnessReviewDecisionDto = { proposal_id: string; verdict: 'approved' | 'excluded'; decided_at: string }
export type HarnessSetReviewDecisionsReq = { runId: string; decisions: HarnessReviewDecisionDto[] }
export type HarnessSetReviewDecisionsRes = { ok: boolean; reason?: string }
export type HarnessReadSourceExcerptReq = { runId: string; sourcePath: string; quote?: string }
export type HarnessReadSourceExcerptRes = { ok: boolean; matched?: boolean; excerpt?: string; line?: number; reason?: string }
export type HarnessOpenSourceFileReq = { runId: string; sourcePath: string }
export type HarnessOpenSourceFileRes = { ok: boolean; reason?: string }
```

- [ ] **Step 2: renderer/api.ts**

(a) type import 목록(line 2-28 구간)의 harness 타입들 옆에 추가: `HarnessSetReviewDecisionsReq, HarnessSetReviewDecisionsRes, HarnessReadSourceExcerptReq, HarnessReadSourceExcerptRes, HarnessOpenSourceFileReq, HarnessOpenSourceFileRes,`

(b) `harnessReadStagedDoc` 함수 앞에 추가:

```ts
  harnessSetReviewDecisions(req: HarnessSetReviewDecisionsReq): Promise<HarnessSetReviewDecisionsRes> {
    return window.apc.invoke(CH.harnessSetReviewDecisions, req) as Promise<HarnessSetReviewDecisionsRes>
  },
  harnessReadSourceExcerpt(req: HarnessReadSourceExcerptReq): Promise<HarnessReadSourceExcerptRes> {
    return window.apc.invoke(CH.harnessReadSourceExcerpt, req) as Promise<HarnessReadSourceExcerptRes>
  },
  harnessOpenSourceFile(req: HarnessOpenSourceFileReq): Promise<HarnessOpenSourceFileRes> {
    return window.apc.invoke(CH.harnessOpenSourceFile, req) as Promise<HarnessOpenSourceFileRes>
  },
```

- [ ] **Step 3: main/ipc.ts 핸들러 2개**

`[CH.harnessReadStagedDoc]` 핸들러(line 268-271) 앞에 추가:

```ts
    [CH.harnessSetReviewDecisions]: async (payload: unknown) => {
      const decisionSchema = z.object({ proposal_id: z.string(), verdict: z.enum(['approved', 'excluded']), decided_at: z.string() })
      const req = z.object({ runId: z.string(), decisions: z.array(decisionSchema) }).strict().parse(payload)
      return container.harnessSetReviewDecisions(req)
    },

    [CH.harnessReadSourceExcerpt]: async (payload: unknown) => {
      const req = z.object({ runId: z.string(), sourcePath: z.string(), quote: z.string().optional() }).strict().parse(payload)
      return container.harnessReadSourceExcerpt(req)
    },
```

`harnessOpenSourceFile`은 `handlers()`에 넣지 않는다(electron `shell` 필요 → Step 5).

- [ ] **Step 4: main/container.ts**

(a) ipc-contract type import에 `HarnessSetReviewDecisionsReq, HarnessSetReviewDecisionsRes, HarnessReadSourceExcerptReq, HarnessReadSourceExcerptRes,` 추가.

(b) `Container` 타입에서 `harnessReadStagedDoc:` 줄 앞에 추가:

```ts
  harnessSetReviewDecisions: (req: HarnessSetReviewDecisionsReq) => HarnessSetReviewDecisionsRes
  harnessReadSourceExcerpt: (req: HarnessReadSourceExcerptReq) => HarnessReadSourceExcerptRes
```

(c) 구현부 — `const harnessReadStagedDoc = ...`(line 490) 앞에 추가:

```ts
  const harnessSetReviewDecisions = (req: HarnessSetReviewDecisionsReq): HarnessSetReviewDecisionsRes =>
    harness.setReviewDecisions(req)
  const harnessReadSourceExcerpt = (req: HarnessReadSourceExcerptReq): HarnessReadSourceExcerptRes =>
    harness.readSourceExcerpt(req)
```

(d) return 객체(line 425-437 구간)의 harness 나열에 `harnessSetReviewDecisions, harnessReadSourceExcerpt,` 추가.

- [ ] **Step 5: main/index.ts — shell.openPath 핸들러**

`apps/desktop/src/main/index.ts`에서:

(a) line 1의 electron import에 `shell` 추가: `import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'`

(b) `CH.selectFolder` 핸들러(line 122 부근) 아래에 추가:

```ts
  // 검수 탭 원본 열기: raw/ 사본을 OS 기본 앱으로. 경로 검증은 HarnessService가 하고(raw/ 내부만),
  // electron shell 의존 때문에 테스트 가능한 handlers() 맵이 아니라 여기 직접 등록한다(selectFolder 선례).
  ipcMain.handle(CH.harnessOpenSourceFile, async (_e, payload: unknown) => {
    const req = { runId: String((payload as { runId?: unknown })?.runId ?? ''), sourcePath: String((payload as { sourcePath?: unknown })?.sourcePath ?? '') }
    const resolved = container.harness.resolveRawSourceFile(req)
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    const err = await shell.openPath(resolved.absPath)
    return err ? { ok: false, reason: err } : { ok: true }
  })
```

주의: 이 파일 안에서 `container`가 `registerIpc(ipcMain, container)` 호출 전후 어느 스코프에 있는지 확인하고 같은 스코프에 등록한다(selectFolder 핸들러와 같은 위치면 안전).

- [ ] **Step 6: 검증 — typecheck**

Run: `pnpm typecheck`
Expected: 오류 0. (renderer/main/shared 모든 배선의 타입 일치를 이 단계가 보증한다.)

- [ ] **Step 7: 커밋**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/container.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): wire review-decisions, source-excerpt and open-source IPC channels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: store — 판단 상태 + setReviewVerdict + 하이드레이션

**Files:**
- Modify: `apps/desktop/src/renderer/harness-utils.ts` (`readFanoutSummary` 근처에 헬퍼 추가)
- Modify: `apps/desktop/src/renderer/store.ts`

**Interfaces:**
- Consumes: Task 6의 `api.harnessSetReviewDecisions`.
- Produces:
  - `readReviewDecisions(artifacts: HarnessRunArtifact[]): Record<string, 'approved' | 'excluded'>` (harness-utils)
  - store 상태 `harnessReviewDecisions: Record<string, 'approved' | 'excluded'>` (선택된 run 전용)
  - store 액션 `setReviewVerdict(proposalIds: string[], verdict: 'approved' | 'excluded' | null): Promise<void>` — null은 미결 복귀. 낙관적 갱신 후 IPC 실패 시 롤백.

- [ ] **Step 1: harness-utils 헬퍼**

`apps/desktop/src/renderer/harness-utils.ts`의 `readFanoutSummary`(line 225) 위에 추가:

```ts
/** 선택된 run bundle에서 검수 판단 map을 읽는다. artifact 부재(구 run·판단 전) → 빈 map. */
export function readReviewDecisions(artifacts: HarnessRunArtifact[]): Record<string, 'approved' | 'excluded'> {
  const data = artifacts.find((a) => a.name === 'review-decisions')?.data as
    { decisions?: Array<{ proposal_id: string; verdict: 'approved' | 'excluded' }> } | undefined
  const map: Record<string, 'approved' | 'excluded'> = {}
  for (const d of data?.decisions ?? []) map[d.proposal_id] = d.verdict
  return map
}
```

- [ ] **Step 2: store 상태·액션 추가**

`apps/desktop/src/renderer/store.ts` 수정.

(a) harness-utils import(line 13-27)에 `readReviewDecisions,` 추가.

(b) `ApcStore` 타입 — `harnessCanonicalBlock` 필드(line 92) 아래에:

```ts
  /** 선택된 run의 검수 판단(proposal_id → verdict). 미결은 키 부재. bundle의 review-decisions artifact에서
   * 하이드레이션되고, setReviewVerdict가 낙관적으로 갱신한 뒤 IPC로 전체 배열을 저장한다. */
  harnessReviewDecisions: Record<string, 'approved' | 'excluded'>
```

액션 선언부 — `promoteHarnessRun` 선언(line 135) 근처에:

```ts
  setReviewVerdict(proposalIds: string[], verdict: 'approved' | 'excluded' | null): Promise<void>
```

(c) 초기값 — `harnessCanonicalBlock: null,`(line 284) 아래에 `harnessReviewDecisions: {},` 추가.

(d) 하이드레이션 3곳:

`hydrateHarnessProject`(line 521-534)의 set 객체에 추가:
```ts
      harnessReviewDecisions: readReviewDecisions(
        runs.find((b) => b.runState.runId === selectedHarnessRunId)?.artifacts ?? []),
```

`selectHarnessRun`(line 536-542)의 set 호출을 다음으로 교체:
```ts
    const bundle = get().harnessRuns.find((b) => b.runState.runId === runId)
    set({
      selectedHarnessRunId: runId, harnessCanonicalProposals: [], harnessPromoteBlockedReason: null, harnessCanonicalBlock: null,
      harnessReviewDecisions: readReviewDecisions(bundle?.artifacts ?? []),
    })
```

`refreshHarnessRun`(line 587-608)의 성공 set(line 599)에 추가:
```ts
      harnessReviewDecisions: readReviewDecisions(bundle.artifacts),
```

`startHarnessRun`의 초기 set(line 552)에 `harnessReviewDecisions: {},` 추가(새 run은 판단 없음).

(e) 액션 구현 — `promoteHarnessRun` 앞에 추가:

```ts
  async setReviewVerdict(proposalIds, verdict) {
    const runId = get().selectedHarnessRunId
    if (!runId) return
    const prev = get().harnessReviewDecisions
    const next = { ...prev }
    for (const id of proposalIds) {
      if (verdict === null) delete next[id]
      else next[id] = verdict
    }
    set({ harnessReviewDecisions: next })
    try {
      const decided_at = new Date().toISOString()
      const decisions = Object.entries(next).map(([proposal_id, v]) => ({ proposal_id, verdict: v, decided_at }))
      const res = await api.harnessSetReviewDecisions({ runId, decisions })
      if (get().selectedHarnessRunId !== runId) return  // run이 바뀌었으면 이 응답은 무효 — 롤백도 하지 않는다
      if (!res.ok) set({ harnessReviewDecisions: prev, harnessMessage: `판단 저장 실패: ${res.reason ?? 'unknown'}` })
    } catch (e) {
      if (get().selectedHarnessRunId !== runId) return
      set({ harnessReviewDecisions: prev, harnessMessage: `판단 저장 실패: ${e}` })
    }
  },
```

(f) `promoteHarnessRun`(line 646-664)의 성공 메시지(line 660)를 다음으로 교체:

```ts
      const extra = [
        promoted.skippedByReview?.length ? `검수 제외 ${promoted.skippedByReview.length}건 반영 안 함` : null,
        promoted.danglingLinks ? `미해결 링크 ${promoted.danglingLinks}건` : null,
      ].filter(Boolean).join(' · ')
      set({ harnessMessage: `Promoted ${promoted.promoted?.length ?? 0} file(s)${extra ? ` — ${extra}` : ''}${allowInvalid ? ' (검증 무시)' : ''}`, harnessPromoteBlockedReason: null })
```

- [ ] **Step 3: 검증**

Run: `pnpm typecheck`
Expected: 오류 0. (store 동작 자체는 Task 8·9의 컴포넌트 테스트가 `useStore.setState`/실액션으로 검증한다.)

- [ ] **Step 4: 커밋**

```bash
git add apps/desktop/src/renderer/harness-utils.ts apps/desktop/src/renderer/store.ts
git commit -m "feat(desktop): add review verdict state with optimistic persistence to the store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: ReviewPanel 전면 개편 — 3영역 + 판단 + 필터 + 발췌 + diff

**Files:**
- Modify: `apps/desktop/src/renderer/components/ReviewPanel.tsx` (전면 교체)
- Test: `apps/desktop/src/renderer/components/ReviewPanel.test.tsx` (신규)

**Interfaces:**
- Consumes: `api.harnessReadStagedDoc`(기존) / `api.harnessReadSourceExcerpt` / `api.harnessOpenSourceFile`(Task 6); `parseUnifiedDiff`(harness-utils 기존).
- Produces (WikiGenDashboard가 Task 11에서 사용):
  - `export type ReviewVerdict = 'approved' | 'excluded'`
  - `export type ReviewFilter = 'all' | 'pending' | 'flagged' | 'approved' | 'excluded'`
  - Props: `{ runId, projectId, proposals, warnings, unverifiable, violations, diffPatch, decisions, onVerdict, initialFilter? }` — `unverifiable: EvidenceFinding[]`, `diffPatch: string | null`, `decisions: Record<string, ReviewVerdict>`, `onVerdict(proposalIds: string[], verdict: ReviewVerdict | null)`. 기존 `EvidenceFinding`·`PolicyViolation` export 유지.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/desktop/src/renderer/components/ReviewPanel.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { KhNodeProposal } from '@apc/shared'
import { ReviewPanel } from './ReviewPanel.js'

const apiMock = vi.hoisted(() => ({
  harnessReadStagedDoc: vi.fn(async () => ({ ok: false as const, reason: 'none' })),
  harnessReadSourceExcerpt: vi.fn(async () => ({ ok: true, matched: true, excerpt: 'ctx before\nalpha evidence\nctx after', line: 2 })),
  harnessOpenSourceFile: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../api.js', () => ({ api: apiMock }))

const proposal = (id: string, title: string, sourcePath: string): KhNodeProposal => ({
  proposal_id: `NP-${id}`, proposal_type: 'create_or_update_node', proposed_by: 'extractor',
  source_type: 'agent_session', created_at: '2026-07-21T00:00:00Z',
  node: { id, type: 'ConceptNode', scope: 'project', title, summary: `${title} 요약`, project_ids: [], tags: [] },
  claims: [{ claim_id: `CL-${id}`, text: `${title} claim`, claim_type: 'observation', confidence: 'medium', inference: false, evidence_ids: [`EV-${id}`] }],
  evidence: [{ evidence_id: `EV-${id}`, source_id: sourcePath, source_path: sourcePath, evidence_type: 'quote', quote_or_summary: 'alpha evidence', confidence: 'medium' }],
  claim_policy: { minimum_evidence_count: 1, requires_direct_source: true, allow_inference: true, inference_note_required: true },
  actions: [], risk: { level: 'low', reason: '' }, review: { requires_human_review: false, reviewer_question: '' },
})

const DIFF = [
  'diff --git a/nodes/n1.md b/nodes/n1.md',
  '--- a/nodes/n1.md', '+++ b/nodes/n1.md',
  '@@ -1,2 +1,2 @@', ' # Alpha', '-old line', '+new line', '',
].join('\n')

function renderPanel(over: Partial<Parameters<typeof ReviewPanel>[0]> = {}) {
  const onVerdict = vi.fn()
  render(<ReviewPanel
    runId="RUN-r" projectId="p1"
    proposals={[proposal('n1', 'Alpha', 'raw/a'), proposal('n2', 'Beta', 'raw/b')]}
    warnings={[]} unverifiable={[]} violations={[]}
    diffPatch={DIFF} decisions={{}} onVerdict={onVerdict}
    {...over}
  />)
  return { onVerdict }
}

describe('ReviewPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  test('renders 원본/AI 해석/반영 결과 sections and loads the source excerpt', async () => {
    renderPanel()
    expect(screen.getByText('📄 원본')).toBeDefined()
    expect(screen.getByText('🤖 AI 해석')).toBeDefined()
    expect(screen.getByText('📝 반영 결과')).toBeDefined()
    await waitFor(() => expect(apiMock.harnessReadSourceExcerpt).toHaveBeenCalledWith(
      { runId: 'RUN-r', sourcePath: 'raw/a', quote: 'alpha evidence' }))
    expect(await screen.findByText(/ctx before/)).toBeDefined()
    expect(screen.getByText('✓ 원문 일치')).toBeDefined()
  })

  test('shows an AI-summary badge when the quote has a verification warning', () => {
    renderPanel({ warnings: [{ proposal_id: 'NP-n1', evidence_id: 'EV-n1', source_path: 'raw/a', reason: 'quote_not_found' }] })
    expect(screen.getByText('⚠ AI 요약일 수 있음')).toBeDefined()
  })

  test('opens the source file via IPC when the path is clicked', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /raw\/a/ }))
    expect(apiMock.harnessOpenSourceFile).toHaveBeenCalledWith({ runId: 'RUN-r', sourcePath: 'raw/a' })
  })

  test('승인/제외 buttons report verdicts and re-clicking the active verdict clears it', () => {
    const { onVerdict } = renderPanel({ decisions: { 'NP-n1': 'approved' } })
    const bar = screen.getByTestId('review-verdict-bar')
    fireEvent.click(within(bar).getByRole('button', { name: /제외/ }))
    expect(onVerdict).toHaveBeenCalledWith(['NP-n1'], 'excluded')
    fireEvent.click(within(bar).getByRole('button', { name: /승인/ }))
    expect(onVerdict).toHaveBeenCalledWith(['NP-n1'], null)   // 활성 판단 재클릭 → 미결 복귀
  })

  test('filter chips narrow the list and bulk actions apply to visible items only', () => {
    const { onVerdict } = renderPanel({ decisions: { 'NP-n1': 'approved' } })
    // 정확 문자열 매칭: 좌측 항목 버튼의 접근성 이름에도 '미결' 배지 텍스트가 포함되므로 regex는 모호하다.
    fireEvent.click(screen.getByRole('button', { name: '미결' }))
    expect(screen.queryByRole('button', { name: /Alpha/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Beta/ })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '표시된 항목 모두 승인' }))
    expect(onVerdict).toHaveBeenCalledWith(['NP-n2'], 'approved')
  })

  test('renders the per-file diff for a pre-existing node file', () => {
    renderPanel()
    expect(screen.getByText('new line')).toBeDefined()
    expect(screen.getByText('old line')).toBeDefined()
  })

  test('verdict badges appear in the list', () => {
    renderPanel({ decisions: { 'NP-n1': 'approved', 'NP-n2': 'excluded' } })
    const list = screen.getByTestId('review-list')
    expect(within(list).getByText('✓ 승인')).toBeDefined()
    expect(within(list).getByText('✗ 제외')).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/ReviewPanel.test.tsx`
Expected: FAIL — 새 prop(`unverifiable` 등) 타입 불일치 / 섹션 텍스트 없음.

- [ ] **Step 3: ReviewPanel.tsx 전면 교체**

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { KhNodeProposal } from '@apc/shared'
import { api } from '../api.js'
import { parseUnifiedDiff } from '../harness-utils.js'
import { MarkdownContent } from './MarkdownContent.js'

export type EvidenceFinding = { proposal_id: string; evidence_id: string; source_path: string; reason: string }
export type PolicyViolation = { proposal_id: string; rule: string; severity: 'block' | 'warn'; detail: string }
export type ReviewVerdict = 'approved' | 'excluded'
export type ReviewFilter = 'all' | 'pending' | 'flagged' | 'approved' | 'excluded'

type Props = {
  runId: string
  projectId: string | null
  proposals: KhNodeProposal[]
  /** EvidenceVerifier soft findings (quote not verbatim) — 해당 인용은 AI 요약일 수 있음. */
  warnings: EvidenceFinding[]
  /** EvidenceVerifier blocking findings — 원본 자체를 확인할 수 없음. */
  unverifiable: EvidenceFinding[]
  /** PolicyGuard violations — the policy agent's per-proposal opinion. */
  violations: PolicyViolation[]
  /** git-diff-report artifact의 전체 patch (staging ↔ 실제 vault). null이면 diff 생략. */
  diffPatch: string | null
  /** proposal_id → verdict. 미결은 키 부재. */
  decisions: Record<string, ReviewVerdict>
  /** verdict=null은 미결 복귀. 일괄 작업은 여러 id를 한 번에 넘긴다. */
  onVerdict: (proposalIds: string[], verdict: ReviewVerdict | null) => void
  /** 개요 탭에서 넘어올 때의 시작 필터. */
  initialFilter?: ReviewFilter
}

const REASON_LABEL: Record<string, string> = {
  quote_not_found: '인용이 원문과 정확히 일치하지 않음 — 요약으로 간주됨',
  source_not_found: '근거 소스 파일을 찾을 수 없음',
  path_escape: '근거 경로가 vault를 벗어남',
}
const RULE_LABEL: Record<string, string> = {
  no_evidence: '근거 또는 주장이 없음',
  shared_evidence_min: 'shared 노드는 근거 2개 이상 필요',
  secret: '근거 텍스트에 비밀정보(키 등)로 의심되는 내용',
  raw_write: '쓰기 대상이 불변 raw/ 경로',
  delete: '삭제 작업은 금지',
  non_markdown_write: '쓰기 대상이 .md 파일이 아님',
  secret_in_write: '작성될 본문에 비밀정보 의심',
  canonical_overwrite: 'canonical 문서는 proposal_only여야 함',
}
const FILTER_CHIPS: { id: ReviewFilter; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'pending', label: '미결' }, { id: 'flagged', label: '경고' },
  { id: 'approved', label: '승인' }, { id: 'excluded', label: '제외' },
]
const MAX_EXCERPTS = 8

/** Severity score for ordering: surface the proposals that most need a human first. */
function attentionScore(p: KhNodeProposal, w: number, blocks: number, warnViol: number): number {
  return blocks * 100 + (p.evidence.length === 0 ? 60 : 0) + (p.risk?.level === 'high' ? 40 : 0) + warnViol * 10 + w
}

type Excerpt = { matched: boolean; excerpt: string; line?: number }

export function ReviewPanel({ runId, projectId, proposals, warnings, unverifiable, violations, diffPatch, decisions, onVerdict, initialFilter }: Props) {
  const grouped = useMemo(() => {
    const w = new Map<string, EvidenceFinding[]>()
    for (const x of warnings) w.set(x.proposal_id, [...(w.get(x.proposal_id) ?? []), x])
    const u = new Map<string, EvidenceFinding[]>()
    for (const x of unverifiable) u.set(x.proposal_id, [...(u.get(x.proposal_id) ?? []), x])
    const v = new Map<string, PolicyViolation[]>()
    for (const x of violations) v.set(x.proposal_id, [...(v.get(x.proposal_id) ?? []), x])
    return { w, u, v }
  }, [warnings, unverifiable, violations])

  const ordered = useMemo(() => {
    return [...proposals].sort((a, b) => {
      const wa = grouped.w.get(a.proposal_id) ?? [], wb = grouped.w.get(b.proposal_id) ?? []
      const va = grouped.v.get(a.proposal_id) ?? [], vb = grouped.v.get(b.proposal_id) ?? []
      const sa = attentionScore(a, wa.length, va.filter(x => x.severity === 'block').length, va.filter(x => x.severity === 'warn').length)
      const sb = attentionScore(b, wb.length, vb.filter(x => x.severity === 'block').length, vb.filter(x => x.severity === 'warn').length)
      return sb - sa
    })
  }, [proposals, grouped])

  const [filter, setFilter] = useState<ReviewFilter>(initialFilter ?? 'all')
  useEffect(() => { if (initialFilter) setFilter(initialFilter) }, [initialFilter])

  const flagged = useMemo(() => new Set(proposals
    .filter(p => p.evidence.length === 0
      || (grouped.w.get(p.proposal_id) ?? []).length > 0
      || (grouped.u.get(p.proposal_id) ?? []).length > 0
      || (grouped.v.get(p.proposal_id) ?? []).length > 0)
    .map(p => p.proposal_id)), [proposals, grouped])

  const visible = useMemo(() => ordered.filter(p => {
    const v = decisions[p.proposal_id]
    switch (filter) {
      case 'pending': return !v
      case 'approved': return v === 'approved'
      case 'excluded': return v === 'excluded'
      case 'flagged': return flagged.has(p.proposal_id)
      default: return true
    }
  }), [ordered, decisions, filter, flagged])

  const [selId, setSelId] = useState<string | null>(null)
  const selected = visible.find(p => p.proposal_id === selId) ?? visible[0] ?? null

  // Best-effort: load the rendered staging draft for the selected node (named nodes/<id>.md).
  const [draft, setDraft] = useState<{ id: string; content: string } | null>(null)
  useEffect(() => {
    if (!selected) { setDraft(null); return }
    const node = selected.node
    let stale = false
    void api.harnessReadStagedDoc({ runId, relPath: `nodes/${node.id}.md` }).then((res) => {
      if (!stale) setDraft(res.ok ? { id: node.id, content: res.content } : null)
    }).catch(() => { if (!stale) setDraft(null) })
    return () => { stale = true }
  }, [selected, runId, projectId])

  // 선택된 proposal의 evidence별 원문 발췌. MAX_EXCERPTS로 IPC 폭주를 막는다.
  const [excerpts, setExcerpts] = useState<Record<string, Excerpt | null>>({})
  useEffect(() => {
    if (!selected) { setExcerpts({}); return }
    let stale = false
    setExcerpts({})
    for (const ev of selected.evidence.slice(0, MAX_EXCERPTS)) {
      void api.harnessReadSourceExcerpt({ runId, sourcePath: ev.source_path, quote: ev.quote_or_summary || undefined })
        .then((res) => {
          if (stale) return
          setExcerpts((m) => ({ ...m, [ev.evidence_id]: res.ok ? { matched: res.matched ?? false, excerpt: res.excerpt ?? '', line: res.line } : null }))
        })
        .catch(() => { if (!stale) setExcerpts((m) => ({ ...m, [ev.evidence_id]: null })) })
    }
    return () => { stale = true }
  }, [selected, runId])

  const diffFiles = useMemo(() => (diffPatch ? parseUnifiedDiff(diffPatch) : []), [diffPatch])
  const nodeDiff = selected
    ? diffFiles.find(f => f.path.replace(/\\/g, '/').endsWith(`nodes/${selected.node.id}.md`))
    : undefined
  const isNewFile = !nodeDiff || nodeDiff.rows.every(r => r.kind === 'add')

  if (proposals.length === 0) return <div className="wikigen__placeholder">검수할 노드 제안이 없습니다.</div>

  const verdictOf = (id: string): ReviewVerdict | undefined => decisions[id]
  const evidenceBadge = (evidenceId: string) => {
    if (unverifiable.some(f => f.evidence_id === evidenceId)) return <span className="review__flag review__flag--err">⛔ 원본 확인 불가</span>
    if (warnings.some(f => f.evidence_id === evidenceId)) return <span className="review__flag review__flag--warn">⚠ AI 요약일 수 있음</span>
    return <span className="review__flag review__flag--ok">✓ 원문 일치</span>
  }

  return (
    <div className="review">
      <aside className="review__list" data-testid="review-list">
        <div className="review__filters">
          {FILTER_CHIPS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={filter === id}
              className={filter === id ? 'review__chip review__chip--on' : 'review__chip'}
              onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="review__bulk">
          <button type="button" onClick={() => onVerdict(visible.map(p => p.proposal_id), 'approved')}>표시된 항목 모두 승인</button>
          <button type="button" onClick={() => onVerdict(visible.map(p => p.proposal_id), null)}>표시된 항목 판단 해제</button>
        </div>
        {visible.map((p) => {
          const w = grouped.w.get(p.proposal_id) ?? []
          const v = grouped.v.get(p.proposal_id) ?? []
          const blocks = v.filter(x => x.severity === 'block').length
          const verdict = verdictOf(p.proposal_id)
          const on = (selected?.proposal_id === p.proposal_id)
          return (
            <button key={p.proposal_id} type="button" className={on ? 'review__item review__item--on' : 'review__item'} onClick={() => setSelId(p.proposal_id)}>
              <span className="review__item-title">{p.node.title}</span>
              <span className="review__item-tags">
                {verdict === 'approved' && <span className="review__flag review__flag--ok">✓ 승인</span>}
                {verdict === 'excluded' && <span className="review__flag review__flag--err">✗ 제외</span>}
                {!verdict && <span className="review__flag">미결</span>}
                <em className="review__type">{p.node.type.replace('Node', '')}</em>
                {p.evidence.length === 0 && <span className="review__flag review__flag--err">근거없음</span>}
                {blocks > 0 && <span className="review__flag review__flag--err">정책차단 {blocks}</span>}
                {p.risk?.level === 'high' && <span className="review__flag review__flag--warn">위험</span>}
                {w.length > 0 && <span className="review__flag">인용 {w.length}</span>}
                {p.review?.requires_human_review && <span className="review__flag review__flag--ask">질문</span>}
              </span>
            </button>
          )
        })}
        {visible.length === 0 && <p className="review__empty">이 필터에 해당하는 항목이 없습니다.</p>}
      </aside>

      {selected && (
        <section className="review__detail">
          <header className="review__detail-head">
            <h3>{selected.node.title}</h3>
            <div className="review__badges">
              <span className="review__badge">{selected.node.type}</span>
              <span className="review__badge">{selected.node.scope}</span>
              <span className="review__badge review__badge--muted">{selected.node.id}</span>
            </div>
          </header>

          {/* 1) 문서 원본 — 유일하게 AI를 거치지 않은 정보 */}
          <div className="review__source">
            <h4>📄 원본</h4>
            {selected.evidence.length === 0 && <p className="review__warnline review__warnline--err">이 제안은 인용된 원본이 없습니다.</p>}
            {selected.evidence.map((e) => {
              const ex = excerpts[e.evidence_id]
              return (
                <div key={e.evidence_id} className="review__ev">
                  <div className="review__ev-head">
                    <button type="button" className="review__ev-src" title="OS 기본 앱으로 원본 열기"
                      onClick={() => void api.harnessOpenSourceFile({ runId, sourcePath: e.source_path })}>
                      {e.source_path}
                    </button>
                    {evidenceBadge(e.evidence_id)}
                    {ex?.matched && ex.line !== undefined && <small>{ex.line}행</small>}
                  </div>
                  {e.quote_or_summary && <blockquote>{e.quote_or_summary}</blockquote>}
                  {ex && (
                    <pre className="review__excerpt" data-testid={`excerpt-${e.evidence_id}`}>
                      {ex.matched ? ex.excerpt : `(인용 위치를 찾지 못했습니다 — 파일 머리 표시)\n${ex.excerpt}`}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>

          {/* 2) AI의 해석 — 제목·요약·주장·에이전트 의견 전부 LLM 산출물 */}
          <div className="review__ai">
            <h4>🤖 AI 해석</h4>
            {selected.node.summary && <p className="review__summary">{selected.node.summary}</p>}
            <div className="review__claims">
              <h5>📌 주장 {selected.claims.length}개</h5>
              {selected.claims.map((c) => (
                <div key={c.claim_id} className="review__claim">
                  <p>{c.text}</p>
                  <span className="review__claim-meta">
                    {c.claim_type ? <em>{c.claim_type}</em> : null}
                    {c.confidence ? ` · 확신 ${c.confidence}` : ''}
                    {c.inference ? ' · 추론(AI가 원문에서 유추)' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="review__opinions">
              <div className="review__opinion">
                <span className="review__agent">🔍 추출기</span>
                <div>
                  {selected.risk && <p>위험도 <b className={`review__risk review__risk--${selected.risk.level}`}>{selected.risk.level}</b> — {selected.risk.reason}</p>}
                  {selected.review?.reviewer_question && <p className="review__question">❓ {selected.review.reviewer_question}</p>}
                </div>
              </div>
              <div className="review__opinion">
                <span className="review__agent">✓ 근거검증</span>
                <div>
                  {[...(grouped.u.get(selected.proposal_id) ?? []), ...(grouped.w.get(selected.proposal_id) ?? [])].length === 0
                    ? <p className="review__ok">모든 근거 인용 검증됨</p>
                    : [...(grouped.u.get(selected.proposal_id) ?? []), ...(grouped.w.get(selected.proposal_id) ?? [])].map((f, i) => (
                      <p key={i} className="review__warnline">⚠ {REASON_LABEL[f.reason] ?? f.reason} <small>({f.source_path.split(/[\\/]/).pop()})</small></p>
                    ))}
                </div>
              </div>
              <div className="review__opinion">
                <span className="review__agent">🛡 정책</span>
                <div>
                  {(grouped.v.get(selected.proposal_id) ?? []).length === 0
                    ? <p className="review__ok">정책 위반 없음</p>
                    : (grouped.v.get(selected.proposal_id) ?? []).map((x, i) => (
                      <p key={i} className={x.severity === 'block' ? 'review__warnline review__warnline--err' : 'review__warnline'}>
                        {x.severity === 'block' ? '🚫' : '⚠'} {RULE_LABEL[x.rule] ?? x.rule} <small>{x.detail}</small>
                      </p>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* 3) 승인 시 위키에 반영될 결과 */}
          <div className="review__result">
            <h4>📝 반영 결과</h4>
            {nodeDiff && !isNewFile ? (
              <div className="review__diff" data-testid="review-diff">
                {nodeDiff.rows.map((row, i) => (
                  <div key={i} className={`review__diff-row review__diff-row--${row.kind}`}>
                    <code>{row.kind === 'add' ? row.right : row.left}</code>
                  </div>
                ))}
              </div>
            ) : (
              <p className="review__new-file">🆕 신규 문서 — 승인하면 <code>nodes/{selected.node.id}.md</code>로 추가됩니다.</p>
            )}
            {draft && draft.id === selected.node.id && (
              <details className="review__draft">
                <summary>📄 생성된 초안 (staging)</summary>
                <MarkdownContent markdown={draft.content} onOpenWikiLink={() => { /* 검수 화면에서는 링크 점프 비활성 */ }} />
              </details>
            )}
          </div>

          <div className="review__verdict" data-testid="review-verdict-bar">
            <button type="button"
              className={verdictOf(selected.proposal_id) === 'approved' ? 'review__verdict-btn review__verdict-btn--on' : 'review__verdict-btn'}
              onClick={() => onVerdict([selected.proposal_id], verdictOf(selected.proposal_id) === 'approved' ? null : 'approved')}>
              ✓ 승인
            </button>
            <button type="button"
              className={verdictOf(selected.proposal_id) === 'excluded' ? 'review__verdict-btn review__verdict-btn--on' : 'review__verdict-btn'}
              onClick={() => onVerdict([selected.proposal_id], verdictOf(selected.proposal_id) === 'excluded' ? null : 'excluded')}>
              ✗ 제외
            </button>
            <span className="review__verdict-state">
              {verdictOf(selected.proposal_id) === 'approved' ? '승인됨 — 반영 대상' : verdictOf(selected.proposal_id) === 'excluded' ? '제외됨 — 반영 안 함' : '미결 — promote 시 반영 안 함'}
            </span>
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/ReviewPanel.test.tsx`
Expected: PASS (7 tests). diff 테스트에서 `old line`/`new line`이 함께 렌더되는지(각 row의 kind별 한 줄) 확인.

- [ ] **Step 5: 커밋**

```bash
git add apps/desktop/src/renderer/components/ReviewPanel.tsx apps/desktop/src/renderer/components/ReviewPanel.test.tsx
git commit -m "feat(desktop): rebuild review panel with source/AI/result sections and verdicts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Quality 지표 정리 — shared_promotion_candidates 실계산, next_task 표시 제거

**Files:**
- Modify: `packages/knowledge-harness/src/eval/eval-report.ts`
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (HUMAN_REVIEW_REQUIRED 드라이버)
- Modify: `apps/desktop/src/renderer/components/QualityPanel.tsx`
- Test: `packages/knowledge-harness/src/eval/eval-report.test.ts`, `apps/desktop/src/renderer/components/QualityPanel.test.tsx`

**Interfaces:**
- Produces: `EvalInputs`에 `sharedPromotion?: { candidates: unknown[] }` 추가; `usefulness.shared_promotion_candidates`가 실제 후보 수. `KhEvalReportSchema`의 `next_task_candidates` 필드는 호환성 위해 유지(항상 0), UI 행만 제거.

- [ ] **Step 1: 실패하는 테스트 추가**

`packages/knowledge-harness/src/eval/eval-report.test.ts` 끝에 테스트 추가:

```ts
test('counts shared promotion candidates from the lead plan', () => {
  const report = buildEvalReport({
    sharedPromotion: { candidates: [{ node_id: 'n1' }, { node_id: 'n2' }] },
  })
  expect(report.usefulness.shared_promotion_candidates).toBe(2)
})
```

(파일 상단 import·기존 형식은 그대로 따른다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/knowledge-harness/src/eval/eval-report.test.ts`
Expected: FAIL — `sharedPromotion`이 EvalInputs에 없음(타입) 또는 값 0.

- [ ] **Step 3: 구현**

(a) `eval-report.ts`의 `EvalInputs`(line 7-16)에 추가:

```ts
  /** lead의 shared-promotion-plan artifact — shared 승격 후보 수의 실데이터 소스. */
  sharedPromotion?: { candidates: unknown[] }
```

`usefulness` 블록(line 60-64)을 교체:

```ts
    usefulness: {
      current_update_proposals: inputs.applied?.proposals.length ?? 0,
      // next_task_candidates: 계산할 데이터 소스가 아직 없다 — 스키마 default 0으로 남긴다(UI는 표시하지 않음).
      shared_promotion_candidates: inputs.sharedPromotion?.candidates.length ?? 0,
    },
```

(b) `make-drivers.ts`의 HUMAN_REVIEW_REQUIRED 드라이버 — `buildEvalReport({...})` 호출(line 679-687)에 인자 추가. artifactByName은 raw JSON을 주므로(Zod default 미적용) `candidates` 부재를 여기서 흡수한다:

```ts
        sharedPromotion: { candidates: (artifactByName<{ candidates?: unknown[] }>(ctx, 'LEAD_MERGED', ARTIFACTS.sharedPromotionPlan)?.candidates) ?? [] },
```

(c) `QualityPanel.tsx`의 '유용성' 그룹(line 31-35)에서 `next_task_candidates` 행 삭제:

```ts
    { title: '유용성', rows: [
      { key: 'current_update_proposals', label: 'current 업데이트 제안', value: us.current_update_proposals },
      { key: 'shared_promotion_candidates', label: 'shared 승격 후보', value: us.shared_promotion_candidates },
    ] },
```

(d) `QualityPanel.test.tsx` line 11의 픽스처는 그대로 두되, `q-next_task_candidates` testid를 참조하는 단언이 있으면 삭제한다. `npx vitest run apps/desktop/src/renderer/components/QualityPanel.test.tsx`를 돌려 실패하는 단언만 제거.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/knowledge-harness/src/eval/eval-report.test.ts apps/desktop/src/renderer/components/QualityPanel.test.tsx packages/knowledge-harness/src/runtime/make-drivers.test.ts`
Expected: PASS. (make-drivers.test에 eval usefulness 스냅숏 단언이 있으면 shared_promotion_candidates 값 변화에 맞춰 수정.)

- [ ] **Step 5: 커밋**

```bash
git add packages/knowledge-harness/src/eval/eval-report.ts packages/knowledge-harness/src/eval/eval-report.test.ts packages/knowledge-harness/src/runtime/make-drivers.ts apps/desktop/src/renderer/components/QualityPanel.tsx apps/desktop/src/renderer/components/QualityPanel.test.tsx
git commit -m "fix(harness): compute shared promotion candidates from the lead plan and drop the dead next-task metric row

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: OverviewPanel 신설

**Files:**
- Create: `apps/desktop/src/renderer/components/OverviewPanel.tsx`
- Test: `apps/desktop/src/renderer/components/OverviewPanel.test.tsx`

**Interfaces:**
- Consumes: `CoverageMatrix`, `QualityPanel`, `ReviewFilter`(Task 8), `FanoutSummary`/`HarnessRunBundle`(harness-utils).
- Produces: `OverviewPanel` — props `{ run, coverage?, quality?, proposalsCount, approvedCount, excludedCount, warningCount, fanout, onGoToReview(filter), onOpenSource(path), children? }`. Task 11의 WikiGenDashboard가 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/desktop/src/renderer/components/OverviewPanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { HarnessRunBundle } from '../harness-utils.js'
import { OverviewPanel } from './OverviewPanel.js'

function run(state = 'HUMAN_REVIEW_REQUIRED'): HarnessRunBundle {
  return {
    runState: {
      runId: 'RUN-r', state, engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-07-21T00:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [],
  }
}

describe('OverviewPanel', () => {
  test('headline chips navigate to the review tab with the matching filter', () => {
    const onGoToReview = vi.fn()
    render(<OverviewPanel run={run()} proposalsCount={5} approvedCount={2} excludedCount={1} warningCount={3}
      fanout={null} onGoToReview={onGoToReview} onOpenSource={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /미결 2/ }))
    expect(onGoToReview).toHaveBeenCalledWith('pending')
    fireEvent.click(screen.getByRole('button', { name: /승인 2/ }))
    expect(onGoToReview).toHaveBeenCalledWith('approved')
    fireEvent.click(screen.getByRole('button', { name: /경고 3/ }))
    expect(onGoToReview).toHaveBeenCalledWith('flagged')
  })

  test('shows coverage placeholder without data and wires onOpenSource with data', () => {
    const onOpenSource = vi.fn()
    const { rerender } = render(<OverviewPanel run={run()} proposalsCount={0} approvedCount={0} excludedCount={0}
      warningCount={0} fanout={null} onGoToReview={() => {}} onOpenSource={onOpenSource} />)
    expect(screen.getByText(/커버리지 데이터 없음/)).toBeDefined()
    rerender(<OverviewPanel run={run()} proposalsCount={0} approvedCount={0} excludedCount={0} warningCount={0}
      fanout={null} onGoToReview={() => {}} onOpenSource={onOpenSource}
      coverage={{ sources: [{ path: 'raw/a', status: 'unmapped', citedBy: [] }], nodes: [], totals: { sourcesTotal: 1, covered: 0, unmapped: 1 } }} />)
    fireEvent.click(screen.getByRole('button', { name: /raw\/a/ }))
    expect(onOpenSource).toHaveBeenCalledWith('raw/a')
  })

  test('shows the FAILED error line for a failed run', () => {
    const failed = run('FAILED')
    ;(failed.runState as { error?: string }).error = 'boom'
    render(<OverviewPanel run={failed} proposalsCount={0} approvedCount={0} excludedCount={0} warningCount={0}
      fanout={null} onGoToReview={() => {}} onOpenSource={() => {}} />)
    expect(screen.getByText(/boom/)).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/OverviewPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: 구현**

`apps/desktop/src/renderer/components/OverviewPanel.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { KhCoverageReport, KhEvalReport } from '@apc/shared'
import type { FanoutSummary, HarnessRunBundle } from '../harness-utils.js'
import { CoverageMatrix } from './CoverageMatrix.js'
import { QualityPanel } from './QualityPanel.js'
import type { ReviewFilter } from './ReviewPanel.js'

type Props = {
  run: HarnessRunBundle
  coverage?: KhCoverageReport
  quality?: KhEvalReport
  proposalsCount: number
  approvedCount: number
  excludedCount: number
  /** 근거없음·인용불일치·원본미확인·정책위반 중 하나라도 있는 proposal 수 — 검수 'flagged' 필터와 동일 기준. */
  warningCount: number
  fanout: FanoutSummary | null
  onGoToReview: (filter: ReviewFilter) => void
  onOpenSource: (sourcePath: string) => void
  /** 실행 직후의 WikiProgress 임베드 슬롯. */
  children?: ReactNode
}

export function OverviewPanel({ run, coverage, quality, proposalsCount, approvedCount, excludedCount, warningCount, fanout, onGoToReview, onOpenSource, children }: Props) {
  const pendingCount = proposalsCount - approvedCount - excludedCount
  return (
    <div className="wikigen__summary overview">
      {children}
      {run.runState.state === 'FAILED' && (
        <p className="wikigen__error">❌ 실패: {run.runState.error ?? '원인 미상'} — 실행 이력에서 ↻ 이어하기</p>
      )}

      {proposalsCount > 0 ? (
        <div className="overview__chips" data-testid="overview-chips">
          <button type="button" onClick={() => onGoToReview('all')}>노드 제안 {proposalsCount}</button>
          <button type="button" onClick={() => onGoToReview('approved')}>✓ 승인 {approvedCount}</button>
          <button type="button" onClick={() => onGoToReview('excluded')}>✗ 제외 {excludedCount}</button>
          <button type="button" onClick={() => onGoToReview('pending')}>미결 {pendingCount}</button>
          <button type="button" className={warningCount > 0 ? 'overview__chip--warn' : undefined}
            onClick={() => onGoToReview('flagged')}>⚠ 경고 {warningCount}</button>
        </div>
      ) : (
        <p>검수할 노드 제안이 없습니다.</p>
      )}
      {coverage && (
        <p className="overview__coverage-line">소스 반영 {coverage.totals.covered}/{coverage.totals.sourcesTotal} · 누락 {coverage.totals.unmapped}</p>
      )}
      <p className="wikigen__hint">항목별 승인·제외는 🔎 검수 탭에서 합니다. 생성된 위키 문서는 📖 Knowledge 탭에서 읽습니다.</p>

      {fanout && (
        <div className="wikigen__folders">
          <h4>📁 폴더 워커 (orchestrator-workers)</h4>
          <p>{fanout.units}개 폴더 단위 · {fanout.ran}개 실행{fanout.skipped.length ? ` · ${fanout.skipped.length}개 스킵` : ''}</p>
          <ul className="wikigen__folder-list">
            {fanout.folders.map((f) => (
              <li key={f.label}>📁 {f.label}{f.role ? <em className="wikigen__folder-role"> {f.role}</em> : null}{f.members && f.members !== f.label ? <small> — {f.members}</small> : null}</li>
            ))}
          </ul>
          {fanout.skipped.length > 0 && (
            <ul className="wikigen__folder-skipped">
              {fanout.skipped.map((s) => <li key={s.unit} title={s.reason}>⚠ {s.unit} 스킵</li>)}
            </ul>
          )}
        </div>
      )}

      <section className="overview__section">
        <h4>📊 Coverage</h4>
        {coverage
          ? <CoverageMatrix data={coverage} onOpenSource={onOpenSource} />
          : <p className="wikigen__placeholder">커버리지 데이터 없음 — 전체 문서 모드로 실행하세요.</p>}
      </section>
      <section className="overview__section">
        <h4>📈 Quality</h4>
        {quality ? <QualityPanel data={quality} /> : <p className="wikigen__placeholder">품질 데이터 없음.</p>}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/OverviewPanel.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/desktop/src/renderer/components/OverviewPanel.tsx apps/desktop/src/renderer/components/OverviewPanel.test.tsx
git commit -m "feat(desktop): add overview panel with decision headline chips

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: WikiGenDashboard 재편 — 4탭 + 승인 N건 반영 푸터 + 죽은 컴포넌트 삭제

**Files:**
- Modify: `apps/desktop/src/renderer/components/WikiGenDashboard.tsx`
- Modify: `apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx`
- Delete: `apps/desktop/src/renderer/components/ProposalsPanel.tsx`, `ProposalsPanel.test.tsx`, `ReviewActions.tsx`, `ReviewActions.test.tsx`

**Interfaces:**
- Consumes: `OverviewPanel`(Task 10), ReviewPanel 신규 props(Task 8), store의 `harnessReviewDecisions`/`setReviewVerdict`(Task 7), `api.harnessOpenSourceFile`(Task 6).

- [ ] **Step 1: 기존 테스트를 새 구조에 맞게 수정 (실패 상태로 작성)**

`WikiGenDashboard.test.tsx` 수정:

(a) line 69-75의 탭 테스트 교체:

```tsx
  test('renders 실행 이력 rail and review subtabs', () => {
    render(<WikiGenDashboard />)
    expect(screen.getByText('실행 이력')).toBeDefined()
    for (const label of ['개요', '🔎 검수', '구조', '진행']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    expect(screen.queryByRole('button', { name: 'Proposals' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Coverage' })).toBeNull()
  })
```

(b) line 84-88의 실행 중 테스트에서 `'Coverage'` → `'🔎 검수'`로 교체.

(c) line 100-104의 placeholder 테스트 교체:

```tsx
  test('개요 탭은 커버리지 데이터가 없으면 placeholder를 보여준다', () => {
    render(<WikiGenDashboard />)
    expect(screen.getByText(/커버리지 데이터 없음/)).toBeDefined()
  })
```

(d) 파일 끝(describe 안)에 신규 테스트 추가:

```tsx
  test('promote button reflects approved count and confirms pending items', () => {
    const promoteHarnessRun = vi.fn(async () => {})
    const run = reviewRun()
    run.artifacts.push({
      state: 'NODE_PROPOSALS_CREATED', name: 'node-proposals', path: 'np',
      data: { proposals: [
        { proposal_id: 'NP-1', proposed_by: 'x', created_at: 't', node: { id: 'n1', type: 'ConceptNode', title: 'A' }, claims: [], evidence: [] },
        { proposal_id: 'NP-2', proposed_by: 'x', created_at: 't', node: { id: 'n2', type: 'ConceptNode', title: 'B' }, claims: [], evidence: [] },
      ] },
    })
    useStore.setState({ harnessRuns: [run], promoteHarnessRun, harnessReviewDecisions: { 'NP-1': 'approved' } })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<WikiGenDashboard />)
    const btn = screen.getByRole('button', { name: '승인 1건 반영' })
    fireEvent.click(btn)
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('미결 1건'))
    expect(promoteHarnessRun).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  test('promote is disabled when proposals exist but nothing is approved', () => {
    const run = reviewRun()
    run.artifacts.push({
      state: 'NODE_PROPOSALS_CREATED', name: 'node-proposals', path: 'np',
      data: { proposals: [
        { proposal_id: 'NP-1', proposed_by: 'x', created_at: 't', node: { id: 'n1', type: 'ConceptNode', title: 'A' }, claims: [], evidence: [] },
      ] },
    })
    useStore.setState({ harnessRuns: [run], harnessReviewDecisions: {} })
    render(<WikiGenDashboard />)
    expect((screen.getByRole('button', { name: '승인 0건 반영' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('overview chip click switches to the review tab with the filter applied', () => {
    const run = reviewRun()
    run.artifacts.push({
      state: 'NODE_PROPOSALS_CREATED', name: 'node-proposals', path: 'np',
      data: { proposals: [
        { proposal_id: 'NP-1', proposed_by: 'x', created_at: 't', node: { id: 'n1', type: 'ConceptNode', title: 'A' }, claims: [], evidence: [] },
      ] },
    })
    useStore.setState({ harnessRuns: [run], harnessReviewDecisions: {} })
    render(<WikiGenDashboard />)
    fireEvent.click(screen.getByRole('button', { name: /미결 1/ }))
    expect(screen.getByTestId('review-verdict-bar')).toBeDefined()  // 검수 탭이 열림
  })
```

주의: 검수 탭 렌더에는 apiMock에 `harnessReadStagedDoc`·`harnessReadSourceExcerpt`·`harnessOpenSourceFile` mock이 필요하다 — 파일 상단 `apiMock` 객체(line 8-14)에 추가:

```ts
  harnessReadStagedDoc: vi.fn(async () => ({ ok: false, reason: 'none' })),
  harnessReadSourceExcerpt: vi.fn(async () => ({ ok: false, reason: 'none' })),
  harnessOpenSourceFile: vi.fn(async () => ({ ok: true })),
```

또 `setReviewVerdict: async () => {}`를 `useStore.setState` 공통 beforeEach(line 60-66)에 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx`
Expected: FAIL — 탭 라벨·버튼이 아직 구버전.

- [ ] **Step 3: WikiGenDashboard.tsx 수정**

(a) import 정리 — `CoverageMatrix`/`QualityPanel`/`ProposalsPanel` import 제거, 추가:

```tsx
import { OverviewPanel } from './OverviewPanel.js'
import { ReviewPanel, type EvidenceFinding, type PolicyViolation, type ReviewFilter } from './ReviewPanel.js'
```

(b) 탭 정의(line 26-31) 교체:

```tsx
type ReviewTab = 'overview' | 'review' | 'structure' | 'flow'

const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
  { id: 'overview', label: '개요' }, { id: 'review', label: '🔎 검수' },
  { id: 'structure', label: '구조' }, { id: 'flow', label: '진행' },
]
```

(c) 상태(line 45) 교체 + 추가:

```tsx
  const [reviewTab, setReviewTab] = useState<ReviewTab>('overview')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
```

store 구독(line 34-43)에 `harnessReviewDecisions, setReviewVerdict,` 추가.

(d) 파생값 — `policyViolations`(line 152) 다음에 추가:

```tsx
  const evidenceUnverifiable = (currentRun?.artifacts.find((a) => a.name === 'evidence-verification-report')?.data as { unverifiable?: EvidenceFinding[] } | undefined)?.unverifiable ?? []
  const gitDiffPatch = (currentRun?.artifacts.find((a) => a.name === 'git-diff-report')?.data as { patch?: string } | undefined)?.patch ?? null
  const approvedCount = proposalsData?.filter((p) => harnessReviewDecisions[p.proposal_id] === 'approved').length ?? 0
  const excludedCount = proposalsData?.filter((p) => harnessReviewDecisions[p.proposal_id] === 'excluded').length ?? 0
  const pendingCount = (proposalsData?.length ?? 0) - approvedCount - excludedCount
  const warningCount = proposalsData?.filter((p) => p.evidence.length === 0
    || evidenceWarnings.some((w) => w.proposal_id === p.proposal_id)
    || evidenceUnverifiable.some((w) => w.proposal_id === p.proposal_id)
    || policyViolations.some((v) => v.proposal_id === p.proposal_id)).length ?? 0
  // 판단 게이트는 노드 제안이 있는 run에만 적용 — 구식/제안-없는 run은 레거시 전체 promote 그대로.
  const reviewGated = !!proposalsData && proposalsData.length > 0
  const goToReview = (filter: ReviewFilter) => { setReviewFilter(filter); setReviewTab('review') }
  const openSource = (sourcePath: string) => {
    if (currentRun) void api.harnessOpenSourceFile({ runId: currentRun.runState.runId, sourcePath })
  }
```

(e) 탭 콘텐츠(line 253-306) 교체:

```tsx
              <div className="wikigen__content">
                {reviewTab === 'overview' && (
                  <OverviewPanel run={currentRun} coverage={coverageData} quality={evalData}
                    proposalsCount={proposalsData?.length ?? 0}
                    approvedCount={approvedCount} excludedCount={excludedCount} warningCount={warningCount}
                    fanout={fanout} onGoToReview={goToReview} onOpenSource={openSource}>
                    {progressForCurrentRun && wikiProgress && (
                      <WikiProgress
                        progress={wikiProgress}
                        liveLabel={harnessLiveLabel}
                        liveTail={harnessLiveTail}
                        onReadLog={readProgressLog}
                      />
                    )}
                  </OverviewPanel>
                )}
                {reviewTab === 'review' && (proposalsData && proposalsData.length > 0
                  ? <ReviewPanel runId={currentRun.runState.runId} projectId={selectedProjectId}
                      proposals={proposalsData} warnings={evidenceWarnings} unverifiable={evidenceUnverifiable}
                      violations={policyViolations} diffPatch={gitDiffPatch}
                      decisions={harnessReviewDecisions}
                      onVerdict={(ids, v) => void setReviewVerdict(ids, v)}
                      initialFilter={reviewFilter} />
                  : <div className="wikigen__placeholder">검수할 노드 제안이 없습니다 — 전체 문서 모드로 실행하세요.</div>)}
                {reviewTab === 'structure' && <ProjectStructureView artifacts={currentRun.artifacts} />}
                {reviewTab === 'flow' && <TaskFlowView run={currentRun} />}
              </div>
```

(f) Promote 푸터의 첫 버튼(line 310-317) 교체:

```tsx
                  <button
                    type="button"
                    disabled={harnessLoading || !canPromote || (reviewGated && approvedCount === 0)}
                    title={!canPromote
                      ? '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 promote할 수 있습니다'
                      : reviewGated && approvedCount === 0
                        ? '검수 탭에서 항목을 승인해야 반영할 수 있습니다'
                        : '승인한 항목만 vault로 반영'}
                    onClick={() => {
                      if (reviewGated && pendingCount > 0
                        && !window.confirm(`미결 ${pendingCount}건은 반영되지 않습니다. 승인 ${approvedCount}건만 반영할까요?`)) return
                      void promoteHarnessRun()
                    }}
                  >
                    {reviewGated ? `승인 ${approvedCount}건 반영` : 'Promote run'}
                  </button>
```

(g) 죽은 파일 삭제:

```bash
git rm apps/desktop/src/renderer/components/ProposalsPanel.tsx apps/desktop/src/renderer/components/ProposalsPanel.test.tsx apps/desktop/src/renderer/components/ReviewActions.tsx apps/desktop/src/renderer/components/ReviewActions.test.tsx
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx apps/desktop/src/renderer/components/ReviewPanel.test.tsx apps/desktop/src/renderer/components/OverviewPanel.test.tsx`
Expected: 전부 PASS.

Run: `pnpm typecheck`
Expected: 오류 0 (ProposalsPanel/ReviewActions 참조 잔재가 있으면 여기서 드러난다).

- [ ] **Step 5: 커밋**

```bash
git add -A apps/desktop/src/renderer/components/
git commit -m "refactor(desktop): reorganize wiki-gen into overview/review/structure/flow tabs with approved-only promote

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: 최종 검증

**Files:** (수정 없음 — 검증 전용; 실패 시 해당 태스크로 돌아가 수정)

- [ ] **Step 1: 전체 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 0.

- [ ] **Step 2: 전체 테스트**

Run: `pnpm test`
Expected: 전부 PASS (~2.5분). 실패가 있으면: 이 계획이 바꾼 표면(promote 결과 필드, eval usefulness 값, WikiGen 탭 구조)을 참조하는 기존 테스트인지 확인하고 새 동작에 맞게 그 테스트를 수정한다 — 새 동작이 spec과 다르면 구현을 고친다.

- [ ] **Step 3: spec 대조 체크리스트**

`docs/superpowers/specs/2026-07-21-wikigen-review-redesign-design.md`의 각 섹션에 대응 확인:
- §3 탭 4개·개요 칩 네비·검수 3영역·promote 푸터 → Task 8·10·11
- §4 스키마·artifact → Task 1·2
- §5 IPC (readNodeDiff는 bundle의 git-diff-report 재사용으로 대체 — 계획 서두 Architecture 참조) → Task 6
- §6 promote 의미·ledger·미해결 링크 → Task 5
- §7 부채 정리 → Task 9·11
- §8 에러 처리 → Task 2·4·5 테스트
- §9 테스트 계획 → 각 태스크 테스트

- [ ] **Step 4: 커밋 로그 확인 후 종료 보고**

Run: `git log --oneline feat/resume-recall-surface..HEAD`
Expected: 스펙 커밋 + Task 1~11의 커밋 11개 내외. 이후 superpowers:finishing-a-development-branch 스킬로 병합/PR 결정(베이스: feat/resume-recall-surface — 스택 PR임을 PR 본문에 명시).
