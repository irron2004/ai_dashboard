# Spec — SP2: 작업↔위키 그래프 뷰

**날짜:** 2026-06-30
**상태:** 설계(spec). 승인 후 writing-plans로 분기.
**상위 맥락:** 사용자 니즈 — 이전 요청 + 남은 작업을 **작업↔위키 그래프**로 시각화. 3개 sub-project 중 **SP2(그래프 뷰)** = 헤드라인 "그래프로 보기". (SP3 실행 아이콘 PR#12; SP1 세션→Task 캡처 main 병합 @ffc82b3.)
**결정 사항(브레인스토밍):** 노드 = **요청-Task만**(todos = 노드 클릭 상세) · 접근법 = **A**(캡처에 링크 저장 + buildWorkGraphData + KnowledgeView 'work' 소스) · 엣지 = **세션이 실제로 그 위키 파일을 편집**(`filesTouched` ⊇ wiki `relPath` suffix)했을 때만.

---

## 1. 배경

SP1이 에이전트 세션을 `pm` Task로 캡처한다(요청-Task `req:${projectId}:${sessionId}` + 자식 todo-Task). graph-view는 이미 `task` 노드 타입을 가진 타입드 그래프 렌더러다: `GraphNode = { id; label; type: GraphNodeType('run'|'task'|'evidence'|'file'|'document'|…); shape; color; details?; data? }`, `GraphData = { nodes; links }`, `GraphVisualization({ data, onNodeClick })` (순수 렌더러). 위키 그래프는 `buildWikiGraphData(nodes: { ref; type; title; relPath }[], edges)`로 빌드되며 각 wiki 노드는 `data: { path: relPath }`를 갖는다.

데스크톱 `KnowledgeView`는 graphSource 토글(`'run'|'wiki'`)과 빌더들(`buildHarnessGraphData`/`buildWikiGraphData`/…)을 갖고, `handleNodeClick`이 `node.data.path`로 상세를 연다. **renderer에 task 조회 IPC는 아직 없다**(main에 `container.tasks: TaskStore`만 존재).

**경로 공간:** `session.filesTouched`는 에이전트가 편집한 파일들의 **절대/원시 경로**(claude-adapter가 `Edit/Write/...` toolCall의 `file_path` 수집), wiki `relPath`는 **repo-상대 위키 경로**다. 둘은 동일 비교 불가 → 의미적으로 맞는 연결 = 세션이 **그 위키 파일을 실제 편집**한 경우 = wiki `relPath`가 touched 경로의 **suffix**일 때.

## 2. 목표 / 비목표

**목표:** 캡처된 요청-Task를 wiki 그래프 위 `task` 노드로 띄우고, 세션이 편집한 위키 파일에 work→wiki 엣지를 그려 KnowledgeView에서 `'work'` 그래프 소스로 본다.

**In:**
- SP1 `extractTasks` 확장: 요청-Task `linkedWikiPages = session.filesTouched`.
- `buildWorkGraphData(tasks, wikiNodes): GraphData` (graph-view, 순수).
- task 조회 IPC(`tasksList(projectId)` → `container.tasks.listByProject`) + renderer `api.tasksList`.
- KnowledgeView: graphSource에 `'work'` + workGraph 빌드 + task-노드 클릭 상세(todos).

**Out (후속):**
- todo-Task의 노드화(현재 노드 클릭 상세로만).
- 라이브 갱신(재인제스트=on-demand).
- 소스코드→위키의 **의미적**(편집 아닌) 추론 연결.
- graph-web 앱에 'work' 소스(데스크톱 KnowledgeView만).

## 3. 데이터 흐름

```
(캡처, SP1 확장) 요청-Task.linkedWikiPages = session.filesTouched
KnowledgeView: graphSource='work'
  → api.tasksList(projectId)              [NEW IPC → container.tasks.listByProject]
  → workGraph = buildWorkGraphData(tasks, projectWiki?.nodes ?? [])
  → effectiveGraph = workGraph → <GraphVisualization data=… onNodeClick=handleNodeClick />
노드 클릭: type==='task'면 todos(상태별) 상세, 아니면 기존 wiki 동작
```

## 4. 컴포넌트 / 인터페이스

### 4.1 `extractTasks` 확장 (app-services/task-extractor.ts)
요청-Task 생성 시 `linkedWikiPages: session.filesTouched`를 추가(현재 `[]`). todo-Task는 불변. 기존 테스트 + 1 케이스(`request.linkedWikiPages === session.filesTouched`).

### 4.2 `buildWorkGraphData` (graph-view, NEW)
```
buildWorkGraphData(
  tasks: { id; title; status; linkedWikiPages: string[]; data?: unknown }[],
  wikiNodes: { ref; type; title; relPath }[],
): GraphData
```
- 각 task → `GraphNode { id: task.id, label: task.title, type: 'task', shape, color(task), data: task.data }` (task.data엔 todos 등 호출자가 채움).
- 매칭: wikiNode가 어떤 task의 `linkedWikiPages` 중 하나의 **suffix**이면(`touched.endsWith('/'+relPath) || touched === relPath || touched.endsWith('\\'+relPath)`) → 그 wiki 노드를 GraphData에 포함(`{ id: ref, label: title, type: 'document', data: { path: relPath } }`) + 링크 `{ source: task.id, target: ref, … }`.
- 매칭 0인 task도 노드로 포함(isolated). 같은 wiki 노드를 여러 task가 건드리면 dedup(노드 1개, 엣지 N개).
- 순수 함수 → 단위 테스트.

### 4.3 tasks IPC (desktop)
- main: `tasksList(projectId: string): Task[]` 채널 → `container.tasks.listByProject(projectId)` (ipc 등록 패턴은 기존 채널 따름).
- renderer `api.ts`: `tasksList(projectId): Promise<Task[]>`.

### 4.4 KnowledgeView
- graphSource 타입에 `'work'` 추가; 토글 UI에 'Work' 옵션.
- `tasks` 상태: `'work'` 선택 시 `api.tasksList(selectedProjectId)`로 로드(useEffect/useMemo).
- 요청-Task의 todos: 각 요청-Task의 자식 todo는 같은 `tasksList` 결과에서 `parentTaskId === task.id`로 모아 `task.data = { todos }`로 buildWorkGraphData에 전달.
- `workGraph = useMemo(() => buildWorkGraphData(requestTasks, projectWiki?.nodes ?? []), [tasks, projectWiki])`; `effectiveGraph`가 `'work'`면 workGraph.
- `handleNodeClick`: `node.type === 'task'`면 todos 상세 패널(상태별 목록); 아니면 기존 경로.

## 5. 에러 / 엣지

- wiki 미가용(`projectWiki` 없음) → wikiNodes `[]` → task 노드만(엣지 0). graceful.
- Task 0 → 빈 그래프.
- suffix-match만(basename 폴백 없음 — false-match 방지). 절대/상대·`/`·`\` 경계 정규화는 `endsWith` 경계 문자(`/` 또는 `\`)로 처리.
- 멱등: SP1 재인제스트가 linkedWikiPages 갱신 → 다음 'work' 빌드에 반영.
- 대량 filesTouched/wikiNodes는 O(tasks×wiki) 매칭 — MVP 규모(프로젝트당 수백)에서 무해.

## 6. 변경 파일
- `packages/app-services/src/task-extractor.ts` (+test) — linkedWikiPages.
- `packages/graph-view/src/build-graph.ts` (+ `build-graph.test.ts`) — `buildWorkGraphData`; `index.ts` export.
- `apps/desktop/src/main/` ipc + `apps/desktop/src/preload` + `apps/desktop/src/renderer/api.ts` — tasksList 채널/메서드(기존 IPC 채널 등록 패턴 준수).
- `apps/desktop/src/renderer/components/KnowledgeView.tsx` — 'work' 소스 + workGraph + task-노드 클릭.

## 7. 테스트
1. **extractTasks**: `request.linkedWikiPages` === `session.filesTouched` (기존 task-extractor 스위트에 1 케이스).
2. **buildWorkGraphData**:
   - task 노드 생성(id/label/type 'task'); task.data 전달.
   - suffix-match: wikiNode relPath `vault/a.md`가 touched `/abs/proj/vault/a.md`에 매칭 → wiki 노드 포함 + 엣지.
   - 비매칭 touched(`/abs/proj/src/x.py`) → 그 wiki 노드 미포함; task는 isolated 노드.
   - 동일 wiki를 2 task가 touched → wiki 노드 1개 + 엣지 2개(dedup).
   - basename만 같고 경로 다른 경우 매칭 안 됨(false-match 방지).
3. **tasksList IPC**: 등록된 채널이 `container.tasks.listByProject(projectId)`를 반환(기존 ipc.test 패턴).
4. **KnowledgeView**(경량): graphSource `'work'` 선택 시 `buildWorkGraphData` 결과가 GraphVisualization에 전달(렌더 스모크/모킹).

**수용 기준:** 위 테스트 green; typecheck 0; 기존 graph-view/KnowledgeView/task-extractor 스위트 회귀 없음. 수동: ingest 후 KnowledgeView 'Work' 토글 → 요청 노드들 + 위키 편집 엣지가 보이고, 노드 클릭 시 todos가 뜸.
