---
title: Interactive Node-Confirmation Implementation Plan
slug: docs-superpowers-plans-2026-06-19-interactive-node-confirmation
sources: [docs/superpowers/plans/2026-06-19-interactive-node-confirmation.md]
status: open
created: 2026-06-19
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 위키 생성 중 노드 제안 직후 파이프라인을 일시정지하고, 사용자가 노드 목록을 편집·승인하면 그 목록으로 위키를 쓰게 한다 (project-docs 도메인). Architecture: 기존 게이트-정지/재개 위에, 드라이버가 DriverResult.status:'paused' 를 반환하면 러너가 현재 상태에 머문 채 RunState.awaiting 을 세팅하고 멈춘다. interactive run은 WRITE PLAN CREATED 드라이버에서 approved-nodes 아티팩트가 없으면 paused → LEAD MERGED 에 정지. harnessConfirmNodes IPC가 승인 목록을 아티팩트로 저장 후 resume하고, STAGING WRITTEN 이 그 목록으로 proposals를 필터/렌더한다. Tech Stack: TypeScript(ESM

## Progress log

- Source checklist: 0 completed, 37 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: 러너 일시정지 계약 ( status:'paused' + awaiting )** — harness-runner.test.ts 의 describe('HarnessRunner', …) 에 추가 Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/harness-runner.test.ts Expected: FAIL — status:'paused' 미지원이라 SOURCES EXTRACTED로 전이(또는 awaiting 없음). packages/shared/src/kh-schema.ts 의 RunStateSchema 에서 error: z.string().optional(), 다음 줄에 추가 har
- **Task 2: 승인목록 스키마 + interactive 플래그 배선** — packages/shared/src/kh-schema.test.ts 에 추가 (import 줄에 KhApprovedNodesSchema 추가.) Run: pnpm exec vitest run packages/shared/src/kh-schema.test.ts Expected: FAIL — KhApprovedNodesSchema 없음. packages/shared/src/kh-schema.ts 의 KhNodeProposalSchema export 뒤에 추가 Run: pnpm exec vitest run packages/shared/src/kh-schema.test.ts
- **Task 3: WRITE PLAN CREATED 정지 게이팅 + STAGING WRITTEN 승인목록 소비** — packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts (신규). 헬퍼: 최소 ctx + 미리 채운 아티팩트로 드라이버를 직접 호출한다. Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts Expected: FAIL — 게이팅/소비 미구현(현재 interactive 무시, b도 렌더됨). make-drivers.ts 의 WRITE PLAN CREATED: async (ctx
- **Task 4: harnessConfirmNodes (service + IPC)** — packages/app-services/src/harness-service.test.ts 에 추가(기존 fake-runner harness 패턴 사용). 확인 모드 run이 정지하면, confirmNodes가 승인목록 저장+재개해 HUMAN REVIEW REQUIRED에 도달 Run: pnpm exec vitest run packages/app-services/src/harness-service.test.ts Expected: FAIL — confirmNodes 없음. harness-service.ts 의 resume(...) 메서드 뒤에 추가 harness-serv
- **Task 5: e2e — 확인 모드 정지 → confirm → 결과 반영** — 기존 e2e 패턴(faked LLM runner가 정해진 proposals를 내도록)을 사용한다. 핵심 가치: 승인목록에서 노드를 제거하면 최종 staging에 그 노드가 빠진다 + 비-interactive는 정지 없이 그대로 . Run: pnpm exec vitest run packages/app-services/src/harness-service.interactive.e2e.test.ts Expected: 2 PASS.
- **Task 6: UI — 확인 모드 토글 + 노드 확인 패널** — NodeConfirmPanel.test.tsx — 제안 노드 목록을 받아 렌더하고, 하나를 제거 후 「이대로 생성」을 누르면 남은 노드만 담아 onConfirm 을 호출한다. Run: pnpm exec vitest run apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx Expected: FAIL — 컴포넌트 없음. NodeConfirmPanel.tsx : props { proposed: Array ; onConfirm: (a: { nodes: typeof proposed }) = void } . 로컬 상

## Related

- Source: `docs/superpowers/plans/2026-06-19-interactive-node-confirmation.md`
