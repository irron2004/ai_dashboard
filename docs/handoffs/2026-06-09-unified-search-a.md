# Handoff — 통합검색 A (검색 서비스 + 모달 UI, AC#6 1/2, 구현 완료)

- **Date**: 2026-06-09
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **PR**: 신규 → main 예정

## 0. 한 줄 요약

PRD P0 격차 **#6**(검색이 session/wiki/task 함께 반환)의 **A 절반** 완료: 세션 인덱스 위에 정규화된 `UnifiedSearchResponse`와 검색 모달(툴바 버튼 + Ctrl+K). knowledge 절반은 **B(후속)** — `UnifiedSearch.deps`에 슬롯만 둠. brainstorm→spec→plan→subagent 5 Task team-mode, 최종 리뷰 READY_TO_MERGE.

## 1. 한 일 (5 Task)

- **S1** `UnifiedSearchHit`/`UnifiedSearchResponse`(@apc/shared) + `UnifiedSearch` 서비스(`apps/desktop/src/main/unified-search.ts`): 세션 인덱스 쿼리 → `{kind:'session', id, title, excerpt, projectId}` 정규화. 빈 쿼리 단락. knowledge 슬롯 비움.
- **S2** `container.search` 노출 + `q:search` IPC 핸들러를 `container.search`로 위임 + api `search` 반환을 `UnifiedSearchResponse`로.
- **S3** `SearchModal`(입력+Enter→`api.search`→결과, hit 클릭→`onSelectProject`+닫기, 빈/0건/에러 상태, 기존 모달 패턴 재사용).
- **S4** App.tsx 툴바 "🔎 Search" 버튼 + **별도** Ctrl+K useEffect(기존 Digit 핸들러 불변) + 모달 렌더 + CSS.

## 2. 커밋 (base `aacdb17`=plan 위)

```
0cbae2d feat(desktop): search modal toolbar button + Ctrl+K
14eee98 feat(desktop): SearchModal renders unified search hits
e0d5f27 feat(desktop): q:search returns UnifiedSearchResponse via container.search
7cfd9ed feat(desktop): UnifiedSearch service + normalized search types
```

## 3. 검증 (전부 green)

```bash
pnpm typecheck                  # clean
npx vitest run packages/shared  # 39
cd apps/desktop && npx vitest run   # 78 (unified-search 2 + SearchModal 2 신규)
```
최종 리뷰: end-to-end 체인 무결(App→api→`q:search`→container.search→UnifiedSearch→searchIndex→정규화→모달→클릭=프로젝트 전환), `UnifiedSearch*` 단일 타입, 구 array→object 형태 변경 소비자는 신규 SearchModal뿐(회귀 없음), 새 IPC 채널·migration 없음.

## 4. 남은 것 / 후속 (low, 비차단)

- **B (#6 나머지)**: knowledge 테이블 migrate + vault/wiki 문서 인덱싱 + `KnowledgeRetrieval`을 `UnifiedSearch.deps.knowledge`로 연결. → hits에 wiki/task 등 추가. (계약·모달은 이미 임의 kind 처리.)
- `UnifiedSearch` 위치: `apps/desktop/src/main`(cross-package 의존 회피 의도). B에서 knowledge가 패키지면 이동 검토.
- 검색 중 **loading 표시** 미구현(spec §6엔 있었음). 짧은 추가.
- `q:search` IPC 핸들러 통합 테스트 없음(서비스·모달은 단위 테스트됨).
- title=raw sessionId, 프로젝트 필터, 특정 세션 딥링크 = 후속.

## 5. 핵심 파일

```
packages/shared/src/search-schema.ts                 # UnifiedSearchHit/Response
apps/desktop/src/main/unified-search.ts              # UnifiedSearch (knowledge 슬롯)
apps/desktop/src/main/container.ts                   # container.search
apps/desktop/src/main/ipc.ts                         # q:search → container.search
apps/desktop/src/renderer/components/SearchModal.tsx # 모달 UI
apps/desktop/src/renderer/App.tsx                    # 툴바 버튼 + Ctrl+K
```
