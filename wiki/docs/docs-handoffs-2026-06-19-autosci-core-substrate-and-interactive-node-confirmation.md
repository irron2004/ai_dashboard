---
title: Handoff — autosci-core 위키 기질 통합 + 인터랙티브 노드 확인
slug: docs-handoffs-2026-06-19-autosci-core-substrate-and-interactive-node-confirmation
sources: [docs/handoffs/2026-06-19-autosci-core-substrate-and-interactive-node-confirmation.md]
topic: [autosci-core-integration]
---

## Summary

작성: Claude (subagent-driven development 세션) 이 세션에서 두 개의 하위 프로젝트 를 brainstorm→spec→plan→구현(TDD)→리뷰까지 완주했다. node scripts/bootstrap-substrate.mjs .venv-substrate (이미 있으면 빠름) — substrate venv-gated 테스트용 pnpm exec vitest run packages/app-services/src/harness-service.interactive.e2e.test.ts \ packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts \ apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx 테스트는 레포 루트에서 pnpm exec vitest run 로 돌린다. pnpm --filter test -- 형태는 이 레포의 vitest include( packages/ , scripts/ )와 안 맞아 "No test files found"가 난다. 1. (B) 브랜치 머지/푸시 — feat/interactive-node-confirm 을 feat/workspace-vault 로 (리뷰 통과

## Content map

- **1. 완료된 작업**
- **(A) autosci-core 위키 기질 통합 — 1 "이음매" — ✅ 머지+푸시 완료**
- **(B) 인터랙티브 노드 확인 — ✅ 구현+리뷰 완료, 머지 대기**
- **2. 현재 상태 / 검증** — 재현
- **인터랙티브만** — pnpm exec vitest run packages/app-services/src/harness-service.interactive.e2e.test.ts \ packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts \ apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx
- **3. 의도적으로 연기한 것 (스코프 밖)**
- **4. 후속 작업 (non-blocking, 우선순위 순)** — 1. (B) 브랜치 머지/푸시 — feat/interactive-node-confirm 을 feat/workspace-vault 로 (리뷰 통과). 아직 안 함. 2. confirmNodes 에 prev.awaiting === 'node-confirmation' precheck 추가(비-정지 run 확인 거부 명시화). 3. rename(인라인 제목수정) 경로 테스트 + confirmNodes 렌더러-스토어 테스트 추가. 4. housekeeping: packages/ /node modules/@apc/.ignored · apps/desktop/node modules
- **5. 환경 메모**

## Related

- Source: `docs/handoffs/2026-06-19-autosci-core-substrate-and-interactive-node-confirmation.md`
