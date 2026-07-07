# 이어서(Resume) 컨텍스트 리콜 표면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 전환 시 상단 슬라이드-인 배너로 {지난번 요약·마지막 질문·다음 할 일 메모}를 능동 제시하고, 어디서든 note-to-self를 캡처하며, 연대순 질문 히스토리를 제공한다.

**Architecture:** 데이터는 대부분 재사용(최근 `req:` Task 제목 = 지난번 요약, 세션 파싱 = 마지막 질문, 기존 resume 배선). 신규는 초경량 스토어 둘(`next_notes`, `question_log`)뿐. 조립은 `@apc/dashboard-api`의 순수 함수 `buildResumeCard`(세션 파싱은 주입 dep로 격리), 표면은 renderer의 슬라이드-인 배너 + drill-down 패널.

**Tech Stack:** TypeScript, Electron, React, Zustand, `node:sqlite`(`DatabaseSync`), Zod, vitest.

## Global Constraints

- DB 엔진: `node:sqlite` `DatabaseSync`(`@apc/core`의 `Db`). 테스트는 `openDb(':memory:'); migrate(db); migratePm(db)`.
- 마이그레이션: `CREATE TABLE IF NOT EXISTS` + (컬럼 추가 시) `addColumnIfMissing` 멱등 패턴.
- 스키마 소스: `packages/shared/src/schema.ts`(Zod). **DB 컬럼 snake_case, TS 필드 camelCase.**
- `AgentType === AgentKind === z.enum(['claude','codex','opencode'])` — 동일 union.
- IPC 배선: invoke 기반 채널은 preload가 **generic `invoke`로 이미 커버** → **preload/index.ts 수정 불필요**. 이벤트 채널이 아니므로 `ipc-contract`→`renderer/api.ts`→`main/ipc.ts`→`container` 4곳만.
- 커밋 컨벤션: Conventional Commits, scope는 `pm`/`dashboard-api`/`desktop`/`agents`. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- ⚠️ **회귀 함정:** 루트 `pnpm test`는 `apps/**` 제외. **apps/desktop 변경은 `cd apps/desktop && npx vitest run`로 별도 실행.** packages 변경은 repo root에서 `npx vitest run <경로>`.
- ⚠️ **재클로버 함정:** `question_log`은 파생 로그라 세션ID 기준 DELETE-then-INSERT가 안전(사용자 소유 필드 없음). `next_notes`는 사용자 소유이므로 재생성 경로가 없어야 함(INSERT/UPDATE/DELETE만).
- 현재 브랜치: `feat/resume-recall-surface`(spec 커밋 `7aa67f1` 위). 모든 task는 이 브랜치에 순차 커밋.

---

### Task 1: NextNote 스키마 + NextNoteStore + 마이그레이션

**Files:**
- Modify: `packages/shared/src/schema.ts` (append `NextNoteSchema`/`NextNote`)
- Create: `packages/pm/src/next-note-store.ts`
- Modify: `packages/pm/src/migrate.ts` (add `next_notes` table)
- Modify: `packages/pm/src/index.ts` (export store)
- Test: `packages/pm/src/next-note-store.test.ts`

**Interfaces:**
- Produces: `NextNote = { id: string; projectId: string; text: string; createdAt: string; done: boolean }`; `class NextNoteStore { add(projectId, text, now?): NextNote; listByProject(projectId, opts?: {includeDone?: boolean}): NextNote[]; toggleDone(id, done): void; delete(id): void }`

- [ ] **Step 1: Write the failing test**

Create `packages/pm/src/next-note-store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { NextNoteStore } from './next-note-store.js'

describe('NextNoteStore', () => {
  let db: Db; let store: NextNoteStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new NextNoteStore(db) })

  test('add + listByProject: newest-first, excludes done, scoped by project', () => {
    store.add('p1', '7/10 상장 반영', '2026-07-07T10:00:00Z')
    store.add('p1', 'bear 2차 검증', '2026-07-07T11:00:00Z')
    store.add('p2', '다른 프로젝트', '2026-07-07T12:00:00Z')
    expect(store.listByProject('p1').map((n) => n.text)).toEqual(['bear 2차 검증', '7/10 상장 반영'])
    expect(store.listByProject('p2').map((n) => n.text)).toEqual(['다른 프로젝트'])
  })

  test('toggleDone hides from default list; includeDone shows it', () => {
    const a = store.add('p1', 'note', '2026-07-07T10:00:00Z')
    store.toggleDone(a.id, true)
    expect(store.listByProject('p1')).toHaveLength(0)
    expect(store.listByProject('p1', { includeDone: true })).toHaveLength(1)
  })

  test('delete removes the note', () => {
    const a = store.add('p1', 'note', '2026-07-07T10:00:00Z')
    store.delete(a.id)
    expect(store.listByProject('p1', { includeDone: true })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pm/src/next-note-store.test.ts`
Expected: FAIL — `Cannot find module './next-note-store.js'` (and `NextNoteStore` undefined).

- [ ] **Step 3: Add the schema**

Append to `packages/shared/src/schema.ts` (after the `Task` block, before `RunAgent`):

```ts
export const NextNoteSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string(),
  done: z.boolean().default(false),
})
export type NextNote = z.infer<typeof NextNoteSchema>
```

- [ ] **Step 4: Add the table to migratePm**

In `packages/pm/src/migrate.ts`, inside the `db.exec(\`...\`)` block (after the `reviews` table, before the `CREATE INDEX` lines), add:

```sql
    CREATE TABLE IF NOT EXISTS next_notes (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0
    );
```

And add to the index list (with the other `CREATE INDEX IF NOT EXISTS` lines):

```sql
    CREATE INDEX IF NOT EXISTS idx_next_notes_project ON next_notes(project_id);
```

- [ ] **Step 5: Create the store**

Create `packages/pm/src/next-note-store.ts`:

```ts
import { NextNoteSchema, type NextNote } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = { id: string; project_id: string; text: string; created_at: string; done: number }

function toNote(r: Row): NextNote {
  return NextNoteSchema.parse({
    id: r.id, projectId: r.project_id, text: r.text, createdAt: r.created_at, done: r.done === 1,
  })
}

/** Human "next-time" notes — deliberately separate from auto-extracted Tasks (no status/AC/priority). */
export class NextNoteStore {
  constructor(private readonly db: Db) {}

  add(projectId: string, text: string, now = new Date().toISOString()): NextNote {
    const id = `note:${projectId}:${now}:${Math.random().toString(36).slice(2, 8)}`
    const note = NextNoteSchema.parse({ id, projectId, text, createdAt: now, done: false })
    this.db.prepare(
      'INSERT INTO next_notes (id, project_id, text, created_at, done) VALUES (?, ?, ?, ?, ?)',
    ).run(note.id, note.projectId, note.text, note.createdAt, 0)
    return note
  }

  listByProject(projectId: string, opts: { includeDone?: boolean } = {}): NextNote[] {
    const rows = (opts.includeDone
      ? this.db.prepare('SELECT * FROM next_notes WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : this.db.prepare('SELECT * FROM next_notes WHERE project_id = ? AND done = 0 ORDER BY created_at DESC').all(projectId)) as Row[]
    return rows.map(toNote)
  }

  toggleDone(id: string, done: boolean): void {
    this.db.prepare('UPDATE next_notes SET done = ? WHERE id = ?').run(done ? 1 : 0, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM next_notes WHERE id = ?').run(id)
  }
}
```

- [ ] **Step 6: Export from pm index**

Append to `packages/pm/src/index.ts`:

```ts
export * from './next-note-store.js'
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run packages/pm/src/next-note-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add packages/shared/src/schema.ts packages/pm/src/next-note-store.ts packages/pm/src/migrate.ts packages/pm/src/index.ts packages/pm/src/next-note-store.test.ts
git commit -m "feat(pm): NextNoteStore — 초경량 note-to-self 스토어

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: QuestionLogEntry 스키마 + QuestionLogStore + 마이그레이션

**Files:**
- Modify: `packages/shared/src/schema.ts` (append `QuestionLogEntrySchema`/`QuestionLogEntry`)
- Create: `packages/pm/src/question-log-store.ts`
- Modify: `packages/pm/src/migrate.ts` (add `question_log` table + indexes)
- Modify: `packages/pm/src/index.ts` (export store)
- Test: `packages/pm/src/question-log-store.test.ts`

**Interfaces:**
- Consumes: `NormalizedSession` (`@apc/shared`) — `{ id, agentType, projectId?, startedAt?, endedAt?, turns: {role, text, timestamp?}[] }`.
- Produces: `QuestionLogEntry = { projectId: string; sessionId: string; ts: string; agent: AgentType; text: string }`; `class QuestionLogStore { record(session: NormalizedSession): void; listRecent(opts?: {projectId?: string; limit?: number}): QuestionLogEntry[] }`

- [ ] **Step 1: Write the failing test**

Create `packages/pm/src/question-log-store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import type { NormalizedSession } from '@apc/shared'
import { migratePm } from './migrate.js'
import { QuestionLogStore } from './question-log-store.js'

function session(over: Partial<NormalizedSession> = {}): NormalizedSession {
  return {
    id: 's1', agentType: 'claude', projectId: 'p1',
    sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
    turns: [
      { role: 'user', text: '첫 질문', timestamp: '2026-07-07T10:00:00Z', toolCalls: [] },
      { role: 'assistant', text: '답변', timestamp: '2026-07-07T10:00:05Z', toolCalls: [] },
      { role: 'user', text: '둘째 질문', timestamp: '2026-07-07T10:01:00Z', toolCalls: [] },
    ],
    filesTouched: [], ...over,
  }
}

describe('QuestionLogStore', () => {
  let db: Db; let store: QuestionLogStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new QuestionLogStore(db) })

  test('record stores only user turns, newest-first via listRecent', () => {
    store.record(session())
    const rows = store.listRecent({ projectId: 'p1' })
    expect(rows.map((r) => r.text)).toEqual(['둘째 질문', '첫 질문'])
    expect(rows[0]).toMatchObject({ sessionId: 's1', agent: 'claude', projectId: 'p1' })
  })

  test('record is idempotent per session (re-record → no duplicates)', () => {
    store.record(session())
    store.record(session())
    expect(store.listRecent({ projectId: 'p1' })).toHaveLength(2)
  })

  test('listRecent without projectId spans projects; limit caps rows', () => {
    store.record(session({ id: 's1', projectId: 'p1' }))
    store.record(session({ id: 's2', projectId: 'p2' }))
    expect(store.listRecent()).toHaveLength(4)
    expect(store.listRecent({ limit: 1 })).toHaveLength(1)
  })

  test('session without projectId records nothing', () => {
    store.record(session({ projectId: undefined }))
    expect(store.listRecent()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pm/src/question-log-store.test.ts`
Expected: FAIL — `Cannot find module './question-log-store.js'`.

- [ ] **Step 3: Add the schema**

Append to `packages/shared/src/schema.ts` (after `NextNote` block):

```ts
export const QuestionLogEntrySchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  ts: z.string(),
  agent: AgentKind,
  text: z.string(),
})
export type QuestionLogEntry = z.infer<typeof QuestionLogEntrySchema>
```

- [ ] **Step 4: Add the table to migratePm**

In `packages/pm/src/migrate.ts`, inside the `db.exec(\`...\`)` block (after `next_notes`), add:

```sql
    CREATE TABLE IF NOT EXISTS question_log (
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      ts         TEXT NOT NULL,
      agent      TEXT NOT NULL,
      text       TEXT NOT NULL
    );
```

And with the index lines:

```sql
    CREATE INDEX IF NOT EXISTS idx_qlog_project_ts ON question_log(project_id, ts);
    CREATE INDEX IF NOT EXISTS idx_qlog_session ON question_log(session_id);
```

- [ ] **Step 5: Create the store**

Create `packages/pm/src/question-log-store.ts`:

```ts
import type { Db } from '@apc/core'
import type { NormalizedSession, QuestionLogEntry } from '@apc/shared'

type Row = { session_id: string; project_id: string; ts: string; agent: string; text: string }

/** Chronological log of user prompts, derived at ingest. `turn_fts` (search-index) ranks but can't
 *  order by time, so this sidecar powers the "질문 히스토리" timeline. */
export class QuestionLogStore {
  constructor(private readonly db: Db) {}

  /** Idempotent per session: DELETE this session's rows then re-insert its user turns. Mirrors
   *  SearchIndex.indexSession — safe to re-run on every re-ingest (derived data, no user-owned fields). */
  record(session: NormalizedSession): void {
    this.db.prepare('DELETE FROM question_log WHERE session_id = ?').run(session.id)
    const projectId = session.projectId ?? ''
    if (!projectId) return
    const ins = this.db.prepare(
      'INSERT INTO question_log (session_id, project_id, ts, agent, text) VALUES (?, ?, ?, ?, ?)',
    )
    for (const t of session.turns) {
      if (t.role !== 'user' || !t.text.trim()) continue
      const ts = t.timestamp ?? session.startedAt ?? session.endedAt ?? ''
      ins.run(session.id, projectId, ts, session.agentType, t.text)
    }
  }

  listRecent(opts: { projectId?: string; limit?: number } = {}): QuestionLogEntry[] {
    const limit = opts.limit ?? 50
    const rows = (opts.projectId
      ? this.db.prepare('SELECT * FROM question_log WHERE project_id = ? ORDER BY ts DESC LIMIT ?').all(opts.projectId, limit)
      : this.db.prepare('SELECT * FROM question_log ORDER BY ts DESC LIMIT ?').all(limit)) as Row[]
    return rows.map((r) => ({
      projectId: r.project_id, sessionId: r.session_id, ts: r.ts,
      agent: r.agent as QuestionLogEntry['agent'], text: r.text,
    }))
  }
}
```

- [ ] **Step 6: Export from pm index**

Append to `packages/pm/src/index.ts`:

```ts
export * from './question-log-store.js'
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run packages/pm/src/question-log-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add packages/shared/src/schema.ts packages/pm/src/question-log-store.ts packages/pm/src/migrate.ts packages/pm/src/index.ts packages/pm/src/question-log-store.test.ts
git commit -m "feat(pm): QuestionLogStore — 연대순 질문 로그(멱등 재기록)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ingest → question_log 배선

**Files:**
- Modify: `packages/app-services/src/ingest-service.ts` (add optional `questionLog` dep + call after `indexSession`)
- Modify: `apps/desktop/src/main/container.ts` (instantiate `QuestionLogStore`, pass into `IngestService`)
- Test: `packages/app-services/src/ingest-service.test.ts` (add a case)

**Interfaces:**
- Consumes: `QuestionLogStore` (Task 2) — needs only `record(session)`.
- Produces: `IngestDeps.questionLog?: { record(session: NormalizedSession): void }`.

- [ ] **Step 1: Write the failing test**

Add to `packages/app-services/src/ingest-service.test.ts` (inside the existing top-level `describe`; reuse the file's existing imports/fakes — if a fake registry/index/cursors helper exists, mirror it; otherwise this self-contained case works):

```ts
  test('records user questions to the question log after indexing', async () => {
    const recorded: string[] = []
    const session: NormalizedSession = {
      id: 's-q', agentType: 'claude', repoPath: '/work/apc',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
      turns: [{ role: 'user', text: 'hello?', toolCalls: [] }], filesTouched: [],
    }
    const adapter = {
      discoverSources: async () => [{ id: 'src1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x.jsonl' }],
      parseSource: async () => ({ session, position: 'pos1' }),
    } as unknown as AgentIngestAdapter
    const svc = new IngestService({
      registry: { findByRepoPath: () => ({ id: 'p1' }) } as never,
      cursors: { get: () => undefined, set: () => {} } as never,
      index: { indexSession: () => {} } as never,
      questionLog: { record: (s: NormalizedSession) => { recorded.push(s.id) } },
    })
    await svc.ingestAll([adapter])
    expect(recorded).toEqual(['s-q'])
  })
```

If `AgentIngestAdapter`/`NormalizedSession`/`IngestService` are not yet imported in the test file, add:
`import type { AgentIngestAdapter } from '@apc/agents'` and ensure `NormalizedSession`, `IngestService` are imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app-services/src/ingest-service.test.ts`
Expected: FAIL — `questionLog` not a known dep / `recorded` empty (property ignored).

- [ ] **Step 3: Add the dep to IngestDeps**

In `packages/app-services/src/ingest-service.ts`, extend `IngestDeps`:

```ts
export type IngestDeps = { registry: ProjectRegistry; cursors: IngestCursorStore; index: SearchIndex; knowledge?: Pick<KnowledgeIndexer, 'reindexAll'>; onSessionParsed?: (session: NormalizedSession, projectId: string) => Promise<void>; questionLog?: { record(session: NormalizedSession): void } }
```

- [ ] **Step 4: Call it after indexSession**

In the `for (const source of found)` loop, immediately after `this.deps.index.indexSession(withProject)`, add:

```ts
          try { this.deps.questionLog?.record(withProject) }
          catch (e) { console.warn(`[ingest] questionLog.record failed for session ${withProject.id} (project ${withProject.projectId ?? '?'}):`, e) }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/app-services/src/ingest-service.test.ts`
Expected: PASS (including the new case; existing cases unchanged).

- [ ] **Step 6: Wire the container**

In `apps/desktop/src/main/container.ts`:
1. Add `QuestionLogStore` to the `@apc/pm` import (line 3): `import { migratePm, TaskStore, AgentRunStore, ReviewService, VaultWriter, validateBlockedBy, NextNoteStore, QuestionLogStore } from '@apc/pm'` (NextNoteStore is used in Task 5 — importing now is harmless).
2. After `const tasks = new TaskStore(db)` (line ~185), add:

```ts
  const nextNotes = new NextNoteStore(db)
  const questionLog = new QuestionLogStore(db)
```

3. In the `new IngestService({ ... })` deps object, add `questionLog,` (alongside `index: searchIndex,`).

- [ ] **Step 7: Typecheck + run desktop tests + commit**

Run: `pnpm typecheck`
Expected: no errors.

Run: `cd apps/desktop && npx vitest run && cd ../..`
Expected: PASS — in particular the `c:ingestAll` ipc test does not regress/timeout (handoff trap).

```bash
git add packages/app-services/src/ingest-service.ts packages/app-services/src/ingest-service.test.ts apps/desktop/src/main/container.ts
git commit -m "feat(desktop): ingest가 세션 user turn을 question_log에 기록

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: latestSessionDetail(agents) + buildResumeCard(dashboard-api)

**Files:**
- Create: `packages/agents/src/latest-session.ts`
- Modify: `packages/agents/src/index.ts` (export)
- Create: `packages/dashboard-api/src/resume-card.ts`
- Modify: `packages/dashboard-api/src/index.ts` (export)
- Test: `packages/agents/src/latest-session.test.ts`, `packages/dashboard-api/src/resume-card.test.ts`

**Interfaces:**
- Consumes: `NextNoteStore.listByProject`, `TaskStore.listByProject`, `ProjectRegistry.get`, `adapterFor`/`findLatestSession` patterns.
- Produces:
  - `latestSessionDetail(agents: AgentKind[], repoPath: string): Promise<{ agent: AgentKind; session: NormalizedSession } | null>`
  - `ResumeCard = { project: Project; lastSummary: string | null; lastQuestion: { text: string; ts: string; agent: AgentType } | null; nextNotes: NextNote[]; resumeTarget: { agent: AgentType; sessionId: string } | null; hasHistory: boolean }`
  - `type ResumeLatestSession = (repoPath: string) => Promise<{ agent: AgentType; sessionId: string; lastUserTurn?: { text: string; ts: string } } | null>`
  - `type ResumeDeps = { registry: Pick<ProjectRegistry,'get'>; tasks: Pick<TaskStore,'listByProject'>; nextNotes: Pick<NextNoteStore,'listByProject'>; latestSession: ResumeLatestSession }`
  - `buildResumeCard(deps: ResumeDeps, projectId: string): Promise<ResumeCard | null>`

- [ ] **Step 1: Write the failing test for latestSessionDetail**

Create `packages/agents/src/latest-session.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { NormalizedSession } from '@apc/shared'
import type { AgentIngestAdapter } from './types.js'
import { pickLatestSession } from './latest-session.js'

function sess(id: string, repoPath: string, endedAt: string): NormalizedSession {
  return {
    id, agentType: 'claude', repoPath, endedAt,
    sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
    turns: [{ role: 'user', text: `q-${id}`, timestamp: endedAt, toolCalls: [] }], filesTouched: [],
  }
}
function adapter(sessions: NormalizedSession[]): AgentIngestAdapter {
  return {
    discoverSources: async () => sessions.map((s, i) => ({ id: `src${i}`, agentKind: 'claude', kind: 'jsonl-file', locator: `/x${i}.jsonl`, repoPath: s.repoPath, mtimeMs: Date.parse(s.endedAt!) })),
    parseSource: async (src) => ({ session: sessions.find((s) => s.repoPath === src.repoPath && Date.parse(s.endedAt!) === src.mtimeMs)!, position: 'p' }),
  } as unknown as AgentIngestAdapter
}

describe('pickLatestSession', () => {
  test('returns the newest repoPath-matching session across adapters', async () => {
    const a = adapter([sess('old', '/work/apc', '2026-07-01T00:00:00Z'), sess('new', '/work/apc', '2026-07-07T00:00:00Z')])
    const b = adapter([sess('other', '/work/other', '2026-07-08T00:00:00Z')])
    const got = await pickLatestSession([{ agent: 'claude', adapter: a }, { agent: 'codex', adapter: b }], '/work/apc')
    expect(got?.session.id).toBe('new')
    expect(got?.agent).toBe('claude')
  })

  test('returns null when no session matches repoPath', async () => {
    const a = adapter([sess('x', '/work/other', '2026-07-07T00:00:00Z')])
    expect(await pickLatestSession([{ agent: 'claude', adapter: a }], '/work/apc')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/agents/src/latest-session.test.ts`
Expected: FAIL — `Cannot find module './latest-session.js'`.

- [ ] **Step 3: Implement latest-session.ts**

Create `packages/agents/src/latest-session.ts`:

```ts
import type { AgentKind, NormalizedSession } from '@apc/shared'
import type { AgentIngestAdapter } from './types.js'
import { adapterFor } from './resume.js'

const _t = (s?: string) => (s ? Date.parse(s) : 0)

type Candidate = { agent: AgentKind; adapter: AgentIngestAdapter }

/** Pick the newest repoPath-matching session across the given (agent, adapter) pairs, returning the
 *  FULL parsed session (turns included). Sources are tried mtime-desc so the newest file usually wins
 *  after parsing a single candidate. */
export async function pickLatestSession(
  candidates: Candidate[],
  repoPath: string,
): Promise<{ agent: AgentKind; session: NormalizedSession } | null> {
  let best: { agent: AgentKind; session: NormalizedSession; rank: number } | null = null
  for (const { agent, adapter } of candidates) {
    const sources = (await adapter.discoverSources(() => undefined))
      .filter((s) => !s.repoPath || s.repoPath === repoPath)
      .sort((x, y) => (y.mtimeMs ?? 0) - (x.mtimeMs ?? 0))
    for (const source of sources) {
      const { session } = await adapter.parseSource(source)
      if (session.repoPath !== repoPath) continue
      const rank = Math.max(_t(session.endedAt), _t(session.startedAt), source.mtimeMs ?? 0)
      if (!best || rank > best.rank) best = { agent, session, rank }
      break // sources are mtime-desc; the first repoPath match for this adapter is its newest
    }
  }
  return best ? { agent: best.agent, session: best.session } : null
}

/** Convenience wrapper over the real CLI adapters (container uses this). */
export function latestSessionDetail(agents: AgentKind[], repoPath: string) {
  return pickLatestSession(agents.map((agent) => ({ agent, adapter: adapterFor(agent) })), repoPath)
}
```

- [ ] **Step 4: Export + run test to verify it passes**

Append to `packages/agents/src/index.ts`:

```ts
export * from './latest-session.js'
```

Run: `npx vitest run packages/agents/src/latest-session.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for buildResumeCard**

Create `packages/dashboard-api/src/resume-card.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { Project, Task, NextNote } from '@apc/shared'
import { buildResumeCard, type ResumeDeps } from './resume-card.js'

const project = { id: 'p1', name: 'coin', repoPaths: ['/work/coin'] } as unknown as Project
function task(id: string, title: string): Task {
  return { id, projectId: 'p1', title, status: 'in_progress', assigneeType: 'agent', priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] }
}
function note(text: string): NextNote { return { id: `note:${text}`, projectId: 'p1', text, createdAt: '2026-07-07T00:00:00Z', done: false } }

function deps(over: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    registry: { get: () => project },
    tasks: { listByProject: () => [task('req:p1:s1', '지난번 요약')] },
    nextNotes: { listByProject: () => [note('7/10 상장 반영')] },
    latestSession: async () => ({ agent: 'claude', sessionId: 's1', lastUserTurn: { text: 'MA20 회복 조건?', ts: '2026-07-07T10:00:00Z' } }),
    ...over,
  }
}

describe('buildResumeCard', () => {
  test('assembles summary, last question, notes, resume target; hasHistory=true', async () => {
    const card = await buildResumeCard(deps(), 'p1')
    expect(card).toMatchObject({
      lastSummary: '지난번 요약',
      lastQuestion: { text: 'MA20 회복 조건?', agent: 'claude' },
      resumeTarget: { agent: 'claude', sessionId: 's1' },
      hasHistory: true,
    })
    expect(card?.nextNotes.map((n) => n.text)).toEqual(['7/10 상장 반영'])
  })

  test('empty project (no session, no notes, no req task) → hasHistory=false', async () => {
    const card = await buildResumeCard(deps({
      tasks: { listByProject: () => [] },
      nextNotes: { listByProject: () => [] },
      latestSession: async () => null,
    }), 'p1')
    expect(card).toMatchObject({ lastSummary: null, lastQuestion: null, resumeTarget: null, hasHistory: false })
  })

  test('notes-only project still surfaces (hasHistory=true)', async () => {
    const card = await buildResumeCard(deps({
      tasks: { listByProject: () => [] },
      latestSession: async () => null,
    }), 'p1')
    expect(card?.hasHistory).toBe(true)
    expect(card?.lastQuestion).toBeNull()
  })

  test('unknown project → null', async () => {
    const card = await buildResumeCard(deps({ registry: { get: () => undefined } }), 'nope')
    expect(card).toBeNull()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run packages/dashboard-api/src/resume-card.test.ts`
Expected: FAIL — `Cannot find module './resume-card.js'`.

- [ ] **Step 7: Implement resume-card.ts**

Create `packages/dashboard-api/src/resume-card.ts`:

```ts
import type { AgentType, NextNote, Project, Task } from '@apc/shared'
import type { ProjectRegistry, TaskStore, NextNoteStore } from './deps-types.js'

export type ResumeLatestSession = (
  repoPath: string,
) => Promise<{ agent: AgentType; sessionId: string; lastUserTurn?: { text: string; ts: string } } | null>

export type ResumeDeps = {
  registry: { get: (id: string) => Project | undefined }
  tasks: { listByProject: (projectId: string) => Task[] }
  nextNotes: { listByProject: (projectId: string, opts?: { includeDone?: boolean }) => NextNote[] }
  latestSession: ResumeLatestSession
}

export type ResumeCard = {
  project: Project
  lastSummary: string | null
  lastQuestion: { text: string; ts: string; agent: AgentType } | null
  nextNotes: NextNote[]
  resumeTarget: { agent: AgentType; sessionId: string } | null
  hasHistory: boolean
}

/** Most recent `req:` task title for the project = the "지난번 요약" (SP1 already summarized it — no
 *  re-LLM on switch). `req:` ids sort lexicographically by their sessionId suffix; we take the last. */
function lastRequestSummary(tasks: Task[]): string | null {
  const reqs = tasks.filter((t) => t.id.startsWith('req:')).sort((a, b) => a.id.localeCompare(b.id))
  return reqs.length ? reqs[reqs.length - 1].title : null
}

export async function buildResumeCard(deps: ResumeDeps, projectId: string): Promise<ResumeCard | null> {
  const project = deps.registry.get(projectId)
  if (!project) return null
  const tasks = deps.tasks.listByProject(projectId)
  const nextNotes = deps.nextNotes.listByProject(projectId)
  const repoPath = project.repoPaths[0]
  const latest = repoPath ? await deps.latestSession(repoPath).catch(() => null) : null
  const lastSummary = lastRequestSummary(tasks)
  const lastQuestion = latest?.lastUserTurn
    ? { text: latest.lastUserTurn.text, ts: latest.lastUserTurn.ts, agent: latest.agent }
    : null
  const resumeTarget = latest ? { agent: latest.agent, sessionId: latest.sessionId } : null
  const hasHistory = Boolean(lastSummary || lastQuestion || nextNotes.length || resumeTarget)
  return { project, lastSummary, lastQuestion, nextNotes, resumeTarget, hasHistory }
}
```

Create `packages/dashboard-api/src/deps-types.ts` (re-exports the concrete store types so resume-card imports don't pull `@apc/core`/`@apc/pm` value code — mirror how `project-dashboard.ts` types its deps; if `project-dashboard.ts` already imports these from `@apc/pm`, import from there instead and skip this file):

```ts
export type { ProjectRegistry } from '@apc/core'
export type { TaskStore, NextNoteStore } from '@apc/pm'
```

> NOTE for implementer: check `packages/dashboard-api/src/project-dashboard.ts` line 5 (`DashboardDeps`) for how it already imports `ProjectRegistry`/`TaskStore`. Reuse that exact import style; the `deps-types.ts` file is only a fallback if a direct type import isn't already the established pattern.

- [ ] **Step 8: Export + run test to verify it passes**

Append to `packages/dashboard-api/src/index.ts`:

```ts
export * from './resume-card.js'
```

Run: `npx vitest run packages/dashboard-api/src/resume-card.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add packages/agents/src/latest-session.ts packages/agents/src/latest-session.test.ts packages/agents/src/index.ts packages/dashboard-api/src/resume-card.ts packages/dashboard-api/src/resume-card.test.ts packages/dashboard-api/src/index.ts packages/dashboard-api/src/deps-types.ts
git commit -m "feat(dashboard-api): buildResumeCard + latestSessionDetail 조립기

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: IPC surface (resumeCard·questionLog·nextNote CRUD)

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (CH keys + req/res types)
- Modify: `apps/desktop/src/renderer/api.ts` (renderer call fns)
- Modify: `apps/desktop/src/main/ipc.ts` (handlers)
- Modify: `apps/desktop/src/main/container.ts` (Container iface + impl: `resumeCard`, `questionLog`, `nextNoteAdd/Toggle/Delete`)
- Test: `apps/desktop/src/main/ipc.test.ts` (or the existing ipc test file — add cases)

**Interfaces:**
- Consumes: `buildResumeCard` (Task 4), `latestSessionDetail` (Task 4), `NextNoteStore`/`QuestionLogStore` (Tasks 1–2, wired in container Task 3).
- Produces (renderer `api`): `api.resumeCard({projectId}): Promise<ResumeCard | null>`, `api.questionLog({projectId?, limit?}): Promise<QuestionLogEntry[]>`, `api.nextNoteAdd({projectId, text}): Promise<{ok:boolean; note?:NextNote}>`, `api.nextNoteToggle({id, done}): Promise<{ok:boolean}>`, `api.nextNoteDelete({id}): Promise<{ok:boolean}>`.

- [ ] **Step 1: Add CH keys + types to ipc-contract**

In `apps/desktop/src/shared/ipc-contract.ts`, add to the `CH` object (near `taskSetBlockedBy`):

```ts
  resumeCard: 'q:resumeCard',
  questionLog: 'q:questionLog',
  nextNoteAdd: 'c:nextNoteAdd',
  nextNoteToggle: 'c:nextNoteToggle',
  nextNoteDelete: 'c:nextNoteDelete',
```

Add to the imports at top (extend the `@apc/shared` import): `NextNote, QuestionLogEntry`. Add these type exports near the other req/res types:

```ts
export type ResumeCardReq = { projectId: string }
export type QuestionLogReq = { projectId?: string; limit?: number }
export type NextNoteAddReq = { projectId: string; text: string }
export type NextNoteAddRes = { ok: boolean; note?: NextNote }
export type NextNoteToggleReq = { id: string; done: boolean }
export type NextNoteDeleteReq = { id: string }
export type NextNoteMutRes = { ok: boolean }
```

> `ResumeCard` and `QuestionLogEntry` are the response types — `ResumeCard` is exported from `@apc/dashboard-api`, `QuestionLogEntry` from `@apc/shared`. Renderer imports them from there (see Step 2), so no duplicate definition here.

- [ ] **Step 2: Add renderer api fns**

In `apps/desktop/src/renderer/api.ts`, add (near `taskSetBlockedBy`). Ensure imports: `import type { ResumeCard } from '@apc/dashboard-api'` and extend the `@apc/shared` type import with `NextNote, QuestionLogEntry`, and the ipc-contract import with the new req/res types:

```ts
  resumeCard(projectId: string): Promise<ResumeCard | null> {
    return window.apc.invoke(CH.resumeCard, { projectId }) as Promise<ResumeCard | null>
  },
  questionLog(req: { projectId?: string; limit?: number } = {}): Promise<QuestionLogEntry[]> {
    return window.apc.invoke(CH.questionLog, req) as Promise<QuestionLogEntry[]>
  },
  nextNoteAdd(req: NextNoteAddReq): Promise<NextNoteAddRes> {
    return window.apc.invoke(CH.nextNoteAdd, req) as Promise<NextNoteAddRes>
  },
  nextNoteToggle(req: NextNoteToggleReq): Promise<NextNoteMutRes> {
    return window.apc.invoke(CH.nextNoteToggle, req) as Promise<NextNoteMutRes>
  },
  nextNoteDelete(req: NextNoteDeleteReq): Promise<NextNoteMutRes> {
    return window.apc.invoke(CH.nextNoteDelete, req) as Promise<NextNoteMutRes>
  },
```

- [ ] **Step 3: Add Container iface + impl**

In `apps/desktop/src/main/container.ts`:

1. Extend imports: `@apc/dashboard-api` import → add `buildResumeCard, type ResumeCard`; `@apc/agents` import → add `latestSessionDetail` (find the existing `@apc/agents` import line; if none imports values, add `import { latestSessionDetail } from '@apc/agents'`). Also import types for the Container iface from ipc-contract: `ResumeCardReq, QuestionLogReq, NextNoteAddReq, NextNoteAddRes, NextNoteToggleReq, NextNoteDeleteReq, NextNoteMutRes` and `import type { QuestionLogEntry } from '@apc/shared'`.

2. Add to the `Container` interface (near `workspaceOverview`):

```ts
  resumeCard: (req: ResumeCardReq) => Promise<ResumeCard | null>
  questionLog: (req: QuestionLogReq) => QuestionLogEntry[]
  nextNoteAdd: (req: NextNoteAddReq) => NextNoteAddRes
  nextNoteToggle: (req: NextNoteToggleReq) => NextNoteMutRes
  nextNoteDelete: (req: NextNoteDeleteReq) => NextNoteMutRes
```

3. Add to the returned container object (near `workspaceOverview: () => buildWorkspaceOverview(...)`):

```ts
    resumeCard: (req) => buildResumeCard({
      registry, tasks, nextNotes,
      latestSession: async (repoPath) => {
        const found = await latestSessionDetail(['claude', 'codex', 'opencode'], repoPath)
        if (!found) return null
        const lastUser = [...found.session.turns].reverse().find((t) => t.role === 'user' && t.text.trim())
        return {
          agent: found.agent,
          sessionId: found.session.id,
          lastUserTurn: lastUser ? { text: lastUser.text, ts: lastUser.timestamp ?? found.session.startedAt ?? '' } : undefined,
        }
      },
    }, req.projectId),
    questionLog: (req) => questionLog.listRecent(req),
    nextNoteAdd: (req) => ({ ok: true, note: nextNotes.add(req.projectId, req.text) }),
    nextNoteToggle: (req) => { nextNotes.toggleDone(req.id, req.done); return { ok: true } },
    nextNoteDelete: (req) => { nextNotes.delete(req.id); return { ok: true } },
```

- [ ] **Step 4: Add ipc.ts handlers**

In `apps/desktop/src/main/ipc.ts` (near `[CH.workspaceOverview]`), add. Ensure the new req types are imported from `../shared/ipc-contract.js`:

```ts
    [CH.resumeCard]: async (payload: unknown) => {
      return container.resumeCard(payload as ResumeCardReq)
    },
    [CH.questionLog]: async (payload: unknown) => {
      return container.questionLog(payload as QuestionLogReq)
    },
    [CH.nextNoteAdd]: async (payload: unknown) => {
      return container.nextNoteAdd(payload as NextNoteAddReq)
    },
    [CH.nextNoteToggle]: async (payload: unknown) => {
      return container.nextNoteToggle(payload as NextNoteToggleReq)
    },
    [CH.nextNoteDelete]: async (payload: unknown) => {
      return container.nextNoteDelete(payload as NextNoteDeleteReq)
    },
```

- [ ] **Step 5: Write an integration test**

Add to the desktop ipc/container test (locate the existing test that builds a real `Container` against an in-memory DB — mirror its setup). Add:

```ts
  test('nextNote add → resumeCard surfaces it; questionLog after ingest', async () => {
    // register a project 'p1' via the container's registry (mirror existing test's project setup)
    const add = container.nextNoteAdd({ projectId: 'p1', text: '7/10 상장 반영' })
    expect(add.ok).toBe(true)
    const card = await container.resumeCard({ projectId: 'p1' })
    expect(card?.nextNotes.map((n) => n.text)).toContain('7/10 상장 반영')
    expect(card?.hasHistory).toBe(true)
  })
```

> If no container-level integration test file exists, add a minimal one that constructs the container the same way the app does (see `createContainer` usage) with `openDb(':memory:')`, registering one project whose `repoPaths[0]` points at a temp dir with no sessions (so `latestSession` returns null but the note still makes `hasHistory` true).

- [ ] **Step 6: Typecheck + run desktop tests**

Run: `pnpm typecheck`
Expected: no errors.

Run: `cd apps/desktop && npx vitest run && cd ../..`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/container.ts apps/desktop/src/main/*.test.ts
git commit -m "feat(desktop): resumeCard·questionLog·nextNote IPC 표면

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: ResumeBanner + ⌘⇧N 캡처

**Files:**
- Modify: `apps/desktop/src/renderer/store.ts` (state + actions)
- Create: `apps/desktop/src/renderer/components/ResumeBanner.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (render banner + trigger on project switch + ⌘⇧N)
- Modify: `apps/desktop/src/renderer/app.css` (banner styles)
- Test: `apps/desktop/src/renderer/components/ResumeBanner.test.tsx`

**Interfaces:**
- Consumes: `api.resumeCard`, `api.nextNoteAdd` (Task 5); `ResumeCard` (`@apc/dashboard-api`).
- Produces (store): `resumeCard: ResumeCard | null`, `resumeBannerOpen: boolean`, actions `loadResumeCard(projectId)`, `openResumeBanner()`, `dismissResumeBanner()`, `addNextNote(text)`.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/components/ResumeBanner.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ResumeCard } from '@apc/dashboard-api'
import { ResumeBanner } from './ResumeBanner.js'

const card: ResumeCard = {
  project: { id: 'p1', name: 'coin', repoPaths: ['/w'] } as never,
  lastSummary: 'capex를 bear 카드로 정리',
  lastQuestion: { text: 'MA20 회복 조건?', ts: '2026-07-07T10:00:00Z', agent: 'claude' },
  nextNotes: [{ id: 'n1', projectId: 'p1', text: '7/10 상장 반영', createdAt: '2026-07-07T00:00:00Z', done: false }],
  resumeTarget: { agent: 'claude', sessionId: 's1' },
  hasHistory: true,
}

describe('ResumeBanner', () => {
  test('renders summary, question, and note when open', () => {
    render(<ResumeBanner card={card} onDismiss={() => {}} onResume={() => {}} onOpenHistory={() => {}} onAddNote={() => {}} />)
    expect(screen.getByText(/capex를 bear 카드로 정리/)).toBeTruthy()
    expect(screen.getByText(/MA20 회복 조건/)).toBeTruthy()
    expect(screen.getByText(/7\/10 상장 반영/)).toBeTruthy()
  })

  test('resume button fires onResume with the resume target', () => {
    const onResume = vi.fn()
    render(<ResumeBanner card={card} onDismiss={() => {}} onResume={onResume} onOpenHistory={() => {}} onAddNote={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /이어서 대화/ }))
    expect(onResume).toHaveBeenCalledWith({ agent: 'claude', sessionId: 's1' })
  })

  test('adding a note fires onAddNote with the typed text', async () => {
    const onAddNote = vi.fn()
    render(<ResumeBanner card={card} onDismiss={() => {}} onResume={() => {}} onOpenHistory={() => {}} onAddNote={onAddNote} />)
    fireEvent.change(screen.getByPlaceholderText(/다음 할 일/), { target: { value: 'bear 2차 검증' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/다음 할 일/), { key: 'Enter' })
    await waitFor(() => expect(onAddNote).toHaveBeenCalledWith('bear 2차 검증'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/components/ResumeBanner.test.tsx; cd ../..`
Expected: FAIL — `Cannot find module './ResumeBanner.js'`.

- [ ] **Step 3: Implement ResumeBanner.tsx**

Create `apps/desktop/src/renderer/components/ResumeBanner.tsx`:

```tsx
import { useState } from 'react'
import type { ResumeCard } from '@apc/dashboard-api'
import type { AgentType } from '@apc/shared'

type Props = {
  card: ResumeCard
  onDismiss: () => void
  onResume: (target: { agent: AgentType; sessionId: string }) => void
  onOpenHistory: () => void
  onAddNote: (text: string) => void
}

export function ResumeBanner({ card, onDismiss, onResume, onOpenHistory, onAddNote }: Props) {
  const [draft, setDraft] = useState('')
  const submit = () => { const t = draft.trim(); if (t) { onAddNote(t); setDraft('') } }
  return (
    <div className="resume-banner" role="dialog" aria-label={`${card.project.name} 이어서`}>
      <div className="resume-banner__head">
        <span className="resume-banner__title">▶ {card.project.name} — 이어서</span>
        <button type="button" className="resume-banner__close" aria-label="닫기" onClick={onDismiss}>✕</button>
      </div>
      {card.lastSummary && <div className="resume-banner__row">지난번: {card.lastSummary}</div>}
      {card.lastQuestion && (
        <div className="resume-banner__row">마지막 Q <span className="resume-banner__agent">{card.lastQuestion.agent}</span>: “{card.lastQuestion.text}”</div>
      )}
      {card.nextNotes.length > 0 && (
        <ul className="resume-banner__notes">
          {card.nextNotes.map((n) => <li key={n.id}>📌 {n.text}</li>)}
        </ul>
      )}
      <div className="resume-banner__addnote">
        <input
          aria-label="다음 할 일 추가"
          placeholder="📌 다음 할 일…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        />
      </div>
      <div className="resume-banner__actions">
        {card.resumeTarget && (
          <button type="button" onClick={() => onResume(card.resumeTarget!)}>이어서 대화</button>
        )}
        <button type="button" onClick={onOpenHistory}>질문 히스토리</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/renderer/components/ResumeBanner.test.tsx; cd ../..`
Expected: PASS (3 tests).

- [ ] **Step 5: Add store state + actions**

In `apps/desktop/src/renderer/store.ts`:
1. Extend imports: `import type { ResumeCard } from '@apc/dashboard-api'` (add to the existing `@apc/dashboard-api` import).
2. Add to the `ApcStore` type (near `workspaceOverview`):

```ts
  resumeCard: ResumeCard | null
  resumeBannerOpen: boolean
  loadResumeCard: (projectId: string) => Promise<void>
  openResumeBanner: () => void
  dismissResumeBanner: () => void
  addNextNote: (text: string) => Promise<void>
```

3. In the store creator, add initial state `resumeCard: null, resumeBannerOpen: false,` and actions:

```ts
  loadResumeCard: async (projectId) => {
    const card = await api.resumeCard(projectId)
    set({ resumeCard: card, resumeBannerOpen: Boolean(card?.hasHistory) })
  },
  openResumeBanner: () => set({ resumeBannerOpen: true }),
  dismissResumeBanner: () => set({ resumeBannerOpen: false }),
  addNextNote: async (text) => {
    const pid = get().selectedProjectId
    if (!pid) return
    const res = await api.nextNoteAdd({ projectId: pid, text })
    if (res.ok && res.note) {
      const card = get().resumeCard
      if (card && card.project.id === pid) set({ resumeCard: { ...card, nextNotes: [res.note, ...card.nextNotes], hasHistory: true } })
    }
  },
```

> Confirm the store creator signature exposes `get` (zustand `(set, get) => ({...})`); if it currently is `(set) => (...)`, change to `(set, get) => (...)`.

- [ ] **Step 6: Wire App.tsx — render + trigger + ⌘⇧N**

In `apps/desktop/src/renderer/App.tsx`:
1. Import: `import { ResumeBanner } from './components/ResumeBanner.js'`.
2. Pull from store: `resumeCard`, `resumeBannerOpen`, `loadResumeCard`, `openResumeBanner`, `dismissResumeBanner`, `addNextNote`.
3. Add a trigger effect (fires only when the selected project actually changes):

```tsx
  const prevProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedProjectId) return
    if (prevProjectRef.current === selectedProjectId) return
    prevProjectRef.current = selectedProjectId
    void loadResumeCard(selectedProjectId)
  }, [selectedProjectId, loadResumeCard])
```

4. Add `⌘⇧N` to the existing keyboard effect group (new effect):

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyN') {
        e.preventDefault(); if (selectedProjectId) openResumeBanner()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedProjectId, openResumeBanner])
```

5. Render the banner (top of the returned JSX, inside `.app-layout`, before `<aside>` — it is position:fixed so DOM order only affects stacking):

```tsx
      {resumeBannerOpen && resumeCard && (
        <ResumeBanner
          card={resumeCard}
          onDismiss={dismissResumeBanner}
          onResume={(t) => {
            dismissResumeBanner()
            toggleDock(false)
            setAgent(t.agent)
            restartAgent(`${selectedProjectId}:${t.agent}`)
          }}
          onOpenHistory={() => { dismissResumeBanner(); handleMainTab('workspace') }}
          onAddNote={(text) => void addNextNote(text)}
        />
      )}
```

> `onOpenHistory` temporarily routes to the 전체 tab; Task 7 replaces it with the dedicated QuestionHistory panel. `restartAgent`/`toggleDock`/`setAgent` already exist in App.tsx.

- [ ] **Step 7: Add banner CSS**

Append to `apps/desktop/src/renderer/app.css`:

```css
.resume-banner {
  position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
  z-index: 200; width: min(560px, 92vw);
  background: #1b1b1b; border: 1px solid #3a5a3a; border-radius: 8px;
  padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  animation: resume-slide-in 180ms ease-out;
}
@keyframes resume-slide-in { from { transform: translate(-50%, -12px); opacity: 0 } to { transform: translate(-50%, 0); opacity: 1 } }
.resume-banner__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.resume-banner__title { font-weight: 600; color: #cfe8cf; }
.resume-banner__close { background: none; border: none; color: #999; cursor: pointer; }
.resume-banner__row { font-size: 0.82rem; color: #ddd; margin: 3px 0; }
.resume-banner__agent { font-size: 0.7rem; opacity: 0.7; }
.resume-banner__notes { margin: 4px 0; padding-left: 4px; list-style: none; font-size: 0.82rem; color: #e8d9a0; }
.resume-banner__addnote input { width: 100%; margin: 6px 0; padding: 4px 6px; background: #111; border: 1px solid #333; border-radius: 4px; color: #eee; }
.resume-banner__actions { display: flex; gap: 8px; }
.resume-banner__actions button { background: #2a4a2a; border: 1px solid #4a8a4a; color: #dfe; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
```

- [ ] **Step 8: Typecheck + run desktop tests + commit**

Run: `pnpm typecheck`
Expected: no errors.

Run: `cd apps/desktop && npx vitest run && cd ../..`
Expected: PASS.

```bash
git add apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/components/ResumeBanner.tsx apps/desktop/src/renderer/components/ResumeBanner.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): 전환 시 이어서 배너 + ⌘⇧N note 캡처

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: QuestionHistory 패널 + WorkspaceHome nextNote 통합

**Files:**
- Create: `apps/desktop/src/renderer/components/QuestionHistory.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (host the panel; wire banner `onOpenHistory` to it)
- Modify: `packages/dashboard-api/src/workspace-overview.ts` (add `topNote` to `ProjectOverview`)
- Modify: `packages/dashboard-api/src/workspace-overview.test.ts` (assert topNote)
- Modify: `apps/desktop/src/renderer/components/WorkspaceHome.tsx` (render topNote)
- Modify: `apps/desktop/src/main/container.ts` (pass `nextNotes` into `buildWorkspaceOverview`)
- Test: `apps/desktop/src/renderer/components/QuestionHistory.test.tsx`, `apps/desktop/src/renderer/components/WorkspaceHome.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.questionLog` (Task 5); `NextNoteStore.listByProject` (Task 1); `QuestionLogEntry` (`@apc/shared`).
- Produces: `ProjectOverview.topNote?: string` (newest open note text, or undefined).

- [ ] **Step 1: Write the failing test for QuestionHistory**

Create `apps/desktop/src/renderer/components/QuestionHistory.test.tsx`:

```tsx
import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { QuestionLogEntry } from '@apc/shared'
import { QuestionHistory } from './QuestionHistory.js'

const rows: QuestionLogEntry[] = [
  { projectId: 'p1', sessionId: 's2', ts: '2026-07-07T14:20:00Z', agent: 'claude', text: 'capex 어떻게 읽지?' },
  { projectId: 'p2', sessionId: 's1', ts: '2026-07-07T11:05:00Z', agent: 'codex', text: '이 커리큘럼 순서 맞아?' },
]

describe('QuestionHistory', () => {
  test('lists fetched questions newest-first', async () => {
    const fetchLog = vi.fn(async () => rows)
    render(<QuestionHistory open scope={null} fetchLog={fetchLog} onClose={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(screen.getByText(/capex 어떻게 읽지/)).toBeTruthy())
    expect(screen.getByText(/이 커리큘럼 순서 맞아/)).toBeTruthy()
    expect(fetchLog).toHaveBeenCalledWith({})
  })

  test('scope filters by project', async () => {
    const fetchLog = vi.fn(async () => [rows[0]])
    render(<QuestionHistory open scope="p1" fetchLog={fetchLog} onClose={() => {}} onPick={() => {}} />)
    await waitFor(() => expect(fetchLog).toHaveBeenCalledWith({ projectId: 'p1' }))
  })

  test('clicking a row fires onPick', async () => {
    const onPick = vi.fn()
    render(<QuestionHistory open scope={null} fetchLog={async () => rows} onClose={() => {}} onPick={onPick} />)
    await waitFor(() => screen.getByText(/capex 어떻게 읽지/))
    fireEvent.click(screen.getByText(/capex 어떻게 읽지/))
    expect(onPick).toHaveBeenCalledWith(rows[0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/components/QuestionHistory.test.tsx; cd ../..`
Expected: FAIL — `Cannot find module './QuestionHistory.js'`.

- [ ] **Step 3: Implement QuestionHistory.tsx**

Create `apps/desktop/src/renderer/components/QuestionHistory.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { QuestionLogEntry } from '@apc/shared'

type Props = {
  open: boolean
  scope: string | null // projectId, or null for all projects
  fetchLog: (req: { projectId?: string; limit?: number }) => Promise<QuestionLogEntry[]>
  onClose: () => void
  onPick: (entry: QuestionLogEntry) => void
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function QuestionHistory({ open, scope, fetchLog, onClose, onPick }: Props) {
  const [rows, setRows] = useState<QuestionLogEntry[]>([])
  useEffect(() => {
    if (!open) return
    let alive = true
    void fetchLog(scope ? { projectId: scope } : {}).then((r) => { if (alive) setRows(r) })
    return () => { alive = false }
  }, [open, scope, fetchLog])

  if (!open) return null
  return (
    <div className="add-project-overlay" onClick={onClose}>
      <div className="add-project-dialog question-history" onClick={(e) => e.stopPropagation()}>
        <h2>질문 히스토리{scope ? ' (이 프로젝트)' : ' (전체)'}</h2>
        {rows.length === 0 ? <p className="question-history__empty">기록 없음</p> : (
          <ul className="question-history__list">
            {rows.map((r) => (
              <li key={`${r.sessionId}:${r.ts}:${r.text.slice(0, 12)}`}>
                <button type="button" onClick={() => onPick(r)}>
                  <span className="question-history__when">{hhmm(r.ts)}</span>
                  <span className="question-history__agent">[{r.agent}]</span>
                  <span className="question-history__text">{r.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="add-project-dialog__actions"><button type="button" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/renderer/components/QuestionHistory.test.tsx; cd ../..`
Expected: PASS (3 tests).

- [ ] **Step 5: Host QuestionHistory in App.tsx**

In `apps/desktop/src/renderer/App.tsx`:
1. Import: `import { QuestionHistory } from './components/QuestionHistory.js'`.
2. Add state: `const [historyScope, setHistoryScope] = useState<{ open: boolean; scope: string | null }>({ open: false, scope: null })`.
3. Change the banner's `onOpenHistory` to: `onOpenHistory={() => { dismissResumeBanner(); setHistoryScope({ open: true, scope: selectedProjectId }) }}`.
4. Render near `<SearchModal ...>`:

```tsx
      <QuestionHistory
        open={historyScope.open}
        scope={historyScope.scope}
        fetchLog={(req) => api.questionLog(req)}
        onClose={() => setHistoryScope((s) => ({ ...s, open: false }))}
        onPick={(entry) => {
          setHistoryScope((s) => ({ ...s, open: false }))
          void selectProject(entry.projectId)
        }}
      />
```

- [ ] **Step 6: Extend workspace-overview with topNote (failing test first)**

Add to `packages/dashboard-api/src/workspace-overview.test.ts` (mirror the existing fake deps; add a `nextNotes` fake):

```ts
  test('includes the newest open note text as topNote', () => {
    const overview = buildWorkspaceOverview({
      registry: { list: () => [{ id: 'p1', name: 'coin' } as never] },
      tasks: { listByProject: () => [] },
      runs: { listRunning: () => [] },
      nextNotes: { listByProject: () => [{ id: 'n1', projectId: 'p1', text: '7/10 상장 반영', createdAt: '2026-07-07T00:00:00Z', done: false }] },
    } as never)
    expect(overview.projects[0].topNote).toBe('7/10 상장 반영')
  })
```

Run: `npx vitest run packages/dashboard-api/src/workspace-overview.test.ts`
Expected: FAIL — `topNote` undefined / `nextNotes` not read.

- [ ] **Step 7: Implement topNote**

In `packages/dashboard-api/src/workspace-overview.ts`:
1. Extend `DashboardDeps` usage: `buildWorkspaceOverview` receives `deps` — widen its param type to also accept `nextNotes`. Add to the type (in `project-dashboard.ts` `DashboardDeps` or inline): `nextNotes?: { listByProject: (projectId: string, opts?: { includeDone?: boolean }) => { text: string }[] }`.
2. Add `topNote?: string` to `ProjectOverview`.
3. In the `.map`, compute: `const topNote = deps.nextNotes?.listByProject(project.id)[0]?.text` and add `topNote` to the returned object.

```ts
export type ProjectOverview = {
  project: Project
  activeTaskCount: number
  runningRuns: AgentRun[]
  reviewQueueCount: number
  nextUp: Task[]
  topNote?: string   // newest open note-to-self, if any
}
```

Run: `npx vitest run packages/dashboard-api/src/workspace-overview.test.ts`
Expected: PASS.

- [ ] **Step 8: Pass nextNotes into buildWorkspaceOverview (container)**

In `apps/desktop/src/main/container.ts`, change:

```ts
    workspaceOverview: () => buildWorkspaceOverview({ registry, tasks, runs, nextNotes }),
```

- [ ] **Step 9: Render topNote in WorkspaceHome (test first)**

Add to `apps/desktop/src/renderer/components/WorkspaceHome.test.tsx` (mirror its existing overview fixture; set `topNote` on a project):

```tsx
  test('renders a project topNote when present', () => {
    const overview = { generatedAt: '', projects: [{
      project: { id: 'p1', name: 'coin', domain: 'prediction' }, activeTaskCount: 0, runningRuns: [], reviewQueueCount: 0, nextUp: [], topNote: '7/10 상장 반영',
    }] } as never
    render(<WorkspaceHome overview={overview} onRefresh={() => {}} onOpenProject={() => {}} />)
    expect(screen.getByText(/7\/10 상장 반영/)).toBeTruthy()
  })
```

Run: `cd apps/desktop && npx vitest run src/renderer/components/WorkspaceHome.test.tsx; cd ../..`
Expected: FAIL — text not found.

- [ ] **Step 10: Render topNote in WorkspaceHome.tsx**

In `apps/desktop/src/renderer/components/WorkspaceHome.tsx`, inside each `workspace-card`, after the badges block, add:

```tsx
              {p.topNote && <div className="workspace-card__note">📌 {p.topNote}</div>}
```

Run: `cd apps/desktop && npx vitest run src/renderer/components/WorkspaceHome.test.tsx; cd ../..`
Expected: PASS.

- [ ] **Step 11: Typecheck + full test sweep + commit**

Run: `pnpm typecheck`
Expected: no errors.

Run: `npx vitest run` (repo root — packages) then `cd apps/desktop && npx vitest run && cd ../..`
Expected: both PASS.

```bash
git add packages/dashboard-api/src/workspace-overview.ts packages/dashboard-api/src/workspace-overview.test.ts apps/desktop/src/renderer/components/QuestionHistory.tsx apps/desktop/src/renderer/components/QuestionHistory.test.tsx apps/desktop/src/renderer/components/WorkspaceHome.tsx apps/desktop/src/renderer/components/WorkspaceHome.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/main/container.ts
git commit -m "feat(desktop): 질문 히스토리 패널 + 전체 탭 note 노출

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 슬라이드-인 배너(전환 트리거·억제·비모달) → Task 6. ✓
- 지난번 요약(req: 재활용)·마지막 질문(세션 파싱)·resume 타깃 → Task 4(조립) + Task 6(렌더/resume). ✓
- 📌 다음 할 일 캡처(⌘⇧N·인라인) → Task 1(스토어) + Task 5(IPC) + Task 6(UI). ✓
- 연대순 질문 히스토리(프로젝트별/전체) → Task 2(스토어) + Task 3(적재) + Task 5(IPC) + Task 7(패널). ✓
- 🌐 전체 탭 note 노출 → Task 7. ✓
- 빈 히스토리 억제(hasHistory) → Task 4(계산) + Task 6(`resumeBannerOpen` 게이트). ✓
- 재클로버/멱등 가드 → Task 2(DELETE-then-insert) + 회귀 스윕(Task 3·5·7). ✓
- 알려진 한계(ssh lastQuestion null degrade) → `buildResumeCard`의 `latestSession(...).catch(() => null)` + `repoPath` 가드. ✓

**2. Placeholder scan:** 모든 코드 스텝에 실제 코드 포함, "TBD/적절히 처리" 없음. Task 5 Step 5의 "기존 테스트 셋업 미러" 지시는 실행자가 참조할 구체 파일(`createContainer`/`openDb(':memory:')`)을 명시함. ✓

**3. Type consistency:**
- `ResumeCard`/`ResumeDeps`/`ResumeLatestSession` — Task 4 정의, Task 5·6에서 동일 필드(`resumeTarget.{agent,sessionId}`, `lastQuestion.{text,ts,agent}`, `hasHistory`) 사용. ✓
- `NextNote.{id,projectId,text,createdAt,done}` — Task 1 정의, Task 4·5·6·7 일관. ✓
- `QuestionLogEntry.{projectId,sessionId,ts,agent,text}` — Task 2 정의, Task 5·7 일관. ✓
- `NextNoteStore` 메서드명 `add/listByProject/toggleDone/delete` — Task 1↔5 일치. ✓
- `pickLatestSession`(테스트용, candidates 주입) vs `latestSessionDetail`(container용, adapterFor 래핑) — Task 4에서 둘 다 정의, Task 5는 `latestSessionDetail` 사용. ✓
- `AgentType===AgentKind` — 스토어/스키마 혼용 안전. ✓

수정 필요 없음.

---

## 실행 시 주의 (요약)
- packages 변경: repo root `npx vitest run <경로>`. **apps/desktop 변경: `cd apps/desktop && npx vitest run`.**
- 권위 타입검사: `pnpm typecheck`(IDE 진단 오경보 무시).
- 배너 트리거는 `selectedProjectId` 실제 전환에만(prevRef 가드) — 재렌더·초기 마운트 중복발화 금지.
