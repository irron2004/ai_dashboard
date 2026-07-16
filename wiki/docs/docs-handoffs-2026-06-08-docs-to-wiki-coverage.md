---
title: Handoff — 전 문서→위키 원클릭 + 커버리지 검증 (구현 완료)
slug: docs-handoffs-2026-06-08-docs-to-wiki-coverage
sources: [docs/handoffs/2026-06-08-docs-to-wiki-coverage.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

사용자 핵심 목표("하위 경로 전 문서를 LLM 위키로 변환하는 원클릭 harness + 중간 과정 시각화로 검증")를 brainstorming→spec→plan→구현(subagent team-mode dev+QA, 8 Task 전부 APPROVED) 으로 완성했다. 최종 종합 리뷰 READY TO MERGE . 전 스위트 green. 1. KhCoverageReport 스키마 + 순수 buildCoverageReport(sourcePaths, proposals) — covered=노드가 evidence로 인용 / unmapped=미인용. 2. 파이프라인 HUMAN REVIEW REQUIRED 에서 coverage-report artifact emit ( sources.read() + proposals 기반). 3. SourceMaterializer.materializeProjectDocs(repoPaths, vaultRoot) — .md/.markdown/.txt 재귀 복사→ raw/project-docs/ / , 제외(node modules/.git/dist/build/.worktrees + vault 자기), 멱등(project-docs만 clear), 기존 raw/ 불변. 4. materialize? 플래그 배선: HarnessRunReq

## Content map

- **0. 한 줄 요약** — 사용자 핵심 목표("하위 경로 전 문서를 LLM 위키로 변환하는 원클릭 harness + 중간 과정 시각화로 검증")를 brainstorming→spec→plan→구현(subagent team-mode dev+QA, 8 Task 전부 APPROVED) 으로 완성했다. 최종 종합 리뷰 READY TO MERGE . 전 스위트 green.
- **1. 이번 세션에 한 일**
- **A. 설계 결정 (brainstorming)**
- **B. 구현 (8 Task)** — 1. KhCoverageReport 스키마 + 순수 buildCoverageReport(sourcePaths, proposals) — covered=노드가 evidence로 인용 / unmapped=미인용. 2. 파이프라인 HUMAN REVIEW REQUIRED 에서 coverage-report artifact emit ( sources.read() + proposals 기반). 3. SourceMaterializer.materializeProjectDocs(repoPaths, vaultRoot) — .md/.markdown/.txt 재귀 복사→ raw/project
- **C. end-to-end 데이터 흐름 (검증됨)** — 버튼 → startHarnessRun(true) → api.harnessRun({materialize:true}) → container가 registry에서 repoPaths 해결 → harness.run 이 materialize 먼저 → raw/project-docs/ 적재 → 파이프라인 SourceReader 가 raw/ 전체 읽음 → coverage-report emit → UI coverageData = artifacts.find(name==='coverage-report') → CoverageMatrix . 경로 네임스페이스( raw/project-docs/
- **2. 커밋 (이 세션 신규, base 0a1c880 위 — PM Home handoff 다음)**
- **3. 검증 상태 (전부 green)**
- **4. 다음에 할 일 / 남은 항목 (low-severity, 비차단)**

## Related

- Source: `docs/handoffs/2026-06-08-docs-to-wiki-coverage.md`
