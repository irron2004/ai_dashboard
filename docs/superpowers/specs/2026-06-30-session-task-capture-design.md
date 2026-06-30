# Spec — SP1: 세션 → Task 자동 캡처 (하이브리드)

**날짜:** 2026-06-30
**상태:** 설계(spec). 승인 후 writing-plans로 분기.
**상위 맥락:** 사용자 니즈 — 프로젝트 빠른 전환 + 이전 요청+남은 작업 **시각화(작업↔위키 그래프)**. 3개 sub-project 중 **SP1(작업 자동 캡처)** = 그래프/보드의 연료. (SP3 실행 아이콘 완료(PR#12); SP2 작업↔위키 그래프 뷰는 후속.)
**결정 사항(브레인스토밍):** 캡처 = **하이브리드**(Todos + 세션당 요청) · 요청 단위 = **세션당 1개·LLM 요약 제목** · 통합 = **접근법 A**(기존 ingest 파이프라인에 추출 스텝 추가) · 요청-Task status = **자식 todo 파생**.

---

## 1. 배경

데스크톱은 이미 `ingest()`(store) → `IngestService.ingestAll(adapters)`로 각 프로젝트의 에이전트 세션을 **발견·파싱(cursor 증분)**해 검색/knowledge에 인덱싱한다. `@apc/agents`의 claude/codex/opencode 어댑터가 세션을 `NormalizedSession`(`NormalizedTurn[]`, 각 turn에 `toolCalls: {name, input, ...}[]`)으로 통일한다. Claude Code의 `TodoWrite`는 `toolCalls`에 `{ name:'TodoWrite', input:{ todos:[{content,status}] } }`로 그대로 잡힌다(어댑터가 모든 tool call을 일반 캡처). `TaskStore.create`는 **INSERT OR REPLACE**(id로 멱등). `Task` 스키마: `id, projectId, title, status('todo'|'in_progress'|'review'|'done'|'rejected'), assigneeType('agent'|'human'), assignee?, parentTaskId?, contextPackage?, linkedWikiPages[]`.

즉 "세션 읽기"는 공짜이고, 본 작업의 핵심은 **세션 → Task 추출 + 기존 ingest에 한 스텝 끼우기**다.

## 2. 목표 / 비목표

**목표:** 에이전트 세션에서 두 종류의 Task를 멱등 추출해 `TaskStore`에 기록한다 — (a) **요청-Task**(세션당 1개, LLM 요약 제목), (b) **todo-Task**(최신 TodoWrite 항목, 상태 매핑, 요청-Task의 자식). 기존 `ingest`가 트리거.

**In:**
- `TaskExtractor`(순수 추출): `extractTodos`, `extractTasks`.
- `IngestService`에 옵셔널 `onSessionParsed(session, projectId)` 훅; container가 추출+TaskStore 배선.
- 요청-Task status 파생, LLM 비용 통제(세션당 1회 + 휴리스틱 폴백), reconcile(사라진 todo 삭제), `TaskStore.delete(id)`.

**Out (후속):**
- **SP2**: `linkedWikiPages` 채우기(toolCalls의 `file_path` → wiki 노드 매핑) + 작업↔위키 그래프 뷰.
- 라이브 워치(파일 감시 자동 재인제스트) — 별 spec.
- 비-Claude 도구의 todo 동등물(현재 TodoWrite만; 타 도구는 요청-Task만 graceful).
- 보드/그래프 UI 변경(이미 TaskBoard/TimelineStrip 존재; 본 spec은 데이터 캡처만).

## 3. 아키텍처 / 데이터 흐름

```
store.ingest() → api.ingestAll() → IngestService.ingestAll(adapters)
  └ per parsed NormalizedSession:
      (기존) 검색/knowledge 인덱싱
      (신규) await onSessionParsed?(session, projectId)
              └ container 배선: TaskExtractor.extract(session, projectId, summarize)
                                 → { request, todos } → reconcile + TaskStore.create(...)
```

`IngestService`는 `onSessionParsed?: (session: NormalizedSession, projectId: string) => Promise<void>` 옵셔널 훅만 갖는다(pm/TaskStore에 의존하지 않음 — 디커플). 데스크톱 `container.ts`가 그 훅에 task 추출+기록을 연결한다.

## 4. 컴포넌트 / 식별자

**`packages/app-services/src/task-extractor.ts` (NEW)** — 순수 함수, LLM은 주입.

- `mapTodoStatus(s: 'pending'|'in_progress'|'completed') → TaskStatus` : pending→`todo`, in_progress→`in_progress`, completed→`done`.
- `extractTodos(session): { content: string; status: TaskStatus }[]` — 세션 turns에서 `name==='TodoWrite'`인 toolCall들 중 **마지막** 것의 `input.todos`를 매핑(빈 배열 허용). content 빈 항목 스킵.
- `extractTasks(session, projectId, opts): { request: Task; todos: Task[] }` where `opts = { summarize: (s: NormalizedSession) => Promise<string>; agent: string; sessionId: string; existingTitle?: string }`.

**ID 규약(멱등 + reconcile):**
- 요청-Task: `req:${projectId}:${sessionId}`
- todo-Task: `todo:${projectId}:${sessionId}:${slug(content)}` (slug = content 소문자·공백→`-`·영숫자/한글 외 제거·길이 cap)

**요청-Task 필드:** `{ id, projectId, title, status(파생, §5), assigneeType:'agent', assignee: agent, parentTaskId: undefined, contextPackage: sessionId }`.
**todo-Task 필드:** `{ id, projectId, title: content, status: mapTodoStatus, assigneeType:'agent', assignee: agent, parentTaskId: req-id }`.

## 5. 상태 파생 / LLM / 에러

- **요청-Task status:** 자식 todo 중 `todo` 또는 `in_progress`가 하나라도 있으면 **`in_progress`**, 아니면 **`done`**. (todos 없으면 done.) → "남은 작업 있나"를 요청 헤더가 반영. **수용된 엣지:** todos를 다 끝냈지만 세션이 계속 진행 중이면 done으로 보인다(MVP 허용; 라이브/활성-세션 감지는 후속).
- **LLM 요약(요청 제목):** `summarize(session)`는 세션의 user turn(들)을 한 줄 제목(≤~80자)으로. **비용 통제:** `existingTitle`이 있으면(=이미 요약됨) 재호출하지 않고 그 title 유지 → 세션당 1회. **폴백:** summarize가 throw하면 **첫 user turn 텍스트를 잘라** 제목으로 — ingest는 절대 실패시키지 않는다.
- **TodoWrite 없는 세션:** todos=[] → 요청-Task만 기록(요청 status=done).
- **멱등/충돌:** `TaskStore.create`가 INSERT OR REPLACE → 재인제스트는 갱신. 사람이 손으로 바꾼 status가 재인제스트에 덮일 수 있음(수용; 캡처는 에이전트 소유 데이터로 간주).
- **reconcile(유실 todo 삭제):** 세션 재추출 시, `listByProject(projectId)`에서 id가 `todo:${projectId}:${sessionId}:`로 시작하지만 새 todo 집합에 없는 Task를 `TaskStore.delete(id)`로 제거. (TodoWrite에서 사라진 항목 정리.)

## 6. 컴포넌트 경계 / 변경 파일

- `packages/shared/src/schema.ts` — (필요 시) `NormalizedToolCall.input` 접근 타입 확인(이미 존재). 변경 없을 수 있음.
- `packages/pm/src/task-store.ts` — `delete(id: string): void` 추가(reconcile용). `listByProject` 재사용.
- `packages/app-services/src/task-extractor.ts` (NEW) + `task-extractor.test.ts`.
- `packages/app-services/src/ingest-service.ts` — `onSessionParsed?` 훅 추가 + per-session 호출: 세션 파싱 직후 `await onSessionParsed?.(session, projectId)` (직렬; 기존 검색/knowledge 인덱싱 전후 어디서 호출하든 기능상 무관, 단 cursor 전진 전에). 훅이 throw해도 ingest 전체는 계속(개별 세션 try/catch). 기존 시그니처 하위호환(옵셔널 dep).
- `apps/desktop/src/main/container.ts` — `onSessionParsed`에 TaskExtractor(LlmAgent summarize 주입) + reconcile + TaskStore 배선.
- LLM summarize 구현: `knowledge-harness/src/agents/*`(예: conversation-history-reader) LlmAgent 패턴 재사용 — 작은 프롬프트(세션 user turns → 한 줄 제목).

## 7. 테스트

`packages/app-services` vitest(node 환경, LLM/IO 모킹).

1. **`mapTodoStatus`**: 3개 매핑(pending→todo, in_progress→in_progress, completed→done).
2. **`extractTodos`**: 세션에 TodoWrite toolCall이 2개면 **마지막** 것 사용; 각 todo content/status 매핑; 빈 content 스킵; TodoWrite 없으면 `[]`.
3. **`extractTasks`**: 요청-Task id=`req:${pid}:${sid}`, title=mock summarize 반환값, assignee=agent; todo-Task id=`todo:${pid}:${sid}:${slug}`, parentTaskId=요청 id.
4. **요청 status 파생**: 자식에 미완 todo 있으면 `in_progress`, 전부 done이면 `done`, todos 없으면 `done`.
5. **LLM 폴백**: summarize가 reject하면 첫 user turn 잘린 제목 사용(throw 안 함).
6. **existingTitle 통제**: existingTitle 주면 summarize 미호출(spy 0회), 그 title 유지.
7. **reconcile**: 이전에 todo-Task 3개 있던 세션을 todo 2개로 재추출 → 사라진 1개가 `TaskStore.delete`로 제거(스토어 통합 테스트, in-memory db).
8. **TaskStore.delete**: id로 삭제 후 `get` 미존재.

**수용 기준:** 위 테스트 green; typecheck 0; 기존 IngestService/TaskStore 테스트 회귀 없음. 수동: 실제 프로젝트 ingest 후 TaskBoard에 요청-Task(자식 todos)들이 상태별로 나타남.
