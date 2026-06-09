---
title: 통합검색 B — knowledge 인덱싱 + KnowledgeRetrieval 연결 설계 (AC#6, 2/2)
date: 2026-06-09
status: design-approved
author: PM (Claude)
relates-to:
  - docs/superpowers/specs/2026-06-09-unified-search-a-design.md (A: 검색 서비스+UI)
  - docs/superpowers/specs/2026-06-07-product-requirements-coverage-diagnosis.md (P0 격차 #6)
  - docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md (Search and retrieval)
branch: docs/knowledge-harness-pipeline-spec
decomposition: A(완료) = 검색 서비스+UI(세션 인덱스, knowledge 슬롯). B(이 문서) = knowledge 인덱싱 + retrieval 연결.
---

# 통합검색 B — knowledge 인덱싱 + KnowledgeRetrieval 연결

## 1. 배경 / 문제

PRD 수용기준 **#6** — "P0 검색이 BM25로 task/wiki/session 함께 반환" — 의 나머지 절반. A는 세션 인덱스 위에 정규화된 `UnifiedSearchResponse`와 검색 모달을 만들고 `UnifiedSearch.deps`에 knowledge 슬롯만 비워뒀다. B는 그 슬롯을 채운다:

- `@apc/knowledge`(KnowledgeStore/Retrieval/migrate/chunker)는 완성돼 있으나 **데스크톱에 전혀 미연결** — migrate·instantiate·indexing·retrieval 0. knowledge 인덱스를 채우는 코드도 없다.
- 따라서 B는 ① vault 마크다운을 KnowledgeStore에 인덱싱하는 흐름, ② 그 인덱싱을 "Ingest now"에 결합, ③ `KnowledgeRetrieval`을 `UnifiedSearch.deps.knowledge`로 연결해 검색 결과에 wiki/task 등이 함께 나오게 한다.

## 2. 설계 결정 (확정)

| 항목 | 결정 | 대안(기각) |
|---|---|---|
| 인덱싱 트리거 | **"Ingest now"에 포함** (버튼 하나가 세션+knowledge 둘 다 갱신) | 별도 Reindex 버튼 / promote 시 자동 |
| 인덱서 위치·결합 | `KnowledgeIndexer`를 `@apc/app-services`에, `IngestService.deps.knowledge?`로 주입 (단일 seam) | desktop main + container 래핑 |
| 전역 검색의 knowledge | `UnifiedSearch.deps`에 `knowledge?` + `projectIds?` → projectId 순회. `@apc/knowledge` 무수정 | knowledge 패키지에 cross-project 검색 추가 |
| 삭제 문서 처리 | reindex 시 `clearProject` 후 전량 재인덱싱 (문서 수 적음, 단순·정확) | hash diff 증분 |
| knowledge 인덱스 저장 | **메인 영속 `db`** (`migrateKnowledge(db)`) | in-memory(세션 인덱스처럼) |
| 인덱싱 범위 | `<vaultRoot>/projects/<id>/**/*.md` + `project.vaultPaths` | repo 전체 |

## 3. 데이터 위치

- 컨테이너 부팅 시 `migrateKnowledge(db)` 1회 호출(메인 영속 `db` — `KnowledgeStore`/`KnowledgeRetrieval`은 `@apc/core` `Db`를 받음, 세션 인덱스의 in-memory `searchDb`와 분리).
- `const knowledgeStore = new KnowledgeStore(db)`, `const knowledgeRetrieval = new KnowledgeRetrieval(db)`.
- `indexMarkdownDoc`은 hash 기반 `INSERT OR REPLACE` + 청크 삭제 후 재삽입 → 재인덱싱 idempotent. 영속이라 매 부팅 재인덱싱 불필요(트리거는 Ingest).

## 4. `KnowledgeStore.clearProject` (신규 메서드, `@apc/knowledge`)

```ts
clearProject(projectId: string): void {
  // FTS 먼저(외래 doc_id 참조), 그다음 chunks, documents
  this.db.prepare('DELETE FROM knowledge_chunk_fts WHERE project_id = ?').run(projectId)
  this.db.prepare('DELETE FROM knowledge_chunks WHERE project_id = ?').run(projectId)
  this.db.prepare('DELETE FROM knowledge_documents WHERE project_id = ?').run(projectId)
}
```
- 전량 재인덱싱을 위해 프로젝트의 문서/청크/FTS를 제거. (collection/context 행은 유지 — upsertCollection이 idempotent.)

## 5. `KnowledgeIndexer` (신규, `packages/app-services/src/knowledge-indexer.ts`)

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ProjectRegistry } from '@apc/core'
import type { KnowledgeStore } from '@apc/knowledge'

const SCAN_LIMIT = 2000
const DEPTH_LIMIT = 12

export type KnowledgeIndexerDeps = { registry: ProjectRegistry; store: KnowledgeStore; vaultRoot: string }
export type KnowledgeReindexResult = { documents: number }

export class KnowledgeIndexer {
  constructor(private readonly deps: KnowledgeIndexerDeps) {}

  reindexAll(): KnowledgeReindexResult {
    let documents = 0
    for (const project of this.deps.registry.list()) documents += this.reindexProject(project.id)
    return { documents }
  }

  reindexProject(projectId: string): number {
    const project = this.deps.registry.get(projectId)
    if (!project) return 0
    const collectionId = `project:${projectId}`
    const projectVaultRoot = join(this.deps.vaultRoot, 'projects', projectId)
    this.deps.store.upsertCollection({
      id: collectionId, projectId, name: project.name,
      rootPath: projectVaultRoot, include: ['**/*.md', '**/*.mdx'], exclude: [], includeByDefault: true,
    })
    this.deps.store.clearProject(projectId)
    let count = 0
    const roots = [...project.vaultPaths, projectVaultRoot]
    for (const root of roots) {
      for (const file of listMarkdownFiles(root)) {
        let markdown: string, updatedAt: string
        try {
          markdown = readFileSync(file, 'utf8')
          updatedAt = statSync(file).mtime.toISOString()
        } catch { continue }
        const relPath = relative(root, file).split('\\').join('/')
        this.deps.store.indexMarkdownDoc({ collectionId, projectId, relPath, markdown, updatedAt })
        count++
      }
    }
    return count
  }
}

function listMarkdownFiles(root: string): string[] {
  const found: string[] = []
  const visit = (path: string, depth: number): void => {
    if (found.length >= SCAN_LIMIT || depth > DEPTH_LIMIT) return
    let st: import('node:fs').Stats | undefined
    try { st = statSync(path, { throwIfNoEntry: false }) } catch { return }
    if (!st) return
    if (st.isFile()) { if (/\.mdx?$/i.test(path)) found.push(path); return }
    if (!st.isDirectory()) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      visit(join(path, entry.name), depth + 1)
      if (found.length >= SCAN_LIMIT) return
    }
  }
  visit(root, 0)
  return found
}
```
- relPath은 발견된 루트 상대(Windows 역슬래시 정규화). docId = `collectionId:relPath`이므로 한 프로젝트의 두 루트에 동일 relPath가 있으면 마지막이 이김(드묾, 허용 — §9).
- `listMarkdownFiles`는 container의 `countMarkdownFiles`와 같은 가드(depth/limit, 심링크 스킵)를 재현. DRY 통합은 후속(§9).
- `@apc/app-services`에 `@apc/knowledge` 의존 추가(package.json).
- `packages/app-services/src/index.ts`에 `export * from './knowledge-indexer.js'`.

## 6. 'Ingest now' 결합 (`IngestService`)

```ts
export type IngestDeps = {
  registry: ProjectRegistry; cursors: IngestCursorStore; index: SearchIndex
  knowledge?: KnowledgeIndexer   // 신규
}
export type IngestResult = { sources: number; sessions: number; documents: number }  // documents 추가
```
- `ingestAll` 끝(락 해제 전, return 전): `const { documents } = this.deps.knowledge?.reindexAll() ?? { documents: 0 }`; `return { sources, sessions, documents }`.
- 컨테이너: `new IngestService({ registry, cursors, index: searchIndex, knowledge: new KnowledgeIndexer({ registry, store: knowledgeStore, vaultRoot: opts.vaultRoot }) })`.
- `IngestResult` 소비자(IPC `ingest` 핸들러/api/UI)는 추가 필드 `documents`만 무시·표시 — 기존 `sources`/`sessions` 불변(회귀 없음). UI에 documents 노출은 선택(후속).

## 7. `UnifiedSearch` 연결 (`apps/desktop/src/main/unified-search.ts`)

```ts
import type { SearchIndex } from '@apc/search'
import type { KnowledgeRetrieval } from '@apc/knowledge'
import type { UnifiedSearchResponse, UnifiedSearchHit } from '@apc/shared'

export class UnifiedSearch {
  constructor(private readonly deps: {
    sessions: SearchIndex
    knowledge?: KnowledgeRetrieval        // 신규
    projectIds?: () => string[]           // 신규 (전역 검색 시 순회 대상)
  }) {}

  search(input: { query: string; projectId?: string }): UnifiedSearchResponse {
    const query = input.query.trim()
    if (!query) return { query, hits: [] }
    const sessionHits = this.deps.sessions.search(query, input.projectId ? { projectId: input.projectId } : {})
    const hits: UnifiedSearchHit[] = sessionHits.map((h) => ({
      kind: 'session', id: h.sessionId, title: h.sessionId, excerpt: h.snippet, projectId: h.projectId,
    }))
    if (this.deps.knowledge) {
      const projectIds = input.projectId ? [input.projectId] : (this.deps.projectIds?.() ?? [])
      for (const projectId of projectIds) {
        for (const hit of this.deps.knowledge.search({ projectId, query, limit: 10 })) {
          hits.push({
            kind: hit.doc.docType, id: hit.doc.id, title: hit.doc.title,
            excerpt: hit.chunk.body.slice(0, 200), projectId: hit.doc.projectId, score: hit.score,
          })
        }
      }
    }
    return { query, hits }
  }
}
```
- 세션 hits 뒤에 knowledge hits append → 기존 세션 테스트·동작 보존. 모달은 임의 `kind`를 이미 뱃지로 처리(A).
- `KnowledgeRetrieval.search`가 FTS MATCH 문법 오류를 던질 수 있으므로 호출을 try/catch로 감싸 빈 결과로 처리(§8).
- 컨테이너: `new UnifiedSearch({ sessions: searchIndex, knowledge: knowledgeRetrieval, projectIds: () => registry.list().map((p) => p.id) })`.

## 8. 에러 / 빈 상태

| 상황 | 처리 |
|---|---|
| knowledge 미주입(테스트/구성) | knowledge 블록 스킵 → 세션만 (A와 동일) |
| FTS MATCH 파싱 에러(특수문자 쿼리) | `knowledge.search` try/catch → 해당 프로젝트 빈 결과, 나머지 진행 |
| 인덱싱 중 파일 read 실패 | 해당 파일 skip(continue), 나머지 계속 |
| 프로젝트 0개 | reindexAll → `{ documents: 0 }` |

## 9. 범위 밖 (YAGNI)

- 증분 hash diff(전량 재인덱싱 유지), 클릭 시 문서 딥링크(프로젝트 전환만), 검색어 하이라이트(첫 200자 excerpt), `countMarkdownFiles`↔`listMarkdownFiles` DRY 통합(중복 허용), 점수 기반 세션↔knowledge 인터리브(append 유지), 동일 relPath 충돌의 루트 네임스페이싱, UI에 `documents` 카운트 노출.

## 10. 수용 기준 (Done)

1. 컨테이너 부팅 시 `migrateKnowledge(db)`가 호출되고 `KnowledgeStore`/`KnowledgeRetrieval`이 메인 db로 생성된다.
2. "Ingest now"가 세션 인덱싱 후 `KnowledgeIndexer.reindexAll`로 각 프로젝트의 vault 마크다운을 KnowledgeStore에 인덱싱하고, `IngestResult.documents`가 인덱싱된 문서 수를 반환한다(기존 `sources`/`sessions` 불변).
3. 재인덱싱은 idempotent하며 디스크에서 삭제된 문서는 `clearProject`로 인덱스에서도 사라진다.
4. 검색 모달에서 검색 시 결과에 knowledge hit(`kind`=docType: wiki/task/decision 등)이 세션 hit과 함께 정규화된 형태로 나온다. projectId 미지정 전역 검색은 등록된 모든 프로젝트를 순회한다.
5. knowledge 미주입 시 기존(세션만) 동작이 보존되고, 특수문자 쿼리의 FTS 에러가 전체 검색을 깨뜨리지 않는다.
6. 신규/기존 테스트 + `pnpm typecheck` 통과. 새 IPC **명령** 없음(`search`/`ingest` 채널 재사용). 새 migration은 `migrateKnowledge`(기존 패키지 함수) 호출뿐.
