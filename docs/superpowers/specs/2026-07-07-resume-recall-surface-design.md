# Spec — 이어서(Resume): 컨텍스트 리콜 표면

**날짜:** 2026-07-07
**상태:** 설계 확정 (brainstorming 승인) → writing-plans 대상
**기준 커밋:** main @ `baca170` (P0~P4 머지 후)

## 1. 동기 (사용자 실고통)

사용자는 여러 프로젝트를 병렬로 진행하며 프로젝트 간 전환이 잦다. 전환할 때 **컨텍스트가 증발**한다 — 구체적으로 두 고통:

1. **"이전에 내가 뭘 물었는지 까먹는다"** — 마지막에 에이전트에게 무엇을 묻고 있었는지 재구성하려면 터미널 스크롤백을 뒤져야 함.
2. **"다음에 뭐 하려 했는지 까먹는다"** — 다른 프로젝트를 하다 오면 직전에 "다음엔 이거"라고 정해둔 것이 날아감.

두 고통은 **같은 뿌리 하나**(전환 시 리콜 실패)이며, 다행히 **필요한 데이터는 이미 대부분 캡처돼 있다.** 따라서 이 작업은 새 파이프라인이 아니라 **"리콜 표면(view) + 초경량 human 메모 캡처"** 문제다.

### 현재 상태 진단 (근거)
- 질문 원문은 `packages/search/src/search-index.ts`의 `turn_fts`(role='user')에 전부 인덱싱돼 있으나, 유일한 통로가 `SearchModal`의 **반응형 키워드 검색** — 떠올리려면 이미 단어를 알아야 하는 모순. 연대순 브라우징 불가.
- `HomeView`는 `current.md` + git 변경분(**파일** 중심)이지 **대화/질문** 중심이 아님.
- `PmHome`의 `다음 할 일`은 TodoWrite에서 **자동 추출된 Task 파생값** — *에이전트가* 추적하던 것이지, 방금 떠오른 human intent를 잡는 초경량 캡처가 없음.
- 프로젝트 재진입 시 **아무도 먼저 리마인드하지 않음**. 🌐 전체 탭에 `nextUp`이 있으나 수동 새로고침·첫 오픈 전 빈 뱃지 — 능동적으로 다가오지 않음.

## 2. 목표 / 비목표

**목표**
- 프로젝트를 선택(전환)하는 순간, 상단 **슬라이드-인 배너**로 그 프로젝트의 리콜 컨텍스트를 능동적으로 제시: {지난번 1줄 요약, 마지막 질문, 📌 다음 할 일(내 메모), [이어서 대화], [질문 히스토리]}.
- 어디서든 **초경량 "다음 할 일" 캡처**(`⌘⇧N`)로 현재 프로젝트에 note-to-self 추가.
- **연대순 질문 히스토리** drill-down(프로젝트별 + 🌐 전체).
- 🌐 전체 탭이 각 프로젝트의 top note + 마지막 질문을 노출해 **크로스프로젝트 리콜을 상시화**.

**비목표 (YAGNI)**
- 스위치마다 LLM 재요약 — ❌. 기존 `req:` Task 제목(SP1이 이미 요약)을 재활용.
- 노트 태그/재정렬/우선순위 — 초경량 유지(추가/완료/삭제만).
- **크로스디바이스 동기화** — 로컬 sqlite 한계. 로드맵 P4(status-web)와 엮이는 별도 축, 이 spec 밖.
- 카드에서 위키/문서 편집.

## 3. 데이터 모델

대부분 **재사용**. 신규는 작은 것 두 개.

| 조각 | 출처 | 신규? |
|---|---|---|
| 지난번 1줄 요약 | 프로젝트의 최근 `req:` Task 제목 (`TaskStore.listByProject`) | 재사용 |
| 마지막 질문 | `findLatestSession(adapter, repoPath)` → 마지막 `role:'user'` turn 텍스트 | 재사용 |
| 이어서 대화 타깃 | `openPanes[pid:agent].sessionId` + `resumeCommand` (기존 배선) | 재사용 |
| 📌 다음 할 일(내 메모) | **신규 `next_notes` 스토어** | 신규 |
| 질문 히스토리(연대순) | **신규 `question_log`** — ingest 시 `indexSession` 옆에서 append | 신규 |

### 3.1 `next_notes` 스토어 (`packages/pm/src/next-note-store.ts`)

human intent 캡처. 자동추출 Task와 **의도적으로 분리**(status/AC/priority 없는 초경량).

```ts
// schema (packages/shared/src/schema.ts): DB snake_case, TS camelCase
NextNote = {
  id: string          // `note:${projectId}:${ulid}`
  projectId: string
  text: string
  createdAt: string    // ISO
  done: boolean
}
```

`NextNoteStore`(TaskStore 패턴 미러): `CREATE TABLE IF NOT EXISTS next_notes(...)`, `add(projectId, text)`, `listByProject(projectId, {includeDone?})`, `toggleDone(id, done)`, `delete(id)`. `migratePm`에 CREATE 추가.

### 3.2 `question_log` (`packages/pm/src/question-log-store.ts`)

`turn_fts`가 시간순 정렬을 못 하므로(FTS5 랭킹 전용) 연대순 브라우징용 최소 사이드카.

```ts
QuestionLogEntry = {
  projectId: string
  sessionId: string
  ts: string           // turn.timestamp (ISO)
  agent: AgentType
  text: string         // role='user' turn text
}
```

`QuestionLogStore.record(session: NormalizedSession)`: 해당 세션의 user turns를 기록.
**멱등 = 세션ID 기준 DELETE-then-INSERT** (`indexSession`과 동일 패턴). ⚠️ 핸드오프에 반복 지적된 *INSERT OR REPLACE 재클로버 함정* 회피 — user 설정값을 갖는 테이블이 아니라 파생 로그이므로 통째 재생성이 안전.
`listRecent({projectId?, limit})`: `ORDER BY ts DESC`.

**배선:** `ingest-service.ts`에서 `this.deps.index.indexSession(withProject)` **직후** `this.deps.questionLog?.record(withProject)` 호출(옵셔널 dep, 기존 훅과 동일한 방어적 try/catch). `container.ts`에서 주입.

## 4. 조립 + IPC

### 4.1 `buildResumeCard` (`packages/dashboard-api/src/resume-card.ts`)

`buildWorkspaceOverview`/`nextUp`와 같은 집. **순수 조립** — 세션 파싱(`findLatestSession`)은 부수효과(fs·sqlite 읽기)라 dep로 주입.

```ts
export type ResumeCard = {
  project: Project
  lastSummary: string | null       // 최근 req: task 제목
  lastQuestion: { text: string; ts: string; agent: AgentType } | null
  nextNotes: NextNote[]            // done=false, 최신순 (상위 N)
  resumeTarget: { agent: AgentType; sessionId?: string } | null
  hasHistory: boolean              // 배너 억제 판단용: 위 중 하나라도 있으면 true
}

export type ResumeDeps = DashboardDeps & {
  nextNotes: NextNoteStore
  latestSession: (repoPath: string) => Promise<{ agent: AgentType; sessionId?: string; lastUserTurn?: { text: string; ts: string } } | null>
}
export async function buildResumeCard(deps: ResumeDeps, projectId: string): Promise<ResumeCard>
```

`hasHistory === false`이면 renderer가 배너를 **띄우지 않음**(빈 카드 방지 — 첫 오픈 프로젝트).

### 4.2 IPC 채널 (CLAUDE.md 4파일 배선 규칙 준수)

`apps/desktop/src/shared/ipc-contract.ts` → `preload/index.ts` → `renderer/api.ts` → `main/ipc.ts` (+ `Container` 메서드).

| CH 키 | 채널 | 방향 | 페이로드 |
|---|---|---|---|
| `resumeCard` | `q:resumeCard` | query | `{projectId}` → `ResumeCard` |
| `questionLog` | `q:questionLog` | query | `{projectId?, limit?}` → `QuestionLogEntry[]` |
| `nextNoteAdd` | `c:nextNoteAdd` | command | `{projectId, text}` → `{ok, note?}` |
| `nextNoteToggle` | `c:nextNoteToggle` | command | `{id, done}` → `{ok}` |
| `nextNoteDelete` | `c:nextNoteDelete` | command | `{id}` → `{ok}` |

## 5. UI

### 5.1 `ResumeBanner.tsx` (신규)
- 트리거: `selectedProjectId`가 **실제로 바뀔 때만**(`useEffect` deps=[selectedProjectId], 이전값 ref 비교로 재렌더 무발화·디바운스). `store.loadResumeCard(pid)` → `hasHistory`면 배너 open.
- 렌더: 비모달 상단 오버레이. 터미널/본문 포커스 안 뺏음(`pointer-events` 배너 영역 한정). ✕ 또는 N초 자동 페이드 후 작은 pill(다시 열기).
- 콘텐츠: `지난번 요약` · `마지막 Q` · `📌 다음(nextNotes top)` · `[이어서 대화]`(resumeTarget으로 도크 펼침+해당 agent 포커스+resume) · `[질문 히스토리]`(QuestionHistory 오픈) · 인라인 `📌 다음 +`.

### 5.2 `QuestionHistory.tsx` (신규)
- drill-down 패널/모달. `api.questionLog({projectId})` 또는 `{}`(전체). 연대순(ts DESC), 프로젝트/에이전트 뱃지, 클릭 → 프로젝트 선택 + 해당 세션 resume/점프.
- 진입점: 배너 `[질문 히스토리]` + 툴바 아이콘.

### 5.3 다음 할 일 빠른 캡처
- 배너 인라인 입력 + 전역 `⌘⇧N`(App.tsx keydown, 기존 Ctrl+K 패턴) → `api.nextNoteAdd({projectId: selectedProjectId, text})`, 낙관적 오버레이(P2/P3의 override 패턴 미러).

### 5.4 🌐 전체 탭 통합 (`WorkspaceHome.tsx`)
- 각 `workspace-card`에 해당 프로젝트의 top `nextNote` + `lastQuestion` 노출.
- `buildWorkspaceOverview`(또는 병렬 조립)에 `nextNotes`·`lastQuestion` 추가 → `ProjectOverview` 확장. (주의: `lastQuestion`은 세션 파싱 부수효과 — 전체 탭 조립을 async로 하거나, 배너용 경로와 분리해 전체 탭은 note만 즉시 노출하고 lastQuestion은 lazy. **결정: 전체 탭은 `nextNotes`만 동기 노출**(값싼 DB 조회), `lastQuestion`은 배너 전용으로 한정해 전체 탭 조립을 무겁게 하지 않음.)

## 6. 스토어 (renderer `store.ts`)
`resumeCard`, `resumeBannerOpen`, `nextNotes` 상태 + 액션 `loadResumeCard(pid)`, `dismissBanner()`, `addNextNote(text)`, `toggleNextNote(id)`, `deleteNextNote(id)`, `openQuestionHistory(scope)`. 배너 트리거는 App.tsx의 기존 `selectedProjectId` effect에 배선.

## 7. 테스트 전략
- `buildResumeCard`: (세션+task+노트 픽스처 → 정확 조립) / (빈 프로젝트 → `hasHistory=false`) / (노트만 있고 세션 없음 → lastQuestion=null이지만 hasHistory=true).
- `NextNoteStore`: CRUD, `listByProject` 필터(includeDone), done 토글.
- `QuestionLogStore`: 재인제스트 멱등(같은 세션 2회 record → 중복 0, DELETE-then-insert 검증), `listRecent` 정렬·projectId 필터.
- `ResumeBanner`: 프로젝트 전환 시 발화 · **재렌더 시 무발화** · `hasHistory=false`면 미표시.
- `WorkspaceHome`: nextNote 노출.
- **회귀 가드:** `apps/desktop` 테스트는 `apps/desktop`에서 `npx vitest run` 별도 실행(루트 `pnpm test`가 `apps/**` 제외 — 핸드오프 반복 함정). ingest 훅 추가가 `c:ingestAll` 타임아웃 회귀 안 내는지 확인.

## 8. 알려진 한계
- 로컬 sqlite 종속(크로스디바이스 동기화 없음) — status-web(P4) 확장 시 읽기 전용으로 노출 가능하나 이 spec 밖.
- `question_log`은 재인제스트 전까지 과거 세션 미포함 → 최초 도입 시 1회 풀 인제스트로 백필(기존 ingest 재실행).
- ssh:// 프로젝트의 `lastQuestion`은 원격 대화 fetch 경로(`conversationAdapters`)에 의존 — 미배선 시 null(degrade gracefully).

## 9. Task 분해 (writing-plans 입력, 대략 5개)
1. **데이터 스토어**: `NextNoteStore` + `QuestionLogStore` + schema + `migratePm` + 테스트.
2. **ingest 훅**: `questionLog.record` 배선(옵셔널 dep, try/catch) + 멱등 테스트 + `c:ingestAll` 회귀 확인.
3. **조립 + IPC**: `buildResumeCard` + 5개 채널 4파일 배선 + container 주입 + 테스트.
4. **배너 + 캡처 UI**: `ResumeBanner`, `⌘⇧N`, store 액션, App.tsx 트리거 배선 + 테스트.
5. **히스토리 + 전체 탭**: `QuestionHistory` 패널, `WorkspaceHome` nextNote 노출 + 테스트.
