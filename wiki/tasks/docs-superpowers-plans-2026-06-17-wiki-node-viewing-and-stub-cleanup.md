---
title: Wiki 노드 뷰잉 + 잔재 stub 청소 — Implementation Plan
slug: docs-superpowers-plans-2026-06-17-wiki-node-viewing-and-stub-cleanup
sources: [docs/superpowers/plans/2026-06-17-wiki-node-viewing-and-stub-cleanup.md]
status: open
created: 2026-06-17
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Knowledge 탭에서 현재 run이 생성한 진짜 노드 문서만 안정적으로 나열·열람하게 하고, 옛 stub 잔재를 docs 트리/카운트에서 숨긴다. Architecture: main 프로세스에 "run의 vault-staging dir를 직접 나열하고 각 .md가 진짜 노드인지( node id: frontmatter) 판별"하는 순수 함수 + IPC를 추가한다(A1). 렌더러 KnowledgeView 는 추측 기반 파생 대신 이 IPC 결과를 쓰고, isNode 인 문서만 docs 트리에 노출하며(B1), 그래프 클릭은 node id 와 data.path stem 두 키로 staged 문서를 해석한다. 그래프 캔버스 구조와 생성 파이프라인은 건드리지 않는다. Tech Stack: TypeScript (ESM, .js import 확장자), Electro

## Progress log

- Source checklist: 0 completed, 32 remaining.
- **Global Constraints**
- **검증 전략 (핵심 — 모킹된 테스트만으론 "완료"가 아니다)** — 그동안 "완료"라고 한 게 실제 앱에선 안 고쳐진 경우가 반복됐다. 원인은 명확하다: 컴포넌트 테스트가 api. (IPC)를 모킹 하므로, 모킹이 통과하면 초록불이 되지만 실제 데이터·실제 경로 해석·실제 파일 읽기 는 전혀 검증되지 않는다. 초록불 ≠ 동작. 그래서 검증을 세 겹으로 한다 1. 순수 함수 단위 테스트(모킹 0): 실제 의사결정 로직( collectStagedDocs , parseStagedDoc , resolveStagedRel )을 React/IPC 밖 순수 함수로 빼서 실데이터형 입력으로 검증. 2. 컴포넌트 테스트(모킹 有): 배선/렌더 확인용
- **Task 1: staged 문서 나열 순수 함수 ( collectStagedDocs )** — packages/app-services/src/staged-docs.test.ts Run: npx vitest run packages/app-services/src/staged-docs.test.ts Expected: FAIL — Cannot find module './staged-docs.js' (module not created yet). packages/app-services/src/staged-docs.ts Then add to packages/app-services/src/index.ts (after the harness-service.js export li
- **Task 2: IPC 배선 ( harnessListStagedDocs )** — harnessReadStagedDoc 와 동일한 5계층 패턴을 미러링한다. 검증은 타입체크(타입드 IPC 배선의 정확성은 컴파일 속성) + 기존 스위트 그린. apps/desktop/src/shared/ipc-contract.ts — CH 객체에서 harnessReadStagedDoc: 'c:harnessReadStagedDoc', 바로 아래에 추가 그리고 HarnessReadStagedDocRes 타입 정의 바로 아래에 추가 packages/app-services/src/harness-service.ts — 상단 import 블록에 추가(다른 로컬 import들 근
- **Task 3: KnowledgeView — docs 트리에 진짜 노드만 + 신뢰 배지** — stagedDocs (applied-write-report/node-proposals 추측)를 harnessListStagedDocs 결과로 교체하고, docs 트리에는 isNode 인 문서만 노출(B1), 헤더에 "진짜 노드 N개 · 상태" 배지를 단다(R4). 그래프 캔버스/클릭은 Task 4에서. apps/desktop/src/renderer/components/KnowledgeView.test.tsx 1. 목 선언부(상단)에 staged 목록 목을 추가 — harnessReadStagedDoc 선언 아래 2. vi.mock('../api.js', ...) 의
- **Task 4: 그래프 클릭 해석 견고화 (node id + data.path stem)** — 그래프 노드 클릭이 task: 같은 id거나 data.path 가 없어도, staged 목록에서 node id /stem으로 실제 문서를 찾아 연다. 매핑에 안 걸리면 프로젝트 문서용 기존 fsReadDoc 폴백 유지(그래프 캔버스 구조는 불변). 핵심 해석 로직은 순수 함수 resolveStagedRel 로 빼서 모킹 없이 테스트 한다(검증 전략 1). apps/desktop/src/renderer/harness-utils.test.ts 에 추가(없으면 생성) Run: npx vitest run apps/desktop/src/renderer/harness-utils
- **Task 5: 실제 run 데이터 통합 스모크 (모킹 0 — "완료"의 진짜 근거)** — Task 1·4가 끝난 뒤, 모킹 없이 사용자의 실제 apc-harness-runs 를 가리켜 main 경로 그대로( collectStagedDocs → resolveStagedRel → 실제 파일 읽기)를 돌리고 실제 숫자/본문을 출력한다. 평소엔 APC REAL RUNS 미설정 시 skip(다른 머신/CI 안전). apps/desktop/src/main/staged-docs.integration.test.ts Run: npx vitest run apps/desktop/src/main/staged-docs.integration.test.ts Expected: PAS
- **마무리 검증 (전 태스크 후)**

## Related

- Source: `docs/superpowers/plans/2026-06-17-wiki-node-viewing-and-stub-cleanup.md`
