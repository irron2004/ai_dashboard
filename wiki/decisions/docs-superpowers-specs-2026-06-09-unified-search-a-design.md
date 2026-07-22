---
title: 통합검색 A — 검색 서비스 + 모달 UI
slug: docs-superpowers-specs-2026-06-09-unified-search-a-design
sources: [docs/superpowers/specs/2026-06-09-unified-search-a-design.md]
status: accepted
date: 2026-06-09
topic: [knowledge-and-search]
---

## Context

title: 통합검색 A — 검색 서비스(정규화 계약) + 모달 UI 설계 (AC 6, 1/2) branch: docs/knowledge-harness-pipeline-spec decomposition: A(이 문서) = 검색 서비스+UI(세션 인덱스, knowledge 슬롯). B(후속) = knowledge 인덱싱+retrieval 연결. PRD 수용기준 6 — "P0 검색이 BM25로 task/wiki/session 함께 반환" — 가 미달이다. 진단( 2026-06-07-...-coverage-diagnosis.md §2)·코드 대조 결과 분해: 6은 ① 통합 검색 서비스+UI(A), ② knowledge 인덱싱+연결(B)로 나뉜다. 이 문서는 A : 세션 인덱스 위에 정규화된 단일 SearchResponse 와 검색 모달을 만든다(knowledge는 슬롯만 두고 B에서 채움). A가 실데이터(세션) 검색 UI 를 즉시 제공하고, 정규화 계약을 만들어 B를 작은 추가로 만든다. export type UnifiedSearchHit = { kind: string // 'session' (now) 'wiki' 'task' ... (B) export type UnifiedSearchResponse = { query: string; hits: Un

## Decision

- **1. 배경 / 문제** — PRD 수용기준 6 — "P0 검색이 BM25로 task/wiki/session 함께 반환" — 가 미달이다. 진단( 2026-06-07-...-coverage-diagnosis.md §2)·코드 대조 결과
- **2. 설계 결정 (확정)**
- **3. 정규화 계약 ( @apc/shared )**
- **4. UnifiedSearch 서비스 ( packages/app-services/src/unified-search.ts , 신규)**
- **5. 배선**
- **6. UI — SearchModal ( apps/desktop/src/renderer/components/SearchModal.tsx , 신규)**
- **7. 데이터 흐름** — 입력 → api.search({query}) → IPC q:search → container.search → UnifiedSearch.search (세션 인덱스 쿼리 → 정규화) → UnifiedSearchResponse → 모달 목록 → 클릭 시 selectProject(projectId) + 닫기.
- **8. 에러 / 빈 상태**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-09-unified-search-a-design.md`
