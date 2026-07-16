---
title: 통합검색 B — knowledge 인덱싱 + KnowledgeRetrieval 연결
slug: docs-superpowers-specs-2026-06-09-unified-search-b-design
sources: [docs/superpowers/specs/2026-06-09-unified-search-b-design.md]
status: accepted
date: 2026-06-09
topic: [knowledge-and-search]
---

## Context

title: 통합검색 B — knowledge 인덱싱 + KnowledgeRetrieval 연결 설계 (AC 6, 2/2) branch: docs/knowledge-harness-pipeline-spec decomposition: A(완료) = 검색 서비스+UI(세션 인덱스, knowledge 슬롯). B(이 문서) = knowledge 인덱싱 + retrieval 연결. PRD 수용기준 6 — "P0 검색이 BM25로 task/wiki/session 함께 반환" — 의 나머지 절반. A는 세션 인덱스 위에 정규화된 UnifiedSearchResponse 와 검색 모달을 만들고 UnifiedSearch.deps 에 knowledge 슬롯만 비워뒀다. B는 그 슬롯을 채운다 clearProject(projectId: string): void { // FTS 먼저(외래 doc id 참조), 그다음 chunks, documents this.db.prepare('DELETE FROM knowledge chunk fts WHERE project id = ?').run(projectId) this.db.prepare('DELETE FROM knowledge chunks WHERE project id = ?').run(projectId) this.db.pre

## Decision

- **1. 배경 / 문제** — PRD 수용기준 6 — "P0 검색이 BM25로 task/wiki/session 함께 반환" — 의 나머지 절반. A는 세션 인덱스 위에 정규화된 UnifiedSearchResponse 와 검색 모달을 만들고 UnifiedSearch.deps 에 knowledge 슬롯만 비워뒀다. B는 그 슬롯을 채운다
- **2. 설계 결정 (확정)**
- **3. 데이터 위치**
- **4. KnowledgeStore.clearProject (신규 메서드, @apc/knowledge )**
- **5. KnowledgeIndexer (신규, packages/app-services/src/knowledge-indexer.ts )**
- **6. 'Ingest now' 결합 ( IngestService )**
- **7. UnifiedSearch 연결 ( apps/desktop/src/main/unified-search.ts )**
- **8. 에러 / 빈 상태**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-09-unified-search-b-design.md`
