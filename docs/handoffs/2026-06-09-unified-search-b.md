# Handoff — 통합검색 B (knowledge 인덱싱 + retrieval 연결, AC#6 2/2, 구현 완료)

- **Date**: 2026-06-09
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **PR**: 신규 → main 예정

## 0. 한 줄 요약

PRD P0 격차 **#6**의 나머지 절반 완료: "Ingest now"가 프로젝트 vault 마크다운을 `@apc/knowledge` KnowledgeStore에 인덱싱하고, 검색이 세션과 함께 wiki/task/decision 등 knowledge hit을 반환. A에서 비워둔 `UnifiedSearch.deps.knowledge` 슬롯을 채움. brainstorm→spec→plan→subagent 5 Task team-mode, 최종 리뷰 READY_TO_MERGE.

## 1. 한 일 (5 Task, 각 TDD + spec/code-quality 2단 리뷰)

- **Task 1** `KnowledgeStore.clearProject(projectId)` — 전량 재인덱싱용, fts→chunks→documents 삭제(FTS5는 FK cascade 비대상이라 명시 삭제).
- **Task 2** `KnowledgeIndexer`(@apc/app-services 신규) — 프로젝트별 collection 보장→clearProject→`<vaultRoot>/projects/<id>`+`project.vaultPaths` md 스캔(SCAN_LIMIT 2000/DEPTH 12, 심링크 스킵)→`indexMarkdownDoc`. `reindexAll`/`reindexProject`. roots 중복제거·빈 relPath 가드.
- **Task 3** `IngestService` — 선택 `knowledge?` dep, `ingestAll`이 세션 후 `reindexAll()` 호출, `IngestResult.documents` 반환(미주입 시 0). reindex throw 시에도 락 해제.
- **Task 4** `UnifiedSearch`(desktop main) — `knowledge?`/`projectIds?` 추가, projectId 순회(미지정 시 전 프로젝트), 프로젝트별 try/catch(FTS 에러 격리), KnowledgeSearchHit→UnifiedSearchHit 정규화(kind=docType, excerpt=body 200자), 세션 hit 뒤 append.
- **Task 5** 컨테이너 배선 — `migrateKnowledge(db)`(메인 영속 db), KnowledgeStore/Retrieval 생성, IngestService에 indexer·UnifiedSearch에 retrieval/projectIds 주입. api `ingestAll`+store `lastIngest` 타입에 `documents` 추가.

## 2. 커밋 (base `c507a88`=plan 위)

```
acd127a feat(desktop): wire knowledge migrate/store/retrieval/indexer into container + UnifiedSearch
065255c feat(desktop): UnifiedSearch returns knowledge hits (kind=docType) across projects
f6c3f30 feat(app-services): IngestService runs knowledge reindex, returns documents count
7eadbc3 feat(app-services): KnowledgeIndexer scans vault markdown into KnowledgeStore
2a8fcf8 feat(knowledge): KnowledgeStore.clearProject for full reindex
```

## 3. 검증 (전부 green)

```bash
pnpm typecheck                                                  # clean
npx vitest run packages/knowledge packages/app-services packages/shared   # 241
cd apps/desktop && npx vitest run                              # 81
```
최종 리뷰(opus): e2e 체인 무결(부팅 `migrateKnowledge`(메인 db) → "Ingest now" `ingestAll`→`reindexAll`→upsertCollection/clearProject/scan/`indexMarkdownDoc`, 락 해제 보장 → 검색 `UnifiedSearch`→projectId 순회 `KnowledgeRetrieval`→정규화 append, FTS 에러 격리·빈 쿼리 단락), 단일 타입(`UnifiedSearchHit`@shared/`IngestResult`@app-services), 회귀 없음(knowledge 선택·세션 전용 보존), clearProject 삭제순서·INSERT OR REPLACE idempotency·CREATE IF NOT EXISTS 영속성 OK, 스캔 가드 존재. 새 IPC 명령 없음(`search`/`ingest` 재사용), 새 migration은 `migrateKnowledge`(기존 패키지 함수)뿐.

## 4. 남은 것 / 후속 (low, 비차단)

- UI에 `documents` 카운트 노출(App.tsx는 `sessions`만 표시) — spec §6대로 의도적 후속.
- `countMarkdownFiles`(container 프리플라이트)↔`listMarkdownFiles`(indexer) 디렉터리 walk 중복 — 공유 유틸 추출 후속(plan §9 YAGNI 인정).
- 증분 hash diff(전량 재인덱싱 유지), 문서 딥링크(프로젝트 전환만), 검색어 하이라이트, 점수 기반 세션↔knowledge 인터리브(append 유지), 동일 relPath 충돌 네임스페이싱 — 범위 밖.
- knowledge 인덱스는 영속 메인 db에 저장 → 부팅마다 재인덱싱 불필요(트리거는 Ingest). vault에 promote된 문서가 적으면 인덱스도 희소(정상).

## 5. 핵심 파일

```
packages/knowledge/src/knowledge-store.ts            # clearProject
packages/app-services/src/knowledge-indexer.ts       # KnowledgeIndexer (스캔→indexMarkdownDoc)
packages/app-services/src/ingest-service.ts          # knowledge? dep + documents
apps/desktop/src/main/unified-search.ts              # knowledge/projectIds 연결
apps/desktop/src/main/container.ts                   # migrateKnowledge + store/retrieval 배선
```

## 6. 다음 후보

- PRD P0 잔여 격차(진단서 `2026-06-07-...-coverage-diagnosis.md` 참조).
- codex 런타임 end-to-end(사용자 진단 입력 대기).
- 사용자 핵심 비전: docs→LLM wiki 원클릭 harness + 중간 과정 시각화(MEMORY `docs-to-wiki-harness-goal`).
