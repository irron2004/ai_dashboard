# 세션 → Task 자동 캡처 (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에이전트 세션에서 요청-Task(세션당 1개, LLM 요약 제목) + todo-Task(TodoWrite, 상태 매핑, 자식)를 멱등 추출해 기존 ingest 파이프라인에서 TaskStore에 기록한다.

**Architecture:** 순수 `TaskExtractor`가 `NormalizedSession`→Task를 만들고, `reconcileSessionTasks`가 TaskStore에 upsert + 사라진 todo 삭제. `IngestService`에 옵셔널 `onSessionParsed` 훅을 추가하고 desktop container가 그 훅에 추출+기록을 배선. 요청 제목은 주입된 `summarize`(LlmAgent)로, 실패 시 첫 user turn 폴백.

**Tech Stack:** TypeScript (pnpm monorepo) · zod · better-sqlite (pm) · vitest. LLM = `@apc/knowledge-harness` `LlmAgent` + `AgentRunner`.

## Global Constraints

- TS 들여쓰기 = **2-space** (기존 파일 관례).
- 세션/Task **ID 규약(verbatim)**: 요청-Task = `req:${projectId}:${sessionId}` · todo-Task = `todo:${projectId}:${sessionId}:${slug(content)}`. `slug` = `content.toLowerCase()` → 공백류 `\s+`를 `-`로 → `[^a-z0-9가-힣-]` 제거 → 앞뒤 `-` 트림 → 64자 cap.
- **상태 매핑(verbatim)**: todo `pending`→`'todo'` · `in_progress`→`'in_progress'` · `completed`→`'done'`. 요청-Task status = 자식 todo 중 `'todo'`/`'in_progress'`가 있으면 `'in_progress'`, 아니면 `'done'`(todos 없으면 `'done'`).
- 캡처 Task 공통: `assigneeType:'agent'`, `assignee = session.agentType`, `contextPackage = sessionId`, 나머지는 `TaskSchema` 기본값(priority `medium`, acceptanceCriteria `[]`, linkedWikiPages `[]`, reviewStatus `none`).
- `summarize` 실패(throw)·없음 → **첫 user turn(`role==='user' && text.trim()`) 텍스트를 80자 cap**으로 제목. ingest는 절대 실패시키지 않는다(per-session try/catch).
- 테스트: 레포 루트에서 `npx vitest run <파일경로>` (예: `npx vitest run packages/app-services/src/task-extractor.test.ts`). typecheck = 루트 `pnpm typecheck`.
- 타입 출처: `NormalizedSession`/`NormalizedTurn`/`NormalizedToolCall`·`Task`·`TaskStatus`·`AgentType`는 `@apc/shared`. `Task`는 `TaskSchema`(`packages/shared/src/schema.ts`)로 parse.

## 세션 타입 참고 (verbatim, `@apc/shared`)
- `NormalizedSession = { id: string; agentType: AgentKind; projectId?; repoPath?; turns: NormalizedTurn[]; filesTouched: string[]; … }`
- `NormalizedTurn = { role: 'user'|'assistant'|'system'|'tool'; text: string; toolCalls: NormalizedToolCall[]; … }`
- `NormalizedToolCall = { name: string; input?: unknown; … }` — Claude의 TodoWrite는 `{ name:'TodoWrite', input:{ todos:[{content,status}] } }`.

---

## File Structure
- `packages/pm/src/task-store.ts` — `delete(id)` 추가.
- `packages/app-services/src/task-extractor.ts` (NEW) — `mapTodoStatus` · `slug` · `extractTodos` · `extractTasks` · `reconcileSessionTasks`.
- `packages/app-services/src/session-summarizer.ts` (NEW) — `makeSessionSummarizer` (LlmAgent 기반 `summarize`).
- `packages/app-services/src/ingest-service.ts` — `IngestDeps.onSessionParsed?` 훅.
- `apps/desktop/src/main/container.ts` — 훅 배선.

---

### Task 1: TaskStore.delete

**Files:**
- Modify: `packages/pm/src/task-store.ts` (class `TaskStore`, `updateStatus` 아래)
- Test: `packages/pm/src/task-store.test.ts` (기존 파일에 추가)

**Interfaces:**
- Produces: `TaskStore.delete(id: string): void`.

- [ ] **Step 1: 실패하는 테스트 추가**

`packages/pm/src/task-store.test.ts`의 기존 `describe` 안에 추가(기존 테스트가 store/db를 만드는 패턴을 그대로 사용 — 같은 헬퍼로 `store.create({...})` 후 삭제):
```ts
  it('delete removes a task by id', () => {
    store.create({ id: 'T-del', projectId: 'p1', title: 'x', status: 'todo', assigneeType: 'agent', priority: 'medium', acceptanceCriteria: [], linkedWikiPages: [], reviewStatus: 'none' })
    expect(store.get('T-del')).toBeDefined()
    store.delete('T-del')
    expect(store.get('T-del')).toBeUndefined()
  })
```
(기존 테스트 상단의 `store` 변수명/생성 방식을 그대로 따른다. 만약 변수명이 다르면 그 이름을 쓴다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/pm/src/task-store.test.ts`
Expected: FAIL — `store.delete is not a function`.

- [ ] **Step 3: 구현**

`task-store.ts`의 `updateStatus(...)` 메서드 아래에 추가:
```ts
  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/pm/src/task-store.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/pm/src/task-store.ts packages/pm/src/task-store.test.ts
git commit -m "feat(pm): TaskStore.delete(id)"
```

---

### Task 2: task-extractor — extractTodos + extractTasks (순수)

**Files:**
- Create: `packages/app-services/src/task-extractor.ts`
- Test: `packages/app-services/src/task-extractor.test.ts`

**Interfaces:**
- Consumes: `NormalizedSession`, `Task`, `TaskStatus` (`@apc/shared`).
- Produces:
  - `mapTodoStatus(s: string): TaskStatus`
  - `slug(s: string): string`
  - `extractTodos(session: NormalizedSession): { content: string; status: TaskStatus }[]`
  - `extractTasks(session: NormalizedSession, projectId: string, opts: { summarize: (s: NormalizedSession) => Promise<string>; existingTitle?: string }): Promise<{ request: Task; todos: Task[] }>`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `packages/app-services/src/task-extractor.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import type { NormalizedSession } from '@apc/shared'
import { mapTodoStatus, slug, extractTodos, extractTasks } from './task-extractor.js'

function session(partial: Partial<NormalizedSession> = {}): NormalizedSession {
  return { id: 's1', agentType: 'claude', turns: [], filesTouched: [], sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, ...partial } as NormalizedSession
}
const todoCall = (todos: { content: string; status: string }[]) => ({ name: 'TodoWrite', input: { todos } })

describe('mapTodoStatus', () => {
  it('maps the three todo states', () => {
    expect(mapTodoStatus('pending')).toBe('todo')
    expect(mapTodoStatus('in_progress')).toBe('in_progress')
    expect(mapTodoStatus('completed')).toBe('done')
  })
})

describe('extractTodos', () => {
  it('uses the LAST TodoWrite call and maps status, skips empty content', () => {
    const s = session({ turns: [
      { role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'old', status: 'pending' }])] },
      { role: 'assistant', text: '', toolCalls: [todoCall([
        { content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }, { content: '', status: 'pending' },
      ])] },
    ] as NormalizedSession['turns'] })
    expect(extractTodos(s)).toEqual([
      { content: 'A', status: 'done' }, { content: 'B', status: 'in_progress' },
    ])
  })
  it('returns [] when no TodoWrite', () => {
    expect(extractTodos(session({ turns: [{ role: 'user', text: 'hi', toolCalls: [] }] as NormalizedSession['turns'] }))).toEqual([])
  })
})

describe('extractTasks', () => {
  const summarize = vi.fn(async () => 'LLM Title')
  it('builds request-task (id/title/assignee) and parented todo-tasks', async () => {
    const s = session({ turns: [
      { role: 'user', text: 'do the thing', toolCalls: [] },
      { role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'A', status: 'pending' }])] },
    ] as NormalizedSession['turns'] })
    const { request, todos } = await extractTasks(s, 'p1', { summarize })
    expect(request.id).toBe('req:p1:s1')
    expect(request.title).toBe('LLM Title')
    expect(request.assignee).toBe('claude')
    expect(request.contextPackage).toBe('s1')
    expect(todos[0].id).toBe('todo:p1:s1:a')
    expect(todos[0].parentTaskId).toBe('req:p1:s1')
    expect(todos[0].status).toBe('todo')
  })
  it('derives request status: in_progress if any open todo, else done', async () => {
    const open = session({ turns: [{ role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'A', status: 'pending' }])] }] as NormalizedSession['turns'] })
    const closed = session({ turns: [{ role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'A', status: 'completed' }])] }] as NormalizedSession['turns'] })
    expect((await extractTasks(open, 'p1', { summarize })).request.status).toBe('in_progress')
    expect((await extractTasks(closed, 'p1', { summarize })).request.status).toBe('done')
    expect((await extractTasks(session(), 'p1', { summarize })).request.status).toBe('done')
  })
  it('falls back to first user turn (80-cap) when summarize throws', async () => {
    const boom = vi.fn(async () => { throw new Error('llm down') })
    const s = session({ turns: [{ role: 'user', text: 'first request line', toolCalls: [] }] as NormalizedSession['turns'] })
    expect((await extractTasks(s, 'p1', { summarize: boom })).request.title).toBe('first request line')
  })
  it('skips summarize when existingTitle is provided', async () => {
    const spy = vi.fn(async () => 'NEW')
    const r = await extractTasks(session(), 'p1', { summarize: spy, existingTitle: 'KEEP' })
    expect(spy).not.toHaveBeenCalled()
    expect(r.request.title).toBe('KEEP')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/app-services/src/task-extractor.test.ts`
Expected: FAIL — `./task-extractor.js` 없음.

- [ ] **Step 3: 구현**

Create `packages/app-services/src/task-extractor.ts`:
```ts
import { TaskSchema, type NormalizedSession, type Task, type TaskStatus } from '@apc/shared'

export function mapTodoStatus(s: string): TaskStatus {
  if (s === 'in_progress') return 'in_progress'
  if (s === 'completed') return 'done'
  return 'todo'
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣-]/g, '').replace(/^-+|-+$/g, '').slice(0, 64)
}

type RawTodo = { content?: unknown; status?: unknown }

/** Latest TodoWrite tool call → normalized todo list (empty content dropped). */
export function extractTodos(session: NormalizedSession): { content: string; status: TaskStatus }[] {
  let latest: RawTodo[] | null = null
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      if (call.name !== 'TodoWrite') continue
      const todos = (call.input as { todos?: unknown } | undefined)?.todos
      if (Array.isArray(todos)) latest = todos as RawTodo[]
    }
  }
  if (!latest) return []
  const out: { content: string; status: TaskStatus }[] = []
  for (const t of latest) {
    const content = typeof t.content === 'string' ? t.content.trim() : ''
    if (!content) continue
    out.push({ content, status: mapTodoStatus(typeof t.status === 'string' ? t.status : 'pending') })
  }
  return out
}

function firstUserTitle(session: NormalizedSession): string {
  const u = session.turns.find((t) => t.role === 'user' && t.text.trim())
  return (u?.text.trim() ?? '(no request)').slice(0, 80)
}

export async function extractTasks(
  session: NormalizedSession,
  projectId: string,
  opts: { summarize: (s: NormalizedSession) => Promise<string>; existingTitle?: string },
): Promise<{ request: Task; todos: Task[] }> {
  const sid = session.id
  const agent = session.agentType
  const reqId = `req:${projectId}:${sid}`

  const todoData = extractTodos(session)
  const todos = todoData.map((t) =>
    TaskSchema.parse({
      id: `todo:${projectId}:${sid}:${slug(t.content)}`,
      projectId, title: t.content, status: t.status,
      assigneeType: 'agent', assignee: agent, parentTaskId: reqId, contextPackage: sid,
    }),
  )

  let title = opts.existingTitle
  if (!title) {
    try { title = await opts.summarize(session) } catch { title = firstUserTitle(session) }
  }
  if (!title || !title.trim()) title = firstUserTitle(session)

  const hasOpen = todos.some((t) => t.status === 'todo' || t.status === 'in_progress')
  const request = TaskSchema.parse({
    id: reqId, projectId, title: title.trim(), status: hasOpen ? 'in_progress' : 'done',
    assigneeType: 'agent', assignee: agent, contextPackage: sid,
  })
  return { request, todos }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/app-services/src/task-extractor.test.ts`
Expected: PASS (모든 케이스).

- [ ] **Step 5: 커밋**

```bash
git add packages/app-services/src/task-extractor.ts packages/app-services/src/task-extractor.test.ts
git commit -m "feat(app-services): session → request/todo Task extractor"
```

---

### Task 3: reconcileSessionTasks (upsert + stale 삭제)

**Files:**
- Modify: `packages/app-services/src/task-extractor.ts` (함수 추가)
- Test: `packages/app-services/src/task-extractor.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 2의 `extractTasks` 결과(`{ request, todos }`), `Task`.
- Produces: `reconcileSessionTasks(store, projectId, sessionId, request, todos): void`. `store` 구조적 타입 = `{ create(t: Task): void; listByProject(projectId: string): Task[]; delete(id: string): void }`.

- [ ] **Step 1: 실패하는 테스트 추가**

`task-extractor.test.ts`에 추가(파일 상단 import에 `reconcileSessionTasks`, `type Task` 추가):
```ts
import { reconcileSessionTasks } from './task-extractor.js'
import type { Task } from '@apc/shared'

describe('reconcileSessionTasks', () => {
  function fakeStore() {
    const map = new Map<string, Task>()
    return {
      map,
      create: (t: Task) => { map.set(t.id, t) },
      listByProject: (pid: string) => [...map.values()].filter((t) => t.projectId === pid),
      delete: (id: string) => { map.delete(id) },
    }
  }
  const mk = (id: string, extra: Partial<Task> = {}): Task => ({ id, projectId: 'p1', title: id, status: 'todo', assigneeType: 'agent', priority: 'medium', acceptanceCriteria: [], linkedWikiPages: [], reviewStatus: 'none', ...extra })

  it('upserts request + todos and deletes stale todos of the same session', () => {
    const store = fakeStore()
    // pre-existing: 3 todos for session s1
    store.create(mk('todo:p1:s1:a')); store.create(mk('todo:p1:s1:b')); store.create(mk('todo:p1:s1:c'))
    store.create(mk('todo:p1:s2:z')) // other session — must survive
    const request = mk('req:p1:s1', { parentTaskId: undefined })
    const todos = [mk('todo:p1:s1:a'), mk('todo:p1:s1:b')] // c dropped
    reconcileSessionTasks(store, 'p1', 's1', request, todos)
    const ids = store.listByProject('p1').map((t) => t.id).sort()
    expect(ids).toEqual(['req:p1:s1', 'todo:p1:s1:a', 'todo:p1:s1:b', 'todo:p1:s2:z'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/app-services/src/task-extractor.test.ts`
Expected: FAIL — `reconcileSessionTasks` export 없음.

- [ ] **Step 3: 구현**

`task-extractor.ts` 끝에 추가:
```ts
export type TaskSink = {
  create(t: Task): void
  listByProject(projectId: string): Task[]
  delete(id: string): void
}

/** Upsert the session's request + todos, then delete this session's prior todo-Tasks that vanished. */
export function reconcileSessionTasks(
  store: TaskSink, projectId: string, sessionId: string, request: Task, todos: Task[],
): void {
  store.create(request)
  for (const t of todos) store.create(t)
  const keep = new Set(todos.map((t) => t.id))
  const prefix = `todo:${projectId}:${sessionId}:`
  for (const existing of store.listByProject(projectId)) {
    if (existing.id.startsWith(prefix) && !keep.has(existing.id)) store.delete(existing.id)
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/app-services/src/task-extractor.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/app-services/src/task-extractor.ts packages/app-services/src/task-extractor.test.ts
git commit -m "feat(app-services): reconcileSessionTasks (upsert + prune stale todos)"
```

---

### Task 4: IngestService.onSessionParsed 훅

**Files:**
- Modify: `packages/app-services/src/ingest-service.ts` (IngestDeps + ingestAll 루프)
- Test: `packages/app-services/src/ingest-service.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `IngestDeps.onSessionParsed?: (session: NormalizedSession, projectId: string) => Promise<void>`. ingestAll이 파싱된 세션마다 (projectId 해소 후) try/catch로 호출.

- [ ] **Step 1: 실패하는 테스트 추가**

기존 `ingest-service.test.ts`는 클래스 `FakeAdapter`(생성자에 session, `discoverSources`/`parseSource`로 그 세션 1개 반환)와 `beforeEach`에서 만든 `registry`/`cursors`/`index`를 갖고, project `p1`을 `repoPaths:['/work/apc']`로 등록한다. 그 파일의 `describe` 안에 아래 2개 case를 추가(`vi`가 import돼 있지 않으면 import 추가):
```ts
  it('calls onSessionParsed for each parsed session with the resolved projectId', async () => {
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, turns: [], filesTouched: [] }
    const onSessionParsed = vi.fn(async () => {})
    const svc = new IngestService({ registry, cursors, index, onSessionParsed })
    await svc.ingestAll([new FakeAdapter(session)])
    expect(onSessionParsed).toHaveBeenCalledTimes(1)
    expect(onSessionParsed.mock.calls[0][1]).toBe('p1')   // resolved via repoPath /work/apc → p1
  })

  it('a throwing onSessionParsed does not break ingest', async () => {
    const session: NormalizedSession = { id: 's2', agentType: 'claude', repoPath: '/work/apc', sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, turns: [], filesTouched: [] }
    const onSessionParsed = vi.fn(async () => { throw new Error('extract boom') })
    const svc = new IngestService({ registry, cursors, index, onSessionParsed })
    await expect(svc.ingestAll([new FakeAdapter(session)])).resolves.toBeDefined()
  })
```
(`FakeAdapter`/`registry`/`cursors`/`index`는 기존 파일의 정의/픽스처를 그대로 사용; `NormalizedSession`은 이미 import됨.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/app-services/src/ingest-service.test.ts`
Expected: FAIL — `onSessionParsed`가 IngestDeps에 없어 타입/호출 에러 또는 미호출.

- [ ] **Step 3: 구현**

`ingest-service.ts`에서:
(a) import에 `NormalizedSession` 타입 추가:
```ts
import type { AgentIngestAdapter } from '@apc/agents'
import type { NormalizedSession } from '@apc/shared'
```
(b) `IngestDeps`에 옵셔널 훅 추가:
```ts
export type IngestDeps = { registry: ProjectRegistry; cursors: IngestCursorStore; index: SearchIndex; knowledge?: Pick<KnowledgeIndexer, 'reindexAll'>; onSessionParsed?: (session: NormalizedSession, projectId: string) => Promise<void> }
```
(c) ingestAll 루프에서 `this.deps.index.indexSession(withProject)` 다음, `this.deps.cursors.set(...)` 이전에 추가:
```ts
          if (this.deps.onSessionParsed) {
            try { await this.deps.onSessionParsed(withProject, withProject.projectId ?? '') }
            catch { /* task capture is best-effort; never break ingest */ }
          }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/app-services/src/ingest-service.test.ts`
Expected: PASS (신규 2개 + 기존).

- [ ] **Step 5: 커밋**

```bash
git add packages/app-services/src/ingest-service.ts packages/app-services/src/ingest-service.test.ts
git commit -m "feat(app-services): IngestService onSessionParsed hook (best-effort)"
```

---

### Task 5: session-summarizer (LlmAgent 기반 summarize)

**Files:**
- Create: `packages/app-services/src/session-summarizer.ts`
- Test: `packages/app-services/src/session-summarizer.test.ts`

**Interfaces:**
- Consumes: `LlmAgent`(`@apc/knowledge-harness`), `AgentRunner`(`@apc/llm-wiki`), `NormalizedSession`, `AgentType`.
- Produces: `makeSessionSummarizer(deps: { runner: AgentRunner; engine: AgentType; preamble?: string }): (session: NormalizedSession) => Promise<string>`. 세션 user turn 텍스트들을 한 줄 제목으로 요약(LlmAgent). throw 가능(호출자=extractTasks가 폴백).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `packages/app-services/src/session-summarizer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { AgentRunner } from '@apc/llm-wiki'
import type { NormalizedSession } from '@apc/shared'
import { makeSessionSummarizer } from './session-summarizer.js'

const fakeRunner = (output: string): AgentRunner => ({
  run: async () => ({ ok: true, output, raw: output, exitCode: 0 }),
}) as unknown as AgentRunner

function session(texts: string[]): NormalizedSession {
  return { id: 's1', agentType: 'claude', turns: texts.map((t) => ({ role: 'user', text: t, toolCalls: [] })), filesTouched: [], sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} } } as NormalizedSession
}

describe('makeSessionSummarizer', () => {
  it('returns the LLM title', async () => {
    const summarize = makeSessionSummarizer({ runner: fakeRunner('{"title":"Recommend stocks for today"}'), engine: 'claude' })
    expect(await summarize(session(['추천 종목 알려줘']))).toBe('Recommend stocks for today')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/app-services/src/session-summarizer.test.ts`
Expected: FAIL — `./session-summarizer.js` 없음.

- [ ] **Step 3: 구현**

Create `packages/app-services/src/session-summarizer.ts`:
```ts
import { z } from 'zod'
import { LlmAgent } from '@apc/knowledge-harness'
import type { AgentRunner } from '@apc/llm-wiki'
import type { AgentType, NormalizedSession } from '@apc/shared'

const TitleSchema = z.object({ title: z.string() })

const ROLE = [
  'You summarize an agent work session into a single concise task title (≤ 80 chars).',
  'The title should name what the user asked for, in their language. No quotes, no trailing period.',
].join(' ')

/** LLM-backed session → one-line title. Throws on runner/parse failure (caller falls back). */
export function makeSessionSummarizer(deps: { runner: AgentRunner; engine: AgentType; preamble?: string }): (session: NormalizedSession) => Promise<string> {
  const agent = new LlmAgent({ name: 'session-titler', role: ROLE, schema: TitleSchema, preamble: deps.preamble ?? '' })
  return async (session: NormalizedSession): Promise<string> => {
    const requests = session.turns.filter((t) => t.role === 'user' && t.text.trim()).map((t) => t.text.trim()).slice(0, 6)
    const out = await agent.run({ runner: deps.runner, engine: deps.engine, input: { requests }, label: 'session-titler' })
    return out.title.trim()
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run packages/app-services/src/session-summarizer.test.ts`
Expected: PASS.

> 만약 `LlmAgent`가 `@apc/knowledge-harness`의 index에서 export되지 않았다면(import 에러), STOP하고 reviewer/controller에 보고 — import 경로 확인 필요(대안: `@apc/knowledge-harness/dist/agents/llm-agent.js` 직접 경로). 임의로 다른 LLM 호출을 만들지 말 것.

- [ ] **Step 5: 커밋**

```bash
git add packages/app-services/src/session-summarizer.ts packages/app-services/src/session-summarizer.test.ts
git commit -m "feat(app-services): LlmAgent-backed session title summarizer"
```

---

### Task 6: container 배선

**Files:**
- Modify: `apps/desktop/src/main/container.ts` (IngestService deps에 onSessionParsed)

**Interfaces:**
- Consumes: Task 1 `tasks.delete`, Task 2 `extractTasks`, Task 3 `reconcileSessionTasks`, Task 5 `makeSessionSummarizer`. 기존 `tasks`(TaskStore, ~L154), `opts.agentRunner ?? new RoutingAgentRunner()`(~L179).

- [ ] **Step 1: import + onSessionParsed 배선**

먼저 **`packages/app-services/src/index.ts`에 export 2줄 추가**(현재 task-extractor/session-summarizer 미export 확인됨):
```ts
export * from './task-extractor.js'
export * from './session-summarizer.js'
```
그다음 `container.ts` 상단 import에 추가:
```ts
import { extractTasks, reconcileSessionTasks, makeSessionSummarizer } from '@apc/app-services'
```

`const ingest = new IngestService({ ... })` 생성부(~L170)를 찾아, deps 객체에 `onSessionParsed`를 추가한다. `tasks`(TaskStore)와 `runner`는 기존 변수를 쓴다(없으면 `opts.agentRunner ?? new RoutingAgentRunner()`):
```ts
  const summarize = makeSessionSummarizer({ runner: opts.agentRunner ?? new RoutingAgentRunner(), engine: 'claude' })
  const ingest = new IngestService({
    registry, cursors, index, knowledge,   // ← 기존 deps 그대로
    onSessionParsed: async (session, projectId) => {
      if (!projectId) return
      const existing = tasks.get(`req:${projectId}:${session.id}`)
      const { request, todos } = await extractTasks(session, projectId, { summarize, existingTitle: existing?.title })
      reconcileSessionTasks(tasks, projectId, session.id, request, todos)
    },
  })
```
(기존 `new IngestService({...})`의 실제 deps 키 이름을 그대로 유지하고 `onSessionParsed`만 추가. `tasks`/`registry`/`cursors`/`index`/`knowledge` 변수명은 파일 현행을 따른다.)

- [ ] **Step 2: typecheck**

Run (루트): `pnpm typecheck`
Expected: 0 errors. (extractTasks/reconcile/summarize 시그니처·`tasks` TaskSink 호환 확인.)

- [ ] **Step 3: 전체 테스트 green(회귀 없음)**

Run (루트): `pnpm test`
Expected: PASS — 신규 스위트(task-extractor, session-summarizer, ingest-service 추가분, task-store 추가분) + 기존 전부. 회귀 없음.

- [ ] **Step 4: 커밋**

```bash
git add apps/desktop/src/main/container.ts packages/app-services/src/index.ts
git commit -m "feat(desktop): wire session→Task capture into ingest pipeline"
```

---

## Self-Review (작성자 체크)

- **Spec coverage:** extractTodos/상태매핑=T2 · 요청-Task(LLM 제목·status 파생·폴백·existingTitle)=T2 · reconcile(stale 삭제)=T3 · TaskStore.delete=T1 · onSessionParsed 훅(best-effort)=T4 · LLM summarize=T5 · 기존 ingest 트리거 배선=T6. 비목표(SP2 wiki 링크·라이브·비-Claude todo)는 미포함.
- **Placeholder scan:** TBD/TODO 없음. 각 step에 실제 코드/명령/기대출력. T1·T4의 "기존 픽스처/변수명을 따른다"는 지역적·명확한 지시(해당 테스트 파일이 단일 패턴). T5·T6에 import-경로 불일치 시 STOP 가드 명시.
- **Type consistency:** ID 규약(`req:`/`todo:`)·상태매핑·`summarize: (s)=>Promise<string>`·`TaskSink{create,listByProject,delete}`가 T2/T3/T6에서 동일. `extractTasks`는 async(Promise) — T6에서 await. `NormalizedSession.id`/`.agentType`/`.turns` 필드명 일치.
