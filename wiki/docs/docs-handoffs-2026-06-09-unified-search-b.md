---
title: "Handoff — 통합검색 B (knowledge 인덱싱 + retrieval 연결, AC 6 2/2, 구현 완료)"
slug: docs-handoffs-2026-06-09-unified-search-b
sources: [docs/handoffs/2026-06-09-unified-search-b.md]
topic: [knowledge-and-search]
---

## Summary

PRD P0 격차 6 의 나머지 절반 완료: "Ingest now"가 프로젝트 vault 마크다운을 @apc/knowledge KnowledgeStore에 인덱싱하고, 검색이 세션과 함께 wiki/task/decision 등 knowledge hit을 반환. A에서 비워둔 UnifiedSearch.deps.knowledge 슬롯을 채움. brainstorm→spec→plan→subagent 5 Task team-mode, 최종 리뷰 READY TO MERGE. acd127a feat(desktop): wire knowledge migrate/store/retrieval/indexer into container + UnifiedSearch 065255c feat(desktop): UnifiedSearch returns knowledge hits (kind=docType) across projects f6c3f30 feat(app-services): IngestService runs knowledge reindex, returns documents count 7eadbc3 feat(app-services): KnowledgeIndexer scans vault markdown into KnowledgeStore 2a8fcf8 feat(knowledge

## Content map

- **0. 한 줄 요약** — PRD P0 격차 6 의 나머지 절반 완료: "Ingest now"가 프로젝트 vault 마크다운을 @apc/knowledge KnowledgeStore에 인덱싱하고, 검색이 세션과 함께 wiki/task/decision 등 knowledge hit을 반환. A에서 비워둔 UnifiedSearch.deps.knowledge 슬롯을 채움. brainstorm→spec→plan→subagent 5 Task team-mode, 최종 리뷰 READY TO MERGE.
- **1. 한 일 (5 Task, 각 TDD + spec/code-quality 2단 리뷰)**
- **2. 커밋 (base c507a88 =plan 위)**
- **3. 검증 (전부 green)** — 최종 리뷰(opus): e2e 체인 무결(부팅 migrateKnowledge (메인 db) → "Ingest now" ingestAll → reindexAll →upsertCollection/clearProject/scan/ indexMarkdownDoc , 락 해제 보장 → 검색 UnifiedSearch →projectId 순회 KnowledgeRetrieval →정규화 append, FTS 에러 격리·빈 쿼리 단락), 단일 타입( UnifiedSearchHit @shared/ IngestResult @app-services), 회귀 없음(knowledge 선택·세
- **4. 남은 것 / 후속 (low, 비차단)**
- **5. 핵심 파일**
- **6. 다음 후보**

## Related

- Source: `docs/handoffs/2026-06-09-unified-search-b.md`
