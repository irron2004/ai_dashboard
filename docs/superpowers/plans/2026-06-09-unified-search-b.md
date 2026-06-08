# 통합검색 B — knowledge 인덱싱 + KnowledgeRetrieval 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Ingest now"가 vault 마크다운을 `@apc/knowledge` KnowledgeStore에 인덱싱하고, 검색이 세션과 함께 wiki/task 등 knowledge hit을 반환하도록 연결한다 (AC#6 2/2).

**Architecture:** `KnowledgeStore.clearProject`로 프로젝트 단위 전량 재인덱싱을 가능케 하고, `@apc/app-services`에 `KnowledgeIndexer`(vault md 스캔→`indexMarkdownDoc`)를 추가해 `IngestService`에 주입한다. 데스크톱 컨테이너가 메인 영속 db에 `migrateKnowledge`하고 `KnowledgeStore`/`KnowledgeRetrieval`을 만들어 인덱서와 `UnifiedSearch`에 배선한다. `UnifiedSearch`는 projectId를 순회하며 `KnowledgeRetrieval`을 호출해 hit을 정규화해 세션 hit 뒤에 append한다.

**Tech Stack:** TypeScript(NodeNext, `.js` import 확장자), `node:sqlite`(`DatabaseSync`)/`@apc/core` `Db`, FTS5, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-09-unified-search-b-design.md`

---

## File Structure

- **Modify** `packages/knowledge/src/knowledge-store.ts` — `clearProject(projectId)` 메서드 추가.
- **Modify** `packages/knowledge/src/knowledge-store.test.ts` — clearProject 테스트.
- **Create** `packages/app-services/src/knowledge-indexer.ts` — `KnowledgeIndexer` + `listMarkdownFiles`.
- **Create** `packages/app-services/src/knowledge-indexer.test.ts` — 인덱서 테스트(temp vault).
- **Modify** `packages/app-services/src/index.ts` — `KnowledgeIndexer` export.
- **Modify** `packages/app-services/package.json` — `@apc/knowledge` 의존 추가.
- **Modify** `packages/app-services/src/ingest-service.ts` — `IngestDeps.knowledge?` + `IngestResult.documents` + `reindexAll` 호출.
- **Modify** `packages/app-services/src/ingest-service.test.ts` — 기존 `toEqual` 단언에 `documents` 추가 + 신규 knowledge 통합 테스트.
- **Modify** `apps/desktop/src/main/unified-search.ts` — `knowledge?`/`projectIds?` deps + knowledge 쿼리·정규화.
- **Modify** `apps/desktop/src/main/unified-search.test.ts` — knowledge hit/필터/미주입 테스트.
- **Modify** `apps/desktop/package.json` — `@apc/knowledge` 의존 추가.
- **Modify** `apps/desktop/src/main/container.ts` — `migrateKnowledge` + store/retrieval + 인덱서/검색 배선.
- **Modify** `apps/desktop/src/renderer/api.ts` — `ingestAll` 반환 타입에 `documents` 추가.

---

## Task 1: `KnowledgeStore.clearProject`

프로젝트의 모든 문서/청크/FTS 행을 삭제해 전량 재인덱싱을 가능케 한다. (collection/context 행은 유지 — upsertCollection이 idempotent.)

**Files:**
- Modify: `packages/knowledge/src/knowledge-store.ts` (클래스 끝, `listChunks` 뒤)
- Test: `packages/knowledge/src/knowledge-store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/knowledge/src/knowledge-store.test.ts`의 `describe('KnowledgeStore', ...)` 안, 마지막 `test(...)` 뒤에 추가:

```ts
  test('clearProject removes only that project documents and chunks', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertCollection({ id: 'kc2', projectId: 'p2', name: 'Wiki2', rootPath: '/vault/p2', include: ['**/*.md'], exclude: [], includeByDefault: true })
    const a = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# A\n\nalpha', updatedAt: '2026-06-01T10:00:00Z' })
    const b = store.indexMarkdownDoc({ collectionId: 'kc2', projectId: 'p2', relPath: 'current.md', markdown: '# B\n\nbeta', updatedAt: '2026-06-01T10:00:00Z' })

    store.clearProject('p1')

    expect(store.getDocument(a.id)).toBeUndefined()
    expect(store.listChunks(a.id)).toHaveLength(0)
    expect(store.getDocument(b.id)?.id).toBe(b.id)   // p2 intact
    expect(store.listChunks(b.id).length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && npx vitest run packages/knowledge/src/knowledge-store.test.ts`
Expected: FAIL — `store.clearProject is not a function`.

- [ ] **Step 3: Implement clearProject**

`packages/knowledge/src/knowledge-store.ts`의 `KnowledgeStore` 클래스에서 `listChunks` 메서드 바로 뒤에 추가:

```ts
  clearProject(projectId: string): void {
    this.db.prepare('DELETE FROM knowledge_chunk_fts WHERE project_id = ?').run(projectId)
    this.db.prepare('DELETE FROM knowledge_chunks WHERE project_id = ?').run(projectId)
    this.db.prepare('DELETE FROM knowledge_documents WHERE project_id = ?').run(projectId)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && npx vitest run packages/knowledge/src/knowledge-store.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard
git add packages/knowledge/src/knowledge-store.ts packages/knowledge/src/knowledge-store.test.ts
git commit -m "feat(knowledge): KnowledgeStore.clearProject for full reindex"
```

---

## Task 2: `KnowledgeIndexer` (@apc/app-services)

vault 마크다운을 스캔해 KnowledgeStore에 인덱싱한다. 프로젝트별 collection 보장 → `clearProject` → 각 파일 인덱싱.

**Files:**
- Modify: `packages/app-services/package.json` (의존 추가)
- Create: `packages/app-services/src/knowledge-indexer.ts`
- Create: `packages/app-services/src/knowledge-indexer.test.ts`
- Modify: `packages/app-services/src/index.ts` (export)

- [ ] **Step 1: Add `@apc/knowledge` dependency + install**

`packages/app-services/package.json`의 dependencies 블록에서 `"@apc/knowledge-harness": "workspace:*"` 가 있는 줄에 `@apc/knowledge`를 추가한다. 예: 해당 줄을

```json
    "@apc/knowledge-harness": "workspace:*"
```

에서

```json
    "@apc/knowledge-harness": "workspace:*", "@apc/knowledge": "workspace:*"
```

로 변경. 그다음:

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && pnpm install`
Expected: 성공(workspace 링크 갱신).

- [ ] **Step 2: Write the failing test**

Create `packages/app-services/src/knowledge-indexer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval } from '@apc/knowledge'
import { KnowledgeIndexer } from './knowledge-indexer.js'

describe('KnowledgeIndexer', () => {
  let db: Db
  let registry: ProjectRegistry
  let store: KnowledgeStore
  let retrieval: KnowledgeRetrieval
  let vaultRoot: string

  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migrateKnowledge(db)
    registry = new ProjectRegistry(db)
    store = new KnowledgeStore(db)
    retrieval = new KnowledgeRetrieval(db)
    vaultRoot = mkdtempSync(join(tmpdir(), 'apc-knidx-'))
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/work/p1'], vaultPaths: [], sourcePaths: [] })
    const projDir = join(vaultRoot, 'projects', 'p1', 'wiki')
    mkdirSync(projDir, { recursive: true })
    writeFileSync(join(projDir, 'orchestration.md'), '# Orchestration\n\nagent orchestration and routing notes')
  })

  afterEach(() => { rmSync(vaultRoot, { recursive: true, force: true }) })

  test('indexes project vault markdown so retrieval finds it', () => {
    const count = new KnowledgeIndexer({ registry, store, vaultRoot }).reindexProject('p1')
    expect(count).toBe(1)
    const hits = retrieval.search({ projectId: 'p1', query: 'orchestration', limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].doc.relPath).toBe('wiki/orchestration.md')
  })

  test('reindex is idempotent (no duplicate docs)', () => {
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    indexer.reindexProject('p1')
    const hits = retrieval.search({ projectId: 'p1', query: 'orchestration', limit: 5 })
    expect(hits.filter((h) => h.doc.relPath === 'wiki/orchestration.md')).toHaveLength(1)
  })

  test('deleting a file then reindexing removes it from the index', () => {
    const indexer = new KnowledgeIndexer({ registry, store, vaultRoot })
    indexer.reindexProject('p1')
    rmSync(join(vaultRoot, 'projects', 'p1', 'wiki', 'orchestration.md'))
    const count = indexer.reindexProject('p1')
    expect(count).toBe(0)
    expect(retrieval.search({ projectId: 'p1', query: 'orchestration', limit: 5 })).toHaveLength(0)
  })

  test('reindexAll covers every registered project', () => {
    const result = new KnowledgeIndexer({ registry, store, vaultRoot }).reindexAll()
    expect(result.documents).toBe(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && npx vitest run packages/app-services/src/knowledge-indexer.test.ts`
Expected: FAIL — cannot find module `./knowledge-indexer.js`.

- [ ] **Step 4: Implement `KnowledgeIndexer`**

Create `packages/app-services/src/knowledge-indexer.ts`:

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
        let markdown: string
        let updatedAt: string
        try {
          markdown = readFileSync(file, 'utf8')
          updatedAt = statSync(file).mtime.toISOString()
        } catch {
          continue
        }
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

- [ ] **Step 5: Export from package index**

`packages/app-services/src/index.ts`에 다른 `export * from './*.js'` 줄들과 같은 위치에 추가:

```ts
export * from './knowledge-indexer.js'
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && npx vitest run packages/app-services/src/knowledge-indexer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard
git add packages/app-services/package.json packages/app-services/src/knowledge-indexer.ts packages/app-services/src/knowledge-indexer.test.ts packages/app-services/src/index.ts pnpm-lock.yaml
git commit -m "feat(app-services): KnowledgeIndexer scans vault markdown into KnowledgeStore"
```

---

## Task 3: IngestService — "Ingest now"에 knowledge 결합

세션 인덱싱 후 `KnowledgeIndexer.reindexAll`을 호출하고 결과에 `documents`를 더한다. knowledge는 선택 의존이라 미주입 시 `documents: 0`.

**Files:**
- Modify: `packages/app-services/src/ingest-service.ts`
- Test: `packages/app-services/src/ingest-service.test.ts`

- [ ] **Step 1: Update existing test assertions + add knowledge integration test**

`packages/app-services/src/ingest-service.test.ts`에서 기존 `toEqual` 단언을 `documents` 포함으로 갱신한다(4곳):

- `expect(result).toEqual({ sources: 1, sessions: 1 })` → `expect(result).toEqual({ sources: 1, sessions: 1, documents: 0 })`
- `await expect(first).resolves.toEqual({ sources: 1, sessions: 1 })` → `... toEqual({ sources: 1, sessions: 1, documents: 0 })`
- `await expect(second).resolves.toEqual({ sources: 0, sessions: 0 })` → `... toEqual({ sources: 0, sessions: 0, documents: 0 })`
- 마지막 테스트의 `.resolves.toEqual({ sources: 1, sessions: 1 })` → `... toEqual({ sources: 1, sessions: 1, documents: 0 })`

그다음 `describe('IngestService', ...)` 끝(마지막 `test` 뒤)에 신규 테스트 추가:

```ts
  test('runs knowledge reindex after sessions and returns document count', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
      turns: [{ role: 'user', text: 'design the ingest service', toolCalls: [] }], filesTouched: [] }
    let reindexCalls = 0
    const knowledge = { reindexAll: () => { reindexCalls++; return { documents: 3 } } }
    const svc = new IngestService({ registry, cursors, index, knowledge })
    const result = await svc.ingestAll([new FakeAdapter(session)])
    expect(reindexCalls).toBe(1)
    expect(result).toEqual({ sources: 1, sessions: 1, documents: 3 })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && npx vitest run packages/app-services/src/ingest-service.test.ts`
Expected: FAIL — 신규 테스트는 `knowledge` 속성이 타입에 없어 컴파일/실행 실패, 기존 갱신 단언은 `documents` 누락으로 mismatch.

- [ ] **Step 3: Update IngestService**

`packages/app-services/src/ingest-service.ts`를 수정한다.

import 블록 아래(타입 import 영역)에 추가:

```ts
import type { KnowledgeIndexer } from './knowledge-indexer.js'
```

`IngestDeps`/`IngestResult` 타입 교체:

```ts
export type IngestDeps = { registry: ProjectRegistry; cursors: IngestCursorStore; index: SearchIndex; knowledge?: Pick<KnowledgeIndexer, 'reindexAll'> }
export type IngestResult = { sources: number; sessions: number; documents: number }
```

`ingestAll`의 `try { ... return { sources, sessions } }` 부분에서 return 직전에 knowledge 재인덱싱을 추가하고 반환값을 확장한다. 기존:

```ts
      return { sources, sessions }
```

을 다음으로 교체:

```ts
      const { documents } = this.deps.knowledge?.reindexAll() ?? { documents: 0 }
      return { sources, sessions, documents }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && npx vitest run packages/app-services/src/ingest-service.test.ts`
Expected: PASS (기존 + 신규).

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard
git add packages/app-services/src/ingest-service.ts packages/app-services/src/ingest-service.test.ts
git commit -m "feat(app-services): IngestService runs knowledge reindex, returns documents count"
```

---

## Task 4: UnifiedSearch — knowledge hit 연결

`UnifiedSearch.deps`에 `knowledge?`/`projectIds?`를 추가하고, projectId를 순회해 `KnowledgeRetrieval.search` 결과를 정규화해 세션 hit 뒤에 append한다.

**Files:**
- Modify: `apps/desktop/package.json` (의존 추가)
- Modify: `apps/desktop/src/main/unified-search.ts`
- Test: `apps/desktop/src/main/unified-search.test.ts`

- [ ] **Step 1: Add `@apc/knowledge` dependency + install**

`apps/desktop/package.json`의 dependencies에서 `"@apc/harness": "workspace:*"` 가 있는 줄 끝에 `@apc/knowledge`를 추가:

```json
    "@apc/search": "workspace:*", "@apc/vault": "workspace:*", "@apc/llm-wiki": "workspace:*", "@apc/harness": "workspace:*", "@apc/knowledge": "workspace:*",
```

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && pnpm install`
Expected: 성공.

- [ ] **Step 2: Write the failing test**

`apps/desktop/src/main/unified-search.test.ts` 상단 import에 추가:

```ts
import { openDb, migrate } from '@apc/core'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval } from '@apc/knowledge'
```

파일 상단 `session` 헬퍼 아래에 knowledge 인덱스 빌더 헬퍼 추가:

```ts
function knowledgeFor(docs: { projectId: string; relPath: string; markdown: string; pathPrefix?: string; docType?: string }[]) {
  const db = openDb(':memory:'); migrate(db); migrateKnowledge(db)
  const store = new KnowledgeStore(db)
  for (const d of docs) {
    const collectionId = `project:${d.projectId}`
    store.upsertCollection({ id: collectionId, projectId: d.projectId, name: d.projectId, rootPath: `/v/${d.projectId}`, include: ['**/*.md'], exclude: [], includeByDefault: true })
    if (d.pathPrefix && d.docType) store.upsertContext({ collectionId, pathPrefix: d.pathPrefix, description: d.docType, docType: d.docType as never, statusHint: 'candidate' })
    store.indexMarkdownDoc({ collectionId, projectId: d.projectId, relPath: d.relPath, markdown: d.markdown, updatedAt: '2026-06-01T00:00:00Z' })
  }
  return new KnowledgeRetrieval(db)
}
```

`describe('UnifiedSearch', ...)` 안에 신규 테스트 추가:

```ts
  test('appends normalized knowledge hits using docType as kind', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'agent orchestration session']]))
    const knowledge = knowledgeFor([{ projectId: 'p1', relPath: 'wiki/notes.md', markdown: '# Notes\n\nagent orchestration wiki', pathPrefix: '/wiki', docType: 'wiki' }])
    const res = new UnifiedSearch({ sessions: idx, knowledge, projectIds: () => ['p1'] }).search({ query: 'orchestration' })
    const kinds = res.hits.map((h) => h.kind)
    expect(kinds).toContain('session')
    expect(kinds).toContain('wiki')
    const wikiHit = res.hits.find((h) => h.kind === 'wiki')!
    expect(wikiHit.projectId).toBe('p1')
    expect(wikiHit.title).toBe('Notes')
    expect(wikiHit.excerpt.length).toBeGreaterThan(0)
  })

  test('projectId filter limits knowledge to that project only', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    const knowledge = knowledgeFor([
      { projectId: 'p1', relPath: 'wiki/a.md', markdown: '# A\n\nshared keyword alpha' },
      { projectId: 'p2', relPath: 'wiki/b.md', markdown: '# B\n\nshared keyword beta' },
    ])
    const us = new UnifiedSearch({ sessions: idx, knowledge, projectIds: () => ['p1', 'p2'] })
    const res = us.search({ query: 'shared', projectId: 'p1' })
    expect(res.hits.every((h) => h.projectId === 'p1')).toBe(true)
    expect(res.hits.length).toBe(1)
  })

  test('no knowledge dep preserves session-only behavior', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'agent thing']]))
    const res = new UnifiedSearch({ sessions: idx }).search({ query: 'agent' })
    expect(res.hits).toHaveLength(1)
    expect(res.hits[0].kind).toBe('session')
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard/apps/desktop && npx vitest run src/main/unified-search.test.ts`
Expected: FAIL — `UnifiedSearch`가 `knowledge`/`projectIds` deps를 모르거나 knowledge hit을 만들지 않음.

- [ ] **Step 4: Update `UnifiedSearch`**

`apps/desktop/src/main/unified-search.ts` 전체를 다음으로 교체:

```ts
import type { SearchIndex } from '@apc/search'
import type { KnowledgeRetrieval } from '@apc/knowledge'
import type { UnifiedSearchResponse, UnifiedSearchHit } from '@apc/shared'

export class UnifiedSearch {
  constructor(
    private readonly deps: {
      sessions: SearchIndex
      knowledge?: KnowledgeRetrieval
      projectIds?: () => string[]
    },
  ) {}

  search(input: { query: string; projectId?: string }): UnifiedSearchResponse {
    const query = input.query.trim()
    if (!query) return { query, hits: [] }

    const sessionHits = this.deps.sessions.search(query, input.projectId ? { projectId: input.projectId } : {})
    const hits: UnifiedSearchHit[] = sessionHits.map((h) => ({
      kind: 'session',
      id: h.sessionId,
      title: h.sessionId,
      excerpt: h.snippet,
      projectId: h.projectId,
    }))

    if (this.deps.knowledge) {
      const projectIds = input.projectId ? [input.projectId] : (this.deps.projectIds?.() ?? [])
      for (const projectId of projectIds) {
        let knowledgeHits
        try {
          knowledgeHits = this.deps.knowledge.search({ projectId, query, limit: 10 })
        } catch {
          continue // FTS MATCH 파싱 에러 등 → 이 프로젝트만 건너뜀
        }
        for (const hit of knowledgeHits) {
          hits.push({
            kind: hit.doc.docType,
            id: hit.doc.id,
            title: hit.doc.title,
            excerpt: hit.chunk.body.slice(0, 200),
            projectId: hit.doc.projectId,
            score: hit.score,
          })
        }
      }
    }

    return { query, hits }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard/apps/desktop && npx vitest run src/main/unified-search.test.ts`
Expected: PASS (기존 2 + 신규 3).

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard
git add apps/desktop/package.json apps/desktop/src/main/unified-search.ts apps/desktop/src/main/unified-search.test.ts pnpm-lock.yaml
git commit -m "feat(desktop): UnifiedSearch returns knowledge hits (kind=docType) across projects"
```

---

## Task 5: 컨테이너 배선 + api 타입

메인 db에 `migrateKnowledge`하고 `KnowledgeStore`/`KnowledgeRetrieval`을 만들어 `IngestService`(인덱서)와 `UnifiedSearch`에 주입한다. renderer api 타입에 `documents`를 더한다.

**Files:**
- Modify: `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/renderer/api.ts`

- [ ] **Step 1: Wire knowledge into container**

`apps/desktop/src/main/container.ts` 수정.

(1) import: `@apc/core`에서 `migrate`는 이미 import됨. `@apc/app-services` import 줄에 `KnowledgeIndexer`를, 그리고 `@apc/knowledge` import을 추가한다. 파일 상단 import 영역에 추가:

```ts
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval } from '@apc/knowledge'
```

그리고 기존 `import { IngestService, RunService, GenerateService, HarnessService } from '@apc/app-services'` 줄을 다음으로 교체:

```ts
import { IngestService, RunService, GenerateService, HarnessService, KnowledgeIndexer } from '@apc/app-services'
```

(2) `migrate(db); migratePm(db); migrateHarness(db)` 가 호출되는 블록 바로 뒤에 추가:

```ts
  migrateKnowledge(db)
```

(3) `const unifiedSearch = new UnifiedSearch({ sessions: searchIndex })` 줄을 다음으로 교체:

```ts
  const knowledgeStore = new KnowledgeStore(db)
  const knowledgeRetrieval = new KnowledgeRetrieval(db)
  const unifiedSearch = new UnifiedSearch({
    sessions: searchIndex,
    knowledge: knowledgeRetrieval,
    projectIds: () => registry.list().map((p) => p.id),
  })
```

(4) `const ingest = new IngestService({ registry, cursors, index: searchIndex })` 줄을 다음으로 교체:

```ts
  const ingest = new IngestService({
    registry,
    cursors,
    index: searchIndex,
    knowledge: new KnowledgeIndexer({ registry, store: knowledgeStore, vaultRoot: opts.vaultRoot }),
  })
```

- [ ] **Step 2: Update renderer api type**

`apps/desktop/src/renderer/api.ts`의 `ingestAll`을 다음으로 교체:

```ts
  ingestAll(): Promise<{ sources: number; sessions: number; documents: number }> {
    return window.apc.invoke(CH.ingestAll) as Promise<{ sources: number; sessions: number; documents: number }>
  },
```

- [ ] **Step 3: Typecheck**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && pnpm typecheck`
Expected: clean (no errors).

- [ ] **Step 4: Run desktop + app-services + knowledge suites**

Run: `cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard && npx vitest run packages/knowledge packages/app-services && cd apps/desktop && npx vitest run`
Expected: 전부 PASS (기존 ipc.test 포함 — `migrateKnowledge`/배선은 가산적).

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Users/hskim/Desktop/ruahverce/ai_dashboard
git add apps/desktop/src/main/container.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(desktop): wire knowledge migrate/store/retrieval/indexer into container + UnifiedSearch"
```

---

## Verification (after all tasks)

- [ ] `pnpm typecheck` — clean
- [ ] `npx vitest run packages/knowledge packages/app-services packages/shared` — green
- [ ] `cd apps/desktop && npx vitest run` — green (unified-search 5 + 기존)
- [ ] 최종 코드리뷰 서브에이전트: end-to-end 체인(부팅 `migrateKnowledge` → "Ingest now" `ingestAll`→`reindexAll`→`indexMarkdownDoc` → 검색 `UnifiedSearch`→projectId 순회 `KnowledgeRetrieval`→정규화 append → 모달), 단일 타입(`IngestResult`/`UnifiedSearchHit`), 회귀 없음(세션 전용 경로·기존 단언 보존), 안전성(인덱싱 try/catch, FTS 에러 격리) 확인.

---

## Notes / YAGNI (spec §9)

증분 hash diff(전량 재인덱싱 유지), 문서 딥링크(프로젝트 전환만), 검색어 하이라이트(첫 200자 excerpt), `countMarkdownFiles`↔`listMarkdownFiles` DRY 통합(중복 허용), 점수 기반 인터리브(append 유지), 동일 relPath 충돌 네임스페이싱, UI `documents` 노출은 범위 밖.
