---
title: Dev-Harness Orchestration (S3) Implementation Plan
slug: docs-superpowers-plans-2026-07-01-dev-harness-orchestration
sources: [docs/superpowers/plans/2026-07-01-dev-harness-orchestration.md]
status: open
created: 2026-07-01
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: ai dashboard 콘솔이 프로젝트 task에 대해 멀티에이전트 하네스(langgraph-agent agents up cli.sh )를 shell-out으로 구동하고, 로그를 live 스트리밍하며, 실행 이력을 AgentRunStore 에 기록한다. Architecture: 신규 DevHarnessService (app-services)가 ProjectRegistry 로 repoPath를 풀고 HarnessCli (주입식 spawner, CLI CONTRACT.md 어댑터)로 CLI를 실행한다. run 생명주기는 AgentRunStore (create→complete/fail)에 기록되고, stdout/stderr는 transcript 파일 + renderer live tail로 fan-out된다. 위키 HarnessService 와 독립. Tech

## Progress log

- Source checklist: 0 completed, 37 remaining.
- **Global Constraints**
- **Task 1: vitest workspace — 루트 test가 apps/desktop도 실행 (인프라 하드닝)** — Run: pnpm test 2 &1 tail -20 Expected: packages 테스트 + apps/desktop 테스트(예: ipc.test.ts 의 "IPC handlers (no Electron)")가 둘 다 실행되고 통과. 이전엔 apps/desktop이 안 돌았음. Run: pnpm typecheck Expected: 통과(설정 파일 추가만이라 무영향).
- **Task 2: AgentKind 'harness' + AgentRunStore.fail()** — Run: pnpm test agent-run-store 2 &1 tail -15 Expected: FAIL — AgentKind.parse('harness') throws (enum에 없음) / runs.fail is not a function. packages/shared/src/schema.ts:3 packages/pm/src/agent-run-store.ts — complete 메서드 아래에 추가 Run: pnpm test agent-run-store 2 &1 tail -10 && pnpm typecheck 2 &1 tail -10 Expected: 테스트 PA
- **Task 3: HarnessCli — CLI CONTRACT 어댑터 (주입식 spawner)** — Run: pnpm test harness-cli 2 &1 tail -15 Expected: FAIL — Cannot find module './harness-cli.js' . packages/app-services/src/index.ts 에 export 추가 Run: pnpm test harness-cli 2 &1 tail -10 Expected: 4개 PASS.
- **Task 4: DevHarnessService — run 생명주기 + 로그 fan-out** — Run: pnpm test dev-harness-service 2 &1 tail -15 Expected: FAIL — Cannot find module './dev-harness-service.js' . packages/app-services/src/index.ts 에 export 추가 Run: pnpm test dev-harness-service 2 &1 tail -10 && pnpm typecheck 2 &1 tail -5 Expected: 4개 PASS, typecheck PASS.
- **Task 5: IPC 계약 + 핸들러 + 컨테이너 배선** — (필요 시 기존 테스트의 registerProject 페이로드 형태를 참고해 필드 정렬.) Run: pnpm test ipc 2 &1 tail -15 Expected: FAIL — CH.devHarnessRun undefined / handler 없음. ipc-contract.ts — CH 객체에 채널 추가(기존 harness 항목 근처) 같은 파일에 타입 추가 container.ts ( HarnessCli import from @apc/app-services .) ipc.ts — handlers Record에 추가 (상단 import에 DevHarnessRunReq
- **Task 6: preload bridge + 최소 renderer UI** — (preload의 채널 노출/타입 규약은 기존 harness 항목과 동일하게 맞춘다. window api 타입 선언 파일이 있으면 시그니처 추가.) task 행/상세에 버튼을 추가: 클릭 시 window.api.devHarnessRun({ projectId, taskId }) . 마운트 시 onDevHarnessLog 로 해당 runId의 chunk를 모아 로그 뷰에 append. 실행 중에는 ⏹ Cancel 버튼(→ devHarnessCancel({ runId }) ). 기존 위키 하네스 로그 tail 컴포넌트가 있으면 재사용, 없으면 단순 스크롤 . Run: pn
- **Task 7: SP1 후속 정리 (폴리시)** — 해당 catch(현재 무로그)에서 (catch가 IngestService 내부에 있으면 거기에, container의 onSessionParsed 콜백이면 콜백 내부 try/catch로 감싸 동일 로그.) Run: pnpm test session-task 2 &1 tail -10 (또는 SP1 테스트 파일명) Expected: 기존 테스트 green 유지. Run: pnpm test 2 &1 tail -15 && pnpm typecheck 2 &1 tail -5 Expected: 전체 green, typecheck PASS.

## Related

- Source: `docs/superpowers/plans/2026-07-01-dev-harness-orchestration.md`
