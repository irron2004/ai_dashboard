# 작업↔위키 그래프 뷰 (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캡처된 요청-Task를 wiki 그래프 위 `task` 노드로 띄우고, 세션이 편집한 위키 파일에 work→wiki 엣지를 그려 KnowledgeView의 `'work'` 소스로 본다.

**Architecture:** SP1 캡처에 `linkedWikiPages = session.filesTouched`를 추가하고, 순수 `buildWorkGraphData`가 task 노드 + suffix-match된 wiki 노드 + 엣지를 만든다. 새 `tasksList` IPC로 프로젝트 Task를 가져와 KnowledgeView가 `'work'` 소스로 렌더한다.

**Tech Stack:** TypeScript pnpm monorepo · graph-view(순수) · Electron IPC · React(KnowledgeView) · vitest.

## Parallelization (개발 병렬화)
- **T1, T2, T3는 파일-디스조인트 → 병렬 실행 가능** (T1 app-services, T2 graph-view, T3 desktop ipc/api). 워크트리 격리로 동시 진행.
- **T4(KnowledgeView)는 T2+T3 완료 후** 순차 (buildWorkGraphData + api.tasksList 소비).

## Global Constraints
- TS 2-space.
- 엣지 = wiki `relPath`가 task의 touched 경로 중 하나의 **suffix**(경계 `/`/`\` 또는 완전일치)일 때만. basename-only 매칭 금지.
- 노드 = 요청-Task만(`type:'task'`, color `#f59e0b`); 매칭 0인 task도 isolated 노드 포함. wiki 노드는 매칭된 것만, dedup.
- 테스트는 레포 루트에서 `npx vitest run <path>`; typecheck = `pnpm typecheck`.
- 타입: `GraphNode/GraphLink/GraphData`(`@apc/graph-view` graph-types), `Task`(`@apc/shared`), `NormalizedSession.filesTouched: string[]`.

---

### Task 1 (PARALLEL): extractTasks — linkedWikiPages

**Files:**
- Modify: `packages/app-services/src/task-extractor.ts` (요청-Task 생성부, `extractTasks`)
- Test: `packages/app-services/src/task-extractor.test.ts` (1 케이스 추가)

**Interfaces:**
- Produces: 요청-Task의 `linkedWikiPages === session.filesTouched`.

- [ ] **Step 1: 실패 테스트 추가** — 기존 `describe('extractTasks', …)` 안에:
```ts
  it('sets request linkedWikiPages to session.filesTouched', async () => {
    const s = session({ filesTouched: ['/abs/proj/vault/a.md', '/abs/proj/src/x.py'],
      turns: [{ role: 'user', text: 'do', toolCalls: [] }] as NormalizedSession['turns'] })
    const { request } = await extractTasks(s, 'p1', { summarize })
    expect(request.linkedWikiPages).toEqual(['/abs/proj/vault/a.md', '/abs/proj/src/x.py'])
  })
```
(기존 `session()` 헬퍼는 `filesTouched: []` 기본 — 위처럼 override. `summarize`는 기존 describe의 mock.)

- [ ] **Step 2: 실패 확인** — `npx vitest run packages/app-services/src/task-extractor.test.ts` → FAIL (`linkedWikiPages` 빈 배열).

- [ ] **Step 3: 구현** — `extractTasks`의 `const request = TaskSchema.parse({ ... })`에서 `id: reqId,` 줄들 사이에 추가:
```ts
    linkedWikiPages: session.filesTouched,
```
(요청-Task의 `TaskSchema.parse({...})` 객체에만. todo-Task는 불변.)

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS (전체 task-extractor 스위트).

- [ ] **Step 5: 커밋** — `git add packages/app-services/src/task-extractor.ts packages/app-services/src/task-extractor.test.ts && git commit -m "feat(app-services): request-Task linkedWikiPages = session.filesTouched"`

---

### Task 2 (PARALLEL): buildWorkGraphData (graph-view)

**Files:**
- Modify: `packages/graph-view/src/build-graph.ts` (함수 추가), `packages/graph-view/src/index.ts` (export)
- Test: `packages/graph-view/src/build-graph.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: 기존 `addNode`/`addLink`/`colorForNode`/`entityColor`, 로컬 `WikiNodeInput`, `GraphNode`/`GraphLink`/`GraphData`.
- Produces: `buildWorkGraphData(tasks: WorkTaskInput[], wikiNodes: WikiNodeInput[]): GraphData`; `WorkTaskInput = { id; title; status; linkedWikiPages: string[]; data?: unknown }`.

- [ ] **Step 1: 실패 테스트 추가** — `build-graph.test.ts`에:
```ts
import { buildWorkGraphData } from './build-graph.js'

describe('buildWorkGraphData', () => {
  const wiki = [
    { ref: 'concepts/a', type: 'document', title: 'A', relPath: 'vault/a.md' },
    { ref: 'concepts/b', type: 'document', title: 'B', relPath: 'vault/b.md' },
  ]
  it('makes task nodes + suffix-matched wiki nodes + work edges; non-matches isolated', () => {
    const tasks = [
      { id: 'req:p1:s1', title: 'edit A', status: 'done', linkedWikiPages: ['/abs/proj/vault/a.md', '/abs/proj/src/x.py'], data: { sessionId: 's1' } },
      { id: 'req:p1:s2', title: 'code only', status: 'in_progress', linkedWikiPages: ['/abs/proj/src/y.py'] },
    ]
    const g = buildWorkGraphData(tasks, wiki)
    const ids = g.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['concepts/a', 'req:p1:s1', 'req:p1:s2']) // b not touched; s2 isolated
    expect(g.nodes.find((n) => n.id === 'req:p1:s1')!.type).toBe('task')
    expect(g.nodes.find((n) => n.id === 'req:p1:s1')!.data).toEqual({ sessionId: 's1' })
    expect(g.links).toEqual([{ id: 'work:req:p1:s1->concepts/a', source: 'req:p1:s1', target: 'concepts/a', kind: 'work', label: 'touched' }])
  })
  it('dedups a wiki node touched by two tasks (1 node, 2 edges); basename-only does not match', () => {
    const tasks = [
      { id: 'req:p1:s1', title: 't1', status: 'done', linkedWikiPages: ['/x/vault/a.md'] },
      { id: 'req:p1:s2', title: 't2', status: 'done', linkedWikiPages: ['/y/vault/a.md'] },
      { id: 'req:p1:s3', title: 't3', status: 'done', linkedWikiPages: ['/z/other/a.md'] }, // basename a.md but path !endsWith vault/a.md
    ]
    const g = buildWorkGraphData(tasks, [wiki[0]])
    expect(g.nodes.filter((n) => n.id === 'concepts/a')).toHaveLength(1)
    expect(g.links.map((l) => l.source).sort()).toEqual(['req:p1:s1', 'req:p1:s2'])
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run packages/graph-view/src/build-graph.test.ts` → FAIL (export 없음).

- [ ] **Step 3: 구현** — `build-graph.ts` 끝에 추가:
```ts
export type WorkTaskInput = { id: string; title: string; status: string; linkedWikiPages: string[]; data?: unknown }

/** True if the wiki relPath is the tail of an edited file path (session literally edited that wiki file). */
function touchedWikiNode(touched: string[], relPath: string): boolean {
  return touched.some((t) => t === relPath || t.endsWith('/' + relPath) || t.endsWith('\\' + relPath))
}

/** Work↔wiki graph: request-Task nodes + the wiki nodes they edited + work→wiki edges.
 *  Tasks that edited no wiki file appear as isolated task nodes; wiki nodes are deduped. */
export function buildWorkGraphData(tasks: WorkTaskInput[], wikiNodes: WikiNodeInput[]): GraphData {
  const nodeMap = new Map<string, GraphNode>()
  const links: GraphLink[] = []
  for (const task of tasks) {
    addNode(nodeMap, {
      id: task.id, label: task.title || task.id, type: 'task', shape: 'circle',
      color: colorForNode('task'), details: task.status, data: task.data,
    })
    for (const w of wikiNodes) {
      if (!touchedWikiNode(task.linkedWikiPages, w.relPath)) continue
      addNode(nodeMap, {
        id: w.ref, label: w.title || w.ref, type: w.type as GraphNode['type'],
        shape: 'circle', color: entityColor(w.type), details: w.type, data: { path: w.relPath },
      })
      addLink(links, { id: `work:${task.id}->${w.ref}`, source: task.id, target: w.ref, kind: 'work', label: 'touched' })
    }
  }
  return { nodes: [...nodeMap.values()], links }
}
```
그리고 `packages/graph-view/src/index.ts`의 build-graph export 줄에 `buildWorkGraphData`, `type WorkTaskInput` 추가:
```ts
export { buildWikiGraphData, buildWorkGraphData, addNode, addLink, colorForNode, labelFromPath, type WorkTaskInput } from './build-graph.js'
```
(기존 export 줄을 이 형태로 확장 — 기존 식별자 유지 + 2개 추가.)

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.

- [ ] **Step 5: 커밋** — `git add packages/graph-view/src/build-graph.ts packages/graph-view/src/index.ts packages/graph-view/src/build-graph.test.ts && git commit -m "feat(graph-view): buildWorkGraphData (work↔wiki overlay)"`

---

### Task 3 (PARALLEL): tasksList IPC

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (CH + TasksListReq), `apps/desktop/src/main/ipc.ts` (handler), `apps/desktop/src/renderer/api.ts` (method)
- Test: `apps/desktop/src/main/ipc.test.ts` (케이스 추가)

**Interfaces:**
- Produces: IPC `q:tasksList` → `container.tasks.listByProject(projectId)`; renderer `api.tasksList(projectId): Promise<Task[]>`.

- [ ] **Step 1: 실패 테스트 추가** — `ipc.test.ts`의 기존 패턴(`const h = handlers(container)`)을 따라:
```ts
  test('q:tasksList returns the project tasks', async () => {
    container.tasks.create({ id: 'req:p1:s1', projectId: 'p1', title: 't', status: 'done', assigneeType: 'agent', priority: 'medium', acceptanceCriteria: [], linkedWikiPages: [], reviewStatus: 'none' })
    const h = handlers(container)
    const res = (await h[CH.tasksList]({ projectId: 'p1' })) as { id: string }[]
    expect(res.map((t) => t.id)).toContain('req:p1:s1')
  })
```
(기존 ipc.test가 `handlers`/`CH`/`container`를 import·구성하는 방식을 그대로 사용.)

- [ ] **Step 2: 실패 확인** — `npx vitest run apps/desktop/src/main/ipc.test.ts` → FAIL (`CH.tasksList` 없음).

- [ ] **Step 3: 구현**
(a) `shared/ipc-contract.ts`의 `export const CH = { … }`에 추가:
```ts
  tasksList: 'q:tasksList',
```
그리고 같은 파일에 req 타입 추가:
```ts
export type TasksListReq = { projectId: string }
```
(b) `main/ipc.ts`의 `handlers` 맵에 추가(예: `[CH.search]` 핸들러 근처):
```ts
    [CH.tasksList]: async (payload: unknown) => {
      const req = payload as TasksListReq
      return container.tasks.listByProject(req.projectId)
    },
```
그리고 ipc.ts 상단 type import에 `TasksListReq` 추가.
(c) `renderer/api.ts`에 추가(import에 `type Task` from '@apc/shared' 필요 시 추가):
```ts
  tasksList(projectId: string): Promise<Task[]> {
    return window.apc.invoke(CH.tasksList, { projectId }) as Promise<Task[]>
  },
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.

- [ ] **Step 5: 커밋** — `git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.test.ts && git commit -m "feat(desktop): tasksList IPC (q:tasksList → TaskStore.listByProject)"`

---

### Task 4 (after T2+T3): KnowledgeView 'work' 소스

**Files:**
- Modify: `apps/desktop/src/renderer/components/KnowledgeView.tsx`

**Interfaces:**
- Consumes: Task 2 `buildWorkGraphData`/`WorkTaskInput`(`@apc/graph-view`), Task 3 `api.tasksList`. 기존 `graphSource` state, `projectWiki`, `effectiveGraph`, `handleNodeClick`, `GraphVisualization`.

- [ ] **Step 1: import + tasks 로드 + workGraph**
KnowledgeView 상단 import에 `buildWorkGraphData`를 `@apc/graph-view`에서 추가(기존 builder import 줄 확장). `graphSource` state 타입을 `'run' | 'wiki'`에서 `'run' | 'wiki' | 'work'`로 확장.
프로젝트 Task 로드(기존 useState/useEffect 패턴 따름):
```tsx
  const [tasks, setTasks] = useState<import('@apc/shared').Task[]>([])
  useEffect(() => {
    if (graphSource !== 'work' || !selectedProjectId) return
    void api.tasksList(selectedProjectId).then(setTasks).catch(() => setTasks([]))
  }, [graphSource, selectedProjectId])
```
요청-Task만 추리고 자식 todos를 data에 담아 workGraph 구성:
```tsx
  const workGraph = useMemo(() => {
    const reqs = tasks.filter((t) => t.id.startsWith('req:'))
    const items = reqs.map((t) => ({
      id: t.id, title: t.title, status: t.status, linkedWikiPages: t.linkedWikiPages,
      data: { sessionId: t.contextPackage, todos: tasks.filter((c) => c.parentTaskId === t.id).map((c) => ({ title: c.title, status: c.status })) },
    }))
    return buildWorkGraphData(items, projectWiki?.nodes ?? [])
  }, [tasks, projectWiki])
```

- [ ] **Step 2: effectiveGraph + 토글 UI**
`effectiveGraph` 분기에 `graphSource === 'work'` → `workGraph` 추가. graphSource 토글 UI(기존 'run'/'wiki' 버튼 그룹)에 'Work' 버튼 추가(기존 버튼 마크업 복제, value `'work'`, 라벨 `Work`).

- [ ] **Step 3: task-노드 클릭 상세**
`handleNodeClick(node)` 시작부에 task 분기 추가(기존 wiki 경로 위):
```tsx
    if (node.type === 'task') {
      const d = node.data as { sessionId?: string; todos?: { title: string; status: string }[] } | undefined
      setSelectedNode({ kind: 'task', id: node.id, label: node.label, todos: d?.todos ?? [], sessionId: d?.sessionId })
      return
    }
```
그리고 상세 패널 렌더에 task 분기 추가(`selectedNode.kind === 'task'`면 todos를 상태별 목록으로). `selectedNode` 타입에 task variant 추가. (상세 패널이 없으면 최소: todos를 리스트로 표시.)

- [ ] **Step 4: typecheck** — `pnpm typecheck` → 0 errors.

- [ ] **Step 5: 전체 스위트** — `npx vitest run apps/desktop` (또는 루트 `pnpm test`) → green, 회귀 없음.

- [ ] **Step 6: 커밋** — `git add apps/desktop/src/renderer/components/KnowledgeView.tsx && git commit -m "feat(desktop): KnowledgeView 'work' graph source (task↔wiki)"`

---

## Self-Review (작성자 체크)
- **Spec coverage:** linkedWikiPages 캡처=T1 · buildWorkGraphData(suffix-match/isolated/dedup)=T2 · tasksList IPC=T3 · KnowledgeView 'work' 소스 + task-노드 todos 상세=T4. 비목표(todo 노드화·라이브·소스→위키 의미추론·graph-web)는 미포함.
- **Placeholder scan:** TBD/TODO 없음. T4는 큰 파일 통합이라 "기존 패턴/마크업 복제" 지시(국소·명확) — 정확 코드 스니펫 동봉. typecheck+suite가 게이트.
- **Type consistency:** `WorkTaskInput{id,title,status,linkedWikiPages,data?}`가 T2 정의 → T4 동일 사용. `buildWorkGraphData(tasks, wikiNodes)` 시그니처 일관. `CH.tasksList`/`TasksListReq`/`api.tasksList` T3 일관. 엣지 id `work:${task}->${ref}`·kind `'work'` T2/테스트 일치.
