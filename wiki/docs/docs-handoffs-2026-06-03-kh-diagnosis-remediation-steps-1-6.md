---
title: Handoff — Knowledge Harness 진단 교정 (Recommended sequencing 1~6 전부)
slug: docs-handoffs-2026-06-03-kh-diagnosis-remediation-steps-1-6
sources: [docs/handoffs/2026-06-03-kh-diagnosis-remediation-steps-1-6.md]
topic: [project-architecture]
---

## Summary

단계별로 (계획 → spec → TDD 개발 → commit) 수행. 직전 세션의 holistic 진단(58 confirmed problems)이 제시한 권장 순서 6단계를 전부 구현·커밋 했다. 각 단계마다 spec 문서( docs/superpowers/specs/2026-06-03-kh-remediation-step - .md )를 쓰고 TDD로 개발 후 커밋. packages/knowledge-harness/src/verify/evidence-verifier.ts , 루트 tsconfig.typecheck.json . ProjectSidebar.tsx , store.ts , packages/agents/ adapter , ingest-schema , cli-agent-runner.test , harness-store.test , untracked source-discovery.ts + 렌더러 컴포넌트(MarkdownViewer/GraphVisualization/ TaskFlowView/DiffViewer). 이건 다른 작업 스트림(sourceMeta ingest 리팩터 + 렌더러 restyle)이다. cd ai dashboard && pnpm typecheck exit 0 (package source) cd ai dashboard && pn

## Content map

- **1. 한 일 (결론)** — 직전 세션의 holistic 진단(58 confirmed problems)이 제시한 권장 순서 6단계를 전부 구현·커밋 했다. 각 단계마다 spec 문서( docs/superpowers/specs/2026-06-03-kh-remediation-step - .md )를 쓰고 TDD로 개발 후 커밋.
- **2. 변경/커밋 상태** — packages/knowledge-harness/src/verify/evidence-verifier.ts , 루트 tsconfig.typecheck.json . ProjectSidebar.tsx , store.ts , packages/agents/ adapter , ingest-schema , cli-agent-runner.test , harness-store.test , untracked source-discovery.ts + 렌더러 컴포넌트(MarkdownViewer/GraphVisualization/ TaskFlowView/DiffViewer). 이건 다른 작업
- **3. 검증**
- **4. 남은 일 / 주의** — ingest 리팩터 + untracked 렌더러 컴포넌트)과 얽혀 보류. 그 스트림들이 landing되면 typecheck를 tests+desktop으로 확장. import. step 4에서 harness-utils.ts+AgentConfigPanel.tsx는 커밋했으나 나머지 컴포넌트는 다른 스트림 소유라 미커밋. "패키지 앱에서 편집 가능한 override 파일 동봉"은 packaging 설정 도입 후속.

## Related

- Source: `docs/handoffs/2026-06-03-kh-diagnosis-remediation-steps-1-6.md`
