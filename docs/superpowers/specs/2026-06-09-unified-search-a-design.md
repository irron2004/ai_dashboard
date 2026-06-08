---
title: 통합검색 A — 검색 서비스(정규화 계약) + 모달 UI 설계 (AC#6, 1/2)
date: 2026-06-09
status: design-approved
author: PM (Claude)
relates-to:
  - docs/superpowers/specs/2026-06-07-product-requirements-coverage-diagnosis.md (P0 격차 #6)
  - docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md (Search and retrieval)
branch: docs/knowledge-harness-pipeline-spec
decomposition: A(이 문서) = 검색 서비스+UI(세션 인덱스, knowledge 슬롯). B(후속) = knowledge 인덱싱+retrieval 연결.
---

# 통합검색 A — 검색 서비스 + 모달 UI

## 1. 배경 / 문제

PRD 수용기준 **#6** — "P0 검색이 BM25로 task/wiki/session 함께 반환" — 가 미달이다. 진단(`2026-06-07-...-coverage-diagnosis.md` §2)·코드 대조 결과:

- `search` IPC(`apps/desktop/src/main/ipc.ts`)는 `container.searchIndex.search(...)`로 **세션 인덱스만** 반환한다(`@apc/search` `SearchHit = { sessionId, projectId, role, snippet }`). 세션 인덱스는 `IngestService.indexSession`이 채운다(작동 중).
- `@apc/knowledge`(KnowledgeStore/Retrieval/migrate)는 존재하나 **데스크톱에 전혀 미연결**(migrate·instantiate·indexing·retrieval 0). knowledge 인덱스를 채우는 코드도 없다.
- **검색 UI도 없다**(`api.search`는 정의돼 있으나 어떤 컴포넌트도 호출하지 않음).

**분해:** #6은 ① 통합 검색 서비스+UI(A), ② knowledge 인덱싱+연결(B)로 나뉜다. 이 문서는 **A**: 세션 인덱스 위에 정규화된 단일 `SearchResponse`와 검색 모달을 만든다(knowledge는 슬롯만 두고 B에서 채움). A가 *실데이터(세션) 검색 UI*를 즉시 제공하고, 정규화 계약을 만들어 B를 작은 추가로 만든다.

## 2. 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 1차 범위 | 세션 인덱스 기반 통합검색 + 모달 UI. knowledge = 빈 슬롯(B) |
| 계약 | 정규화 `UnifiedSearchResponse`(kind별 hit) |
| UI | 검색 **모달**(툴바 버튼 + Ctrl+K), 결과 클릭 = 그 프로젝트로 전환 |
| 검색 범위 | 전 프로젝트(projectId 미지정). 프로젝트 필터 = 후속 |

## 3. 정규화 계약 (`@apc/shared`)

```ts
export type UnifiedSearchHit = {
  kind: string        // 'session' (now) | 'wiki' | 'task' | ... (B)
  id: string
  title: string
  excerpt: string
  projectId: string
  score?: number
}
export type UnifiedSearchResponse = { query: string; hits: UnifiedSearchHit[] }
```

## 4. `UnifiedSearch` 서비스 (`packages/app-services/src/unified-search.ts`, 신규)

```ts
import type { SearchIndex } from '@apc/search'
import type { UnifiedSearchResponse } from '@apc/shared'

export class UnifiedSearch {
  constructor(private readonly deps: { sessions: SearchIndex }) {}  // B: + knowledge?: KnowledgeRetrieval

  search(input: { query: string; projectId?: string }): UnifiedSearchResponse {
    const query = input.query.trim()
    if (!query) return { query, hits: [] }
    const sessionHits = this.deps.sessions.search(query, input.projectId ? { projectId: input.projectId } : {})
    const hits = sessionHits.map((h) => ({
      kind: 'session', id: h.sessionId, title: h.sessionId, excerpt: h.snippet, projectId: h.projectId,
    }))
    // knowledge hits = [] until B
    return { query, hits }
  }
}
```
- 순수 매핑 + 세션 인덱스 쿼리. in-memory SearchIndex로 테스트.

## 5. 배선

- **컨테이너**(`container.ts`): `const unifiedSearch = new UnifiedSearch({ sessions: searchIndex })`; `Container`에 `search: (req: SearchReq) => UnifiedSearchResponse` 추가, 반환에 포함.
- **ipc.ts**: `[CH.search]` 핸들러를 `container.searchIndex.search(...)` → `container.search(req)`로 변경.
- **ipc-contract.ts**: `SearchReq = { query, projectId? }` 유지. `UnifiedSearchHit`/`UnifiedSearchResponse`는 `@apc/shared`에서 import해 노출(또는 재export).
- **api.ts**: `search(req): Promise<UnifiedSearchResponse>` (기존 `Promise<unknown[]>`에서 변경).

## 6. UI — `SearchModal` (`apps/desktop/src/renderer/components/SearchModal.tsx`, 신규)

- props: `{ open: boolean; onClose: () => void; onSelectProject: (projectId: string) => void }`.
- 모달-로컬 state: `query`, `hits`, `loading`, `error`. (스토어 변경 없음.)
- 입력 + Enter → `api.search({ query })` → `setHits(res.hits)`.
- 각 hit: `[kind]` 뱃지 + `projectId` + `title` + `excerpt`. 클릭 → `onSelectProject(hit.projectId)` + `onClose()`.
- 빈 쿼리/0건/에러 상태. 기존 `.add-project-overlay`/`.add-project-dialog` 모달 패턴 재사용.
- **App.tsx**: `searchOpen` state + 툴바 "🔎 Search" 버튼 + `Ctrl+K`(기존 키 핸들러에 추가) → open. `<SearchModal open={searchOpen} onClose={...} onSelectProject={selectProject} />`.

## 7. 데이터 흐름

입력 → `api.search({query})` → IPC `q:search` → `container.search` → `UnifiedSearch.search`(세션 인덱스 쿼리 → 정규화) → `UnifiedSearchResponse` → 모달 목록 → 클릭 시 `selectProject(projectId)` + 닫기.

## 8. 에러 / 빈 상태

| 상황 | 처리 |
|---|---|
| 빈 쿼리 | 검색 안 함, 빈 결과 |
| 0건 | "결과 없음" |
| api 실패 | 모달에 에러 메시지(try/catch) |

## 9. 테스트

- **`UnifiedSearch.search`**: in-memory `SearchIndex`에 세션 인덱싱 후 검색 → `kind:'session'` 정규화 hit 반환(id=sessionId, excerpt=snippet); 빈 쿼리 → `hits: []`. (app-services 단위)
- **`SearchModal`**: `api.search` mock → 입력+Enter → hits 렌더(kind/title/excerpt); hit 클릭 → `onSelectProject(projectId)` 호출 + `onClose`. 0건 상태. (desktop 컴포넌트)
- IPC/container/App 배선: typecheck + 데스크톱 스위트 green.

## 10. 범위 밖 (YAGNI)

- **knowledge 인덱싱 + retrieval 연결 = B(후속)**. (이번 hits에 knowledge 없음.)
- 프로젝트 필터(전 프로젝트만), 클릭=특정 세션/문서 딥링크(프로젝트 전환만), 재랭킹/하이브리드(세션 FTS 그대로), 검색어 하이라이트.

## 11. 수용 기준 (Done)

1. 툴바 버튼/Ctrl+K로 검색 모달을 열고, 검색어 입력 → 세션 결과가 정규화된 형태로 나온다.
2. `search` IPC가 `UnifiedSearchResponse`(kind/id/title/excerpt/projectId)를 반환한다.
3. 결과 클릭 시 그 프로젝트로 전환된다.
4. 빈 쿼리/0건/에러 상태가 처리된다.
5. 신규/기존 테스트 + `pnpm typecheck` 통과. 새 IPC **명령** 없음(기존 `search` 채널 재사용), migration 없음.
6. `UnifiedSearch`에 knowledge 슬롯이 있어 B에서 작은 추가로 연결 가능하다.
