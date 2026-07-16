---
title: 통합검색 B — knowledge 인덱싱 + KnowledgeRetrieval 연결 Implementation Plan
slug: docs-superpowers-plans-2026-06-09-unified-search-b
sources: [docs/superpowers/plans/2026-06-09-unified-search-b.md]
status: open
created: 2026-06-09
topic: [knowledge-and-search]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: "Ingest now"가 vault 마크다운을 @apc/knowledge KnowledgeStore에 인덱싱하고, 검색이 세션과 함께 wiki/task 등 knowledge hit을 반환하도록 연결한다 (AC 6 2/2). Architecture: KnowledgeStore.clearProject 로 프로젝트 단위 전량 재인덱싱을 가능케 하고, @apc/app-services 에 KnowledgeIndexer (vault md 스캔→ indexMarkdownDoc )를 추가해 IngestService 에 주입한다. 데스크톱 컨테이너가 메인 영속 db에 migrateKnowledge 하고 KnowledgeStore / KnowledgeRetrieval 을 만들어 인덱서와 UnifiedSearch 에 배선한다. UnifiedSearch 는 projectId를

## Progress log

- Source checklist: 0 completed, 32 remaining.
- **File Structure**
- **Task 1: KnowledgeStore.clearProject** — 프로젝트의 모든 문서/청크/FTS 행을 삭제해 전량 재인덱싱을 가능케 한다. (collection/context 행은 유지 — upsertCollection이 idempotent.) packages/knowledge/src/knowledge-store.test.ts 의 describe('KnowledgeStore', ...) 안, 마지막 test(...) 뒤에 추가 Run: cd /mnt/c/Users/hskim/Desktop/ruahverce/ai dashboard && npx vitest run packages/knowledge/src/knowledge-store
- **Task 2: KnowledgeIndexer (@apc/app-services)** — vault 마크다운을 스캔해 KnowledgeStore에 인덱싱한다. 프로젝트별 collection 보장 → clearProject → 각 파일 인덱싱. packages/app-services/package.json 의 dependencies 블록에서 "@apc/knowledge-harness": "workspace: " 가 있는 줄에 @apc/knowledge 를 추가한다. 예: 해당 줄을 에서 로 변경. 그다음 Run: cd /mnt/c/Users/hskim/Desktop/ruahverce/ai dashboard && pnpm install Expected: 성공
- **Task 3: IngestService — "Ingest now"에 knowledge 결합** — 세션 인덱싱 후 KnowledgeIndexer.reindexAll 을 호출하고 결과에 documents 를 더한다. knowledge는 선택 의존이라 미주입 시 documents: 0 . packages/app-services/src/ingest-service.test.ts 에서 기존 toEqual 단언을 documents 포함으로 갱신한다(4곳) 그다음 describe('IngestService', ...) 끝(마지막 test 뒤)에 신규 테스트 추가 Run: cd /mnt/c/Users/hskim/Desktop/ruahverce/ai dashboard && npx
- **Task 4: UnifiedSearch — knowledge hit 연결** — UnifiedSearch.deps 에 knowledge? / projectIds? 를 추가하고, projectId를 순회해 KnowledgeRetrieval.search 결과를 정규화해 세션 hit 뒤에 append한다. apps/desktop/package.json 의 dependencies에서 "@apc/harness": "workspace: " 가 있는 줄 끝에 @apc/knowledge 를 추가 Run: cd /mnt/c/Users/hskim/Desktop/ruahverce/ai dashboard && pnpm install Expected: 성공. apps/
- **Task 5: 컨테이너 배선 + api 타입** — 메인 db에 migrateKnowledge 하고 KnowledgeStore / KnowledgeRetrieval 을 만들어 IngestService (인덱서)와 UnifiedSearch 에 주입한다. renderer api 타입에 documents 를 더한다. apps/desktop/src/main/container.ts 수정. (1) import: @apc/core 에서 migrate 는 이미 import됨. @apc/app-services import 줄에 KnowledgeIndexer 를, 그리고 @apc/knowledge import을 추가한다. 파일 상단 i
- **Verification (after all tasks)**
- **Notes / YAGNI (spec §9)** — 증분 hash diff(전량 재인덱싱 유지), 문서 딥링크(프로젝트 전환만), 검색어 하이라이트(첫 200자 excerpt), countMarkdownFiles ↔ listMarkdownFiles DRY 통합(중복 허용), 점수 기반 인터리브(append 유지), 동일 relPath 충돌 네임스페이싱, UI documents 노출은 범위 밖.

## Related

- Source: `docs/superpowers/plans/2026-06-09-unified-search-b.md`
