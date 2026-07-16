---
title: autosci-core Wiki Substrate Integration — Implementation Plan
slug: docs-superpowers-plans-2026-06-19-autosci-core-wiki-substrate-integration
sources: [docs/superpowers/plans/2026-06-19-autosci-core-wiki-substrate-integration.md]
status: open
created: 2026-06-19
topic: [autosci-core-integration]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: ai dashboard(TS 오케스트레이터)가 autosci-core(Python 코어)를 서브프로세스+계약+vault로 합성해, 논문 도메인에서 위키 빌드 이음매를 end-to-end로 증명한다. Architecture: TS는 Python을 import하지 않고 python -m kernel / python -m autosci core.adapters 를 서브프로세스로 호출한다(claude/codex를 spawn하는 cli-agent-runner.ts 패턴). 공유 인터페이스 = autosci-core 계약( runtime/schema policy/ .yaml ) + vault 레이아웃( wiki/ , wiki/graph/edges.jsonl , index.md ) + CLI. 새 @apc/wiki-substrate 패키지가 Python 경계를 포트

## Progress log

- Source checklist: 0 completed, 39 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: 러너 실패 계약 (DriverResult.status + 실패 시 artifacts 보존)** — VALIDATED가 lint 리포트를 보존하면서 run을 FAILED로 만들 수 있게 러너 계약을 확장한다. 현재 advance 는 driver가 throw하면 artifacts를 잃는다( harness-runner.ts:74-84 ). packages/knowledge-harness/src/runtime/harness-runner.test.ts 의 describe('HarnessRunner', …) 안에 추가 Run: pnpm --filter @apc/knowledge-harness test -- harness-runner Expected: FAIL — 현재는 st
- **Task 2: vendor autosci-core + venv 부트스트랩 + core.lock + 골든 fixture freeze** — 이음매가 의존할 Python 코어를 고정하고, 골든 fixture를 ai dashboard 소유로 동결한다. 골든 콘텐츠는 autosci-core 워킹트리( ../autosci-core/.scratch/attnembed-e2e/ )에서 1회 캡처 한다(태그/sibling 경로에 런타임 의존하지 않도록 커밋). 확인: wiki-domains/paper/runtime/schema/entities.yaml 에 papers: / modules: / pipelines: 섹션이 있고, paper-golden/wiki/papers/ · wiki/modules/ · wiki/gra
- **Task 3: @apc/wiki-substrate 패키지 (포트 + lint 파서 + PythonKernelAdapter)** — Python 경계를 포트 뒤에 가둔다. lint 텍스트 출력을 권위 리포트로 파싱한다. packages/shared/src/kh-schema.ts 의 KhMarkdownYamlValidationReportSchema 블록 뒤에 추가 ( packages/shared/src/index.ts 가 export from './kh-schema.js' 인지 확인 — 맞으면 추가 작업 없음.) packages/wiki-substrate/package.json packages/wiki-substrate/tsconfig.json 그리고 cross-package import가 vite
- **Task 4: Phase-1 driver 세트 + VALIDATED 배선 + e2e/음성 테스트** — 새 상태 없이 주입형 driver로 골든 노드를 깔고, VALIDATED에서 실제 kernel lint를 권위 게이트로 건다. 음성 테스트로 게이트가 살아있음을 증명한다. make-drivers.ts 의 ARTIFACTS 객체에 한 줄 추가( secretScan 줄 뒤) packages/knowledge-harness/src/runtime/paper-phase1.e2e.test.ts Run: pnpm --filter @apc/knowledge-harness test -- paper-phase1 Expected: FAIL — paper-phase1-drivers.js
- **Task 5: UI 그래프 어댑터 (vault → node-proposals + staged docs) + 뷰어 스모크** — 기존 UI는 node-proposals artifact + node id / node type frontmatter로 그래프를 만든다( harness-utils.ts:776 , staged-docs.ts:20 ). autosci-core vault를 그 모델로 투영한다. lint 대상 vault는 순수 autosci 계약을 유지하고, UI 투영은 별도 산출물로 만든다(스펙 §4a-3). packages/wiki-substrate/src/substrate-graph-adapter.test.ts Run: pnpm --filter @apc/wiki-substrate tes
- **검증 (전체 Task 완료 후)** — 스펙 §10 성공 기준에 1:1 대응 1. 핀/lock — Task 2 ( core.lock + submodule HEAD==commit + kernel. file under vendor) ✅ bootstrap test 2. freeze — Task 2 ( wiki-domains/paper/ + paper-golden/ ) ✅ 3. 어댑터 정상/깨짐 — Task 3 integration test ✅ 4. 골든 vault e2e [1]~[4] — Task 4 golden test ✅ 5. 음성(FAILED + 리포트 보존) — Task 1 unit + Task 4 br

## Related

- Source: `docs/superpowers/plans/2026-06-19-autosci-core-wiki-substrate-integration.md`
