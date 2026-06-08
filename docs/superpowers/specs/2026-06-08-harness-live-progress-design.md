---
title: Harness run 실시간 단계 진행 표시 (live progress) 설계
date: 2026-06-08
status: design-approved
author: PM (Claude)
trigger: "전 문서로 위키 생성"이 9단계(LLM 5회)를 한 번의 블로킹 호출로 돌아, 수 분간 화면에 진행이 안 보임. 사용자 요청 (a) 실시간 단계 진행바.
branch: docs/knowledge-harness-pipeline-spec
---

# Harness run 실시간 단계 진행 표시

## 1. 배경 / 문제

`harnessRun` IPC → `HarnessService.run` → `HarnessRunner.advance`가 PIPELINE 전체를 한 번의 블로킹 호출로 걷고 끝에서야 RunState를 반환한다. 그 사이(수 분) 렌더러는 `harnessLoading`만 알 뿐 **어느 단계인지 모른다.** `TaskFlowView`는 완료 후에만 history로 단계를 보여준다.

## 2. 설계 (전부 additive — 코어 run 무변경 보장)

각 단계가 끝날 때 main이 렌더러로 `harness:progress` 이벤트를 쏘고, 렌더러가 현재 단계를 실시간 표시한다. 모든 hook은 optional이고 이벤트는 fire-and-forget이라 실패해도 run은 그대로 완료된다.

### 2.1 Runner 콜백
`HarnessRunner.advance(store, onProgress?: (rs: RunState) => void)` — 각 단계 `store.saveRunState(runState)` **직후**(성공·FAILED 양쪽) `onProgress?.(runState)` 호출. 미지정이면 기존과 동일.

### 2.2 Service 패스스루
`HarnessService.run(input, onProgress?)` → `advanceSafely(..., onProgress)` → `runner.advance(store, onProgress)`. (resume도 동일 시그니처 추가 가능하나 이번 범위는 run만.)

### 2.3 컨테이너 emit
`createContainer(opts)`에 `emitHarnessProgress?: (e: { runId: string; state: string }) => void` 추가. `harnessRun`이 `onProgress: (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state })`로 호출.

### 2.4 IPC 채널 + main 배선
- `ipc-contract.ts`: `CH.harnessProgress = 'harness:progress'`, `type HarnessProgressEvent = { runId: string; state: string }`.
- `index.ts`: `createContainer({ ..., emitHarnessProgress: (e) => win.webContents.send(CH.harnessProgress, e) })`.
- `preload`: `onHarnessProgress(cb: (e: HarnessProgressEvent) => void)` (pty 이벤트와 동일 패턴).

### 2.5 렌더러
- store: `harnessProgress: string | null`. 앱 init 시 `api.onHarnessProgress((e) => set({ harnessProgress: e.state }))` 구독. `startHarnessRun` 시작 시 null로 리셋, 완료 시 유지(마지막 단계).
- UI: `harnessLoading` 중 현재 단계 표시. Coverage 탭 로딩 분기를 `⏳ 위키 생성 중… (현재: {harnessProgress ?? '시작'} — {n}/9)` 로. (단계 순서/번호는 기존 `HARNESS_STATE_ORDER`로 매핑.) TaskFlowView도 `harnessProgress`를 현재 단계 힌트로 쓸 수 있으나 필수는 아님.

## 3. 테스트

- **Runner**: fake drivers + recording onProgress → 각 단계가 순서대로 콜백된다(FAILED 시 마지막에 FAILED 포함). (knowledge-harness 단위)
- **Service**: `run({...}, onProgress)` → onProgress가 단계들을 받는다. (app-services 단위, FakeAgentRunner)
- **IPC/preload/index/store/UI 배선**: typecheck + 데스크톱 스위트 green로 게이트(pty 배선과 동일하게 단위테스트 없음). store 구독은 가능하면 단위 테스트.

## 4. 범위 밖 (YAGNI)

- 단계별 부분 진행률(%) / 토큰 스트리밍 — 단계 경계 이벤트만.
- resume의 progress — 이번엔 run만.
- 취소(cancel) 버튼 — 별개.

## 5. 수용 기준 (Done)

1. run 중 각 단계가 끝날 때 렌더러가 `harness:progress` 이벤트를 받아 **현재 단계를 실시간 표시**한다.
2. `onProgress`/`emitHarnessProgress`는 optional이며 미배선 시 run 동작 불변(회귀 없음).
3. 이벤트 실패가 run을 깨지 않는다(fire-and-forget).
4. 신규/기존 테스트 + `pnpm typecheck` 통과.
5. 새 IPC **명령** 채널 없음(이벤트 채널 1개만 추가), DB migration 없음.
