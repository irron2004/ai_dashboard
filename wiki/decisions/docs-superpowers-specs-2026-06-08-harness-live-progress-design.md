---
title: Harness run 실시간 단계 진행 표시
slug: docs-superpowers-specs-2026-06-08-harness-live-progress-design
sources: [docs/superpowers/specs/2026-06-08-harness-live-progress-design.md]
status: accepted
date: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Context

title: Harness run 실시간 단계 진행 표시 (live progress) 설계 trigger: "전 문서로 위키 생성"이 9단계(LLM 5회)를 한 번의 블로킹 호출로 돌아, 수 분간 화면에 진행이 안 보임. 사용자 요청 (a) 실시간 단계 진행바. branch: docs/knowledge-harness-pipeline-spec harnessRun IPC → HarnessService.run → HarnessRunner.advance 가 PIPELINE 전체를 한 번의 블로킹 호출로 걷고 끝에서야 RunState를 반환한다. 그 사이(수 분) 렌더러는 harnessLoading 만 알 뿐 어느 단계인지 모른다. TaskFlowView 는 완료 후에만 history로 단계를 보여준다. 각 단계가 끝날 때 main이 렌더러로 harness:progress 이벤트를 쏘고, 렌더러가 현재 단계를 실시간 표시한다. 모든 hook은 optional이고 이벤트는 fire-and-forget이라 실패해도 run은 그대로 완료된다. HarnessRunner.advance(store, onProgress?: (rs: RunState) = void) — 각 단계 store.saveRunState(runState) 직후 (성공·FAILED 양쪽) onPr

## Decision

- **1. 배경 / 문제** — harnessRun IPC → HarnessService.run → HarnessRunner.advance 가 PIPELINE 전체를 한 번의 블로킹 호출로 걷고 끝에서야 RunState를 반환한다. 그 사이(수 분) 렌더러는 harnessLoading 만 알 뿐 어느 단계인지 모른다. TaskFlowView 는 완료 후에만 history로 단계를 보여준다.
- **2. 설계 (전부 additive — 코어 run 무변경 보장)** — 각 단계가 끝날 때 main이 렌더러로 harness:progress 이벤트를 쏘고, 렌더러가 현재 단계를 실시간 표시한다. 모든 hook은 optional이고 이벤트는 fire-and-forget이라 실패해도 run은 그대로 완료된다.
- **2.1 Runner 콜백** — HarnessRunner.advance(store, onProgress?: (rs: RunState) = void) — 각 단계 store.saveRunState(runState) 직후 (성공·FAILED 양쪽) onProgress?.(runState) 호출. 미지정이면 기존과 동일.
- **2.2 Service 패스스루** — HarnessService.run(input, onProgress?) → advanceSafely(..., onProgress) → runner.advance(store, onProgress) . (resume도 동일 시그니처 추가 가능하나 이번 범위는 run만.)
- **2.3 컨테이너 emit** — createContainer(opts) 에 emitHarnessProgress?: (e: { runId: string; state: string }) = void 추가. harnessRun 이 onProgress: (rs) = opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }) 로 호출.
- **2.4 IPC 채널 + main 배선**
- **2.5 렌더러**
- **3. 테스트**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-08-harness-live-progress-design.md`
