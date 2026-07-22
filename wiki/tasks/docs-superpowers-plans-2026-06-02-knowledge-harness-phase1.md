---
title: Knowledge Harness — Phase 1 (계약 + 런타임 골격) Implementation Plan
slug: docs-superpowers-plans-2026-06-02-knowledge-harness-phase1
sources: [docs/superpowers/plans/2026-06-02-knowledge-harness-phase1.md]
status: open
created: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: @apc/knowledge-harness 패키지의 런타임 골격을 만든다 — 12-state 머신을 구동하고, feature gate로 단계를 통제하며, run-당 artifact를 runs/RUN- / 에 영속하고, 실패/중단 지점부터 resume 가능한 HarnessRunner . 실제 LLM agent는 Phase 2에서 주입한다(이 단계는 fake driver로 전 구간을 검증). Architecture: 계약 스키마(Zod)는 @apc/shared/kh-schema.ts 에 두어 런타임·테스트·향후 데스크톱 렌더러가 공유한다. 런타임은 순수 함수형 state machine + fs 기반 artifact store + lockfile + 평평한 feature-gate 파서 + driver-주입형 orchestrator로 구성한다. driver는 st

## Progress log

- Source checklist: 0 completed, 50 remaining.
- **File Structure** — @apc/shared (기존 패키지, 파일 추가) 새 패키지 @apc/knowledge-harness ( packages/knowledge-harness/ ) 설정/문서 파일(repo 루트)
- **Task 1: kh-schema 계약 (shared)** — packages/shared/src/kh-schema.test.ts Run: pnpm exec vitest run packages/shared/src/kh-schema.test.ts Expected: FAIL — Cannot find module './kh-schema.js' . packages/shared/src/kh-schema.ts Edit packages/shared/src/index.ts — append after the existing exports Run: pnpm exec vitest run packages/shared/src/kh-schema.test
- **Task 2: @apc/knowledge-harness 패키지 스캐폴드** — packages/knowledge-harness/src/smoke.test.ts Run: pnpm exec vitest run packages/knowledge-harness/src/smoke.test.ts Expected: FAIL — module/index not found. packages/knowledge-harness/package.json packages/knowledge-harness/src/index.ts Run: pnpm install Expected: lockfile updates; @apc/knowledge-harness linked. No err
- **Task 3: RunStateMachine** — packages/knowledge-harness/src/runtime/run-state-machine.test.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/run-state-machine.test.ts Expected: FAIL — module not found. packages/knowledge-harness/src/runtime/run-state-machine.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/run-
- **Task 4: FeatureGate** — packages/knowledge-harness/src/runtime/feature-gate.test.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/feature-gate.test.ts Expected: FAIL — module not found. packages/knowledge-harness/src/runtime/feature-gate.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/feature-gate.test.t
- **Task 5: RunArtifactStore** — packages/knowledge-harness/src/runtime/run-artifact-store.test.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/run-artifact-store.test.ts Expected: FAIL — module not found. packages/knowledge-harness/src/runtime/run-artifact-store.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/r
- **Task 6: RunLock** — packages/knowledge-harness/src/runtime/run-lock.test.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/run-lock.test.ts Expected: FAIL — module not found. packages/knowledge-harness/src/runtime/run-lock.ts Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/run-lock.test.ts Expected: PASS
- **Task 7: HarnessRunner (driver-주입 orchestrator + resume)** — The runner exposes createRun() (state=CREATED, persisted) and advance(store) which walks PIPELINE from the run's current state, checking each step's gate, invoking the injected driver, persisting its artifacts, and saving run.json after every step. A closed gate stops the walk at the current state; a driver throw recor

## Related

- Source: `docs/superpowers/plans/2026-06-02-knowledge-harness-phase1.md`
