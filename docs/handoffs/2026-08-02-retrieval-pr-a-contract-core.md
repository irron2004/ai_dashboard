# Retrieval Phase 1 Stack A handoff

> 작성: 2026-08-02
> 기준선: `origin/main` `ba5b3d8`
> 브랜치: `agent/retrieval-contract-core`
> 다음 실행 단위: Stack B / 별도 worktree·branch·PR

## 완료 범위

- `@apc/shared`: scope가 필수인 query, evidence, authority·signal, typed diagnostic 계약
- `@apc/retrieval`: weighted RRF, identity-safe dedupe, parent/source cap, fail-closed `RetrievalService`
- `@apc/search`: 안전한 plain-text FTS query와 metadata-rich `turn_fts_v2`
- session adapter: 안정 turn ID·timestamp·opaque URI를 보존하고 raw locator를 response에서 숨김
- knowledge adapter: authority-neutral lexical rank와 status→authority/signal 매핑
- `KnowledgeStore.getChunkWithNeighbors`: 선택된 chunk만 주변 문맥으로 확장하는 seam

`authority`와 `signals.conflict`는 독립이다. authority는 fused relevance를 덮지 않으며 동일
`fusedScore`에서만 결정적 tie-break로 사용한다. 모든 검색기가 실패하면 빈 성공이 아니라
`RetrievalUnavailableError`, 일부만 실패하면 evidence와 typed diagnostic을 함께 반환한다.

## Stack B 시작 계약

Stack A 병합 commit에서 새 worktree를 만들고 다음 조립을 사용한다.

```ts
const retrieval = new RetrievalService({
  registry,
  retrievers: [
    new SessionFtsRetriever(searchIndex),
    new KnowledgeFtsRetriever(knowledgeRetrieval),
  ],
})
```

`RetrievalService.search`는 async다. 신규 evidence-rich IPC/UI를 먼저 연결하고 기존 동기
`UnifiedSearch`/`q:search`는 lossy compatibility adapter로 유지한다. agent context의 자동 근거와
사람이 고정한 `linkedWikiPages`를 섞어 덮어쓰지 않는다.

## Migration과 rollback

- 최초 DB open에서만 `search_index_meta.turn_fts_v2_backfill=complete` 전 v1을 v2로 backfill한다.
- marker 이후 startup은 body 전체를 스캔하지 않는다.
- 신규 ingest는 v1·v2를 한 transaction에서 dual-write해 legacy read path와 v2를 함께 유지한다.
- rollback은 구 binary가 DB에 새로 쓰는 방식이 아니라, 배포된 schema에서 legacy read path를
  다시 선택하는 방식이다.
- raw session locator는 `SearchIndex.resolveTurnUri` 뒤에만 있고 search response에는 노출되지 않는다.

## Stack C source resolver 주의점

- session URI: `apc://session/<encoded-session-id>#turn-<ordinal>`
- knowledge URI: `pmw://project/<encoded-project>/<encoded-path>#chunk-<ordinal>`
- `parseProjectDocUri`는 chunk fragment를 relPath와 분리하고 `chunk-<n>` 외 fragment를 거부한다.
  resolver는 반환된 `chunkOrdinal`과 `getChunkWithNeighbors`를 사용해야 한다.
- URI를 filesystem path로 직접 취급하지 말고 registry root 안에서 realpath containment를 적용한다.

## 검증과 남은 범위

Stack A targeted tests와 `pnpm typecheck`, 전체 `pnpm test`를 통과했다(254 files passed,
6 skipped; 1,503 tests passed, 11 skipped). UI/context consumer 전환, Markdown 증분 index,
fixture 기반 Recall·MRR·scope leakage·중복률, 실제 Electron smoke는 각각 Stack B와 Stack C
책임이다.

Task 0 synthetic 기준선은 index별 1,000 rows, 동일 query 20회 warm run에서 session
`p50 0.52 ms / p95 1.01 ms`, knowledge `p50 0.52 ms / p95 0.56 ms`였다. 이는 이 머신의 작은
in-memory lexical 기준선이며 실제 corpus 품질·latency 주장이 아니다.
