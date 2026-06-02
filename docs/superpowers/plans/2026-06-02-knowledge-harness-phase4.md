# Knowledge Harness — Phase 4 (표면: CLI + Service + Promote + Desktop IPC) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:test-driven-development. Surfaces are thin over the Phase 1-3
> runtime; everything testable uses `FakeAgentRunner` + temp dirs. Renderer React UI is wired at the
> IPC boundary (handlers + contract types tested); pixel UI is a manual follow-up, not unit-tested.

**Goal:** 파이프라인을 사람이 실제로 구동·조회·승인(promote)할 수 있게 한다.
(1) `HarnessService` — run/show/promote 오케스트레이션 (deps 주입, `@apc/app-services`).
(2) CLI bin `knowledge-harness run|show|promote` — `HarnessService` 위 얇은 디스패처.
(3) `HarnessPromoteService` — staging→real vault 반영(비-canonical만 자동, canonical은 `.proposal.md`로 보존).
(4) 데스크톱 IPC 채널 3종 + container DI(`GenerateService`와 동일 패턴, `FakeAgentRunner`로 테스트).

**Architecture:** `HarnessService`는 `@apc/app-services`에 둔다(기존 `GenerateService` 옆). 의존으로
`@apc/knowledge-harness` 추가(역방향 의존 없음 → 순환 없음). 실제 LLM은 `CliAgentRunner`, 테스트는
`FakeAgentRunner`. CLI는 `HarnessService`를 생성해 argv를 매핑하는 순수 디스패처 + 얇은 bin.

**MVP promote 정책(설계 §8, feature-gates):** `auto_write_to_real_vault=false`, `auto_update_current=false`.
따라서 promote는 evidence 기반 신규/관련 노드(AppliedWriteReport.applied[], 비-canonical)만 real vault에
복사하고, canonical 대상(`.proposal.md`)은 real vault에 **proposal로만** 떨궈 사람이 Obsidian에서 병합한다.
(구조화된 `projects/<id>/current.md` 흐름의 hash-gated 병합은 기존 `CurrentPromotionService` 소관 — 별개 경로.)

---

## File Structure
- `packages/app-services/src/harness-service.ts` (+ test) — run/show/promote orchestration.
- `packages/app-services/src/harness-promote-service.ts` (+ test) — staging→vault apply.
- `packages/app-services/package.json` — dep `@apc/knowledge-harness`.
- `packages/knowledge-harness/src/cli.ts` (+ test) — argv→action 디스패처(주입형).
- `packages/knowledge-harness/package.json` — `bin: { "knowledge-harness": "./src/cli.ts" }` + shebang.
- `apps/desktop/src/shared/ipc-contract.ts` — `harnessRun`/`harnessGetRun`/`harnessPromote` 채널 + 타입.
- `apps/desktop/src/main/container.ts` — `HarnessService` DI + 3 핸들러 등록.

---

## Task 1: HarnessPromoteService (staging→vault apply)

`promote({ runId })`: run state 로드 → HUMAN_REVIEW_REQUIRED 아니면 거부 → AppliedWriteReport 읽기 →
`applied[]`(비-canonical) 파일을 stagingRoot→vaultRoot 복사, `proposals[]`(.proposal.md)는 vault에
proposal로 복사(덮어쓰기 금지) → `{ ok, promoted: string[], proposals: string[] }`.

- [ ] TDD: temp vault+staging+run. applied=['concepts/n1.md'], proposals=['current.proposal.md'] →
  vault에 concepts/n1.md 생성, current.proposal.md 생성, 기존 current.md 불변. FAILED run → 거부.
- [ ] Commit `feat(app-services): HarnessPromoteService — staging→vault apply (canonical stays proposal)`.

## Task 2: HarnessService (run / show / promote)

deps: `{ runner, registry, vaultRoot, runsRoot, gatesPath, preamble, now }`.
- `run({ projectId, engine })`: runId 생성(now stamp) → `RunArtifactStore(runsRoot/runId)` →
  `makeDrivers({runner, vaultRoot, stagingRoot: runsRoot/runId/vault-staging, preamble})` →
  `HarnessRunner({gates: FeatureGate.fromFile(gatesPath), drivers, now})` → createRun + advance →
  `{ ok, runId, finalState, evalReportPath?, diffPath?, reportPath? }`.
- `show({ runId })`: RunState + artifact 인덱스.
- `promote({ runId })`: HarnessPromoteService 위임.

- [ ] TDD: FakeAgentRunner canned outputs → run reaches HUMAN_REVIEW_REQUIRED, show returns state,
  promote copies into vault. Commit `feat(app-services): HarnessService — run/show/promote orchestration`.

## Task 3: CLI bin (knowledge-harness run|show|promote)

`parseArgs(argv)` → `{ cmd, opts }` (순수, 테스트). `runCli(args, service, out)` 디스패처. bin은 shebang +
deps 조립(CliAgentRunner, registry, paths) 후 `runCli`. 알 수 없는 명령/누락 플래그는 usage + 비0 종료코드.

- [ ] TDD: parseArgs 단위 + runCli(fake service) 디스패치 단위. Commit
  `feat(knowledge-harness): CLI bin (run/show/promote) over HarnessService`.

## Task 4: Desktop IPC + container DI

- ipc-contract: `harnessRun: 'c:harnessRun'` 등 + `HarnessRunReq/Res`, `HarnessGetRunReq/Res`,
  `HarnessPromoteReq/Res`.
- container: `HarnessService` 생성(CliAgentRunner, vaultRoot, runsRoot=…/runs, gatesPath) + 3 핸들러.
- [ ] TDD: container 핸들러를 FakeAgentRunner로 호출하는 단위 테스트(기존 container 테스트 패턴). Commit
  `feat(desktop): harness IPC channels + container DI (run/show/promote)`.

## Task 5: 전체 suite + 수용 기준 확인
- [ ] `pnpm test` green.
- [ ] 설계 §12 수용 기준 1·3·6(run 완주/staging-only/resume) + 7(promote)에 대응하는 테스트 존재 확인.
- [ ] Commit (테스트 추가분).

---

## Phase 4 완료 기준
- `knowledge-harness run --project p --engine claude`가 CREATED→HUMAN_REVIEW_REQUIRED를 완주(실 LLM은
  CliAgentRunner; 테스트는 Fake)하고 `runs/RUN-*/`에 산출물을 남긴다.
- `show`가 run 상태/artifact를 출력, `promote`가 staging의 비-canonical을 real vault에 반영(canonical은 proposal 유지).
- 데스크톱 3 IPC가 동작(핸들러 단위 테스트), `pnpm test` green.

## Phase 4 비포함 / P1
- 렌더러 React UI(타임라인/diff 뷰/Promote 패널) 픽셀 구현은 수동 후속(이 단계는 IPC/서비스 경계까지).
- git-worktree staging, 실제 CLI LLM 통합 테스트(agent 버전 의존), 스케줄 실행.
