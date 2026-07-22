# 프로젝트 컨텍스트·실시간 작업 UX 통합 설계

- 날짜: 2026-07-20
- 상태: 구현·자동 검증 완료, Windows packaged tmux/SSH 수동 acceptance 남음
- 범위: `TODO.md`의 프로젝트 컨텍스트, 수동 Task, 메모, 에이전트 활동·최근 질문, 위키 생성 진행, 터미널 붙여넣기·`tmux` 렌더링, 대화 파일 미리보기
- 구현 계획: `docs/superpowers/plans/2026-07-20-project-context-and-live-ux.md`
- Windows QA: `docs/handoffs/2026-07-20-project-context-live-ux-windows-qa.md`
- 관련 설계: `2026-06-08-harness-live-progress-design.md`, `2026-06-30-session-task-capture-design.md`, `2026-07-07-resume-recall-surface-design.md`, `2026-07-15-conversation-history-tab-design.md`

## 0. 결정 요약

이 설계는 열 개 TODO를 각각 고립된 기능으로 만들지 않고, 다음 세 가지 사용자 질문에 답하는 하나의 작업 표면으로 묶는다.

1. **이 프로젝트에서 무엇을 하려는가?** — 목표, 현재 집중 항목, Task, 메모
2. **지금 실제로 무엇이 진행 중인가?** — 에이전트 상태, 최근 질문, 위키 워커·노드 진행
3. **작업 결과의 근거를 바로 확인할 수 있는가?** — 안전한 붙여넣기, 정상적인 터미널 렌더링, 대화 속 파일 미리보기

핵심 결정은 다음과 같다.

- 기존 `Project.goal/currentFocus`, `Task`, `NextNote`, `RunArtifactStore`를 확장한다. 같은 목적의 두 번째 저장소를 만들지 않는다.
- renderer의 메모리 상태나 `localStorage`를 권위로 삼지 않는다. 수동 데이터와 실행 상태는 main/core/PM 저장소, 위키 진행은 run 디렉터리의 이벤트 저널이 권위다.
- `projectId + worktreePath + slotId + agent`를 pane 정체성으로 명시한다. 해시된 terminal key를 main에서 역산하지 않는다.
- 자동 생성값의 **출처**와 사용자의 **확정·수정 여부**를 별도로 보존한다.
- 최근 질문은 desktop 전용 activity API로 제공한다. 기존 `WorkspaceOverview`에 넣어 status-web으로 질문이 우발적으로 노출되는 일을 막는다.
- 위키 진행 수치는 예측할 수 없는 노드 수가 아니라 계획된 worker 단위를 전체 작업 수로 사용한다. 발견 노드 수는 별도로 표시한다.
- 파일 경로 parser는 후보만 만든다. 실제 파일 존재·프로젝트 경계·symlink·SSH 경계는 main이 열기 직전에 다시 검증한다.
- HTML은 앱 DOM에 직접 주입하지 않는다. script와 network 권한이 없는 sandbox iframe에서만 미리 본다.
- 터미널 붙여넣기는 xterm의 `paste()` 경로 하나로 통합하고, `tmux`는 `TERM`/UTF-8/Unicode 폭/글꼴/resize를 함께 검증한다.
- 공통 계약을 먼저 동결한 뒤 네 작업 스트림을 병렬 실행하고, 충돌이 큰 중앙 파일은 한 명의 통합 담당자만 수정한다.

## 1. 목표와 범위 밖

### 1.1 목표

- 프로젝트 생성·편집에서 목표와 현재 집중 항목을 입력하고 재시작 뒤에도 복원한다.
- 사용자가 Task와 메모를 직접 관리하며, 자동 생성 데이터와 출처·사용자 수정 여부를 구분한다.
- `전체` 화면만 보고도 프로젝트별 agent가 살아 있는지, 실제 작업 중인지, 사용자 입력을 기다리는지, 무엇을 마지막으로 요청했는지 알 수 있게 한다.
- 위키 생성에서 단계가 아닌 worker와 node 단위 진행을 실시간으로 보고, 앱을 다시 열어도 같은 이력을 재생한다.
- 터미널의 붙여넣기와 `tmux` 렌더링을 Windows 패키징 앱에서도 안정적으로 제공한다.
- 대화 속 접근 가능한 `.md`, `.html`, `.py` 경로를 안전하게 오른쪽 패널에서 확인한다.
- 각 기능에 빈 상태, 로딩, 저장 실패, 연결 실패, stale/interrupted 상태를 명시한다.

### 1.2 범위 밖

- LLM이 프로젝트 목표를 자동 생성하는 새 파이프라인. 단, agent가 제안값을 저장할 수 있는 provenance 계약은 제공한다.
- 위키 LLM 호출의 무조건 자동 재시도. v1의 retry 수는 실제 resume/manual retry 또는 안전한 transport retry만 센다.
- 임의 경로 파일 탐색기, 파일 편집·저장, 외부 URL 브라우징.
- HTML의 script, form, popup, 외부 image/font/network 실행.
- status-web에 최근 질문 원문을 공개하는 기능. 별도 opt-in 설계 전까지 desktop 내부에만 둔다.
- 원격 SSH host의 locale·폰트 설치를 앱이 임의로 변경하는 기능. 진단과 안전한 환경 전달까지만 담당한다.

## 2. 현재 기반과 결손

| 영역 | 재사용 가능한 현재 기반 | 이번에 채울 결손 |
|---|---|---|
| 프로젝트 컨텍스트 | `ProjectSchema`, `projects.goal/current_focus`, `ProjectRegistry`, `PmHome` 읽기 표시 | 생성·편집 입력, `전체` 표시, 출처·확정 상태, async 저장 오류 |
| Task | `TaskSchema`, `TaskStore`, 대화 extractor, blocker, `nextUp` 정렬 | 일반 CRUD IPC/UI, source badge, 사용자 override·삭제 tombstone |
| 메모 | `NextNoteStore`, `next_notes`, ResumeBanner, `WorkspaceOverview.topNote` | 편집·고정·완료·보관·복원, 상시 drawer, Task 전환 |
| agent 상태 | renderer의 `idle/running/attention/done`, `PtyManager`, `AgentRunStore` | main 권위 상태 머신, process/phase 분리, pane identity, 영속화·재시작 복원 |
| 최근 질문 | ingest 뒤 채워지는 `QuestionLogStore`, conversation history와 `HistoryFocus` | 제출 직후 갱신, pane/session 결합, privacy, 전체·terminal 제목 UI |
| 위키 진행 | stage progress, raw log, 성공 뒤 node batch, `RunArtifactStore` | worker/node 이벤트, 실패·retry, 마지막 활동·stale, journal replay |
| 붙여넣기 | `Ctrl+Shift+V`와 raw PTY write | 모든 단축키·우클릭, xterm bracketed paste, 오류 안내, 크기 제한 |
| `tmux` | xterm 5.5 + FitAddon, node-pty resize | `xterm-256color`/UTF-8, Unicode 폭, CJK font 진단, resize/reconnect 회귀 |
| 파일 미리보기 | `MarkdownContent`, `fsReadDoc`, realpath containment, WSL 경로 변환 | 경로 tokenizer, worktree/session root, SSH reader, 우측 preview, HTML sandbox/Python view |

`nextUp`의 실행 가능 판정과 priority→dueDate 정렬은 이미 요구와 일치하므로 알고리즘을 복제하지 않고 그대로 재사용한다.

## 3. 전체 구조와 데이터 권위

```text
ProjectRegistry / PM SQLite                    RunArtifactStore
  ├─ project context                            ├─ run.json
  ├─ tasks / next_notes                         ├─ progress.jsonl
  ├─ agent_activity                             └─ progress-summary.json
  └─ question_log (ingested history)                    │
              │                                         │
              ├──────── app services / reducers ─────────┤
              │                                         │
        Desktop main process                      HarnessService
       validation + redaction                 lifecycle event sink
              │                                         │
       typed IPC snapshots + versioned events ───────────┘
              │
       renderer store (cache only)
              │
   WorkspaceHome / PM / terminal / wiki / conversation preview
```

권위 규칙:

- renderer는 ID, provenance, project ownership, 파일 접근 권한을 결정하지 않는다.
- snapshot 응답은 전체 초기 상태를 만들고, event는 같은 entity의 `revision` 또는 `seq`가 더 클 때만 patch한다.
- 비동기 화면 전환은 request generation을 비교해 이전 프로젝트 응답이 현재 화면을 덮지 못하게 한다.
- `localStorage`에는 drawer 폭, 선택한 run, 열린 tab 같은 표시 선호만 저장한다.
- app restart 시 `processAlive=true`였던 과거 agent row는 `disconnected`로 정규화한다. 프로세스가 여전히 산다고 추측하지 않는다.

## 4. 공통 도메인 계약

### 4.1 프로젝트 컨텍스트

기존 문자열 필드는 유지하고 provenance와 confirmation을 추가한다.

```ts
type ProjectContextSource = 'user' | 'agent'

type Project = {
  // existing fields
  goal?: string
  currentFocus?: string
  goalSource?: ProjectContextSource
  goalConfirmedAt?: string
  currentFocusSource?: ProjectContextSource
  currentFocusConfirmedAt?: string
}
```

- legacy의 비어 있지 않은 값은 `source=user`, `confirmedAt=migration 시각`으로 해석한다.
- 사용자가 새 값을 입력하거나 문구를 수정하면 `source=user`와 confirmation 시각을 기록한다.
- agent 제안은 `source=agent`, `confirmedAt=undefined`로 저장한다.
- 사용자가 **제안 수락**을 누르면 원문 출처는 agent로 보존하고 `confirmedAt`만 채운다.
- 확정된 사용자 값을 agent가 자동으로 덮어쓸 수 없다. 새 제안은 별도 proposal로 반환하거나 명시적 사용자 확인을 요구한다.
- 공백만 있는 입력은 `undefined`로 정규화한다.

### 4.2 Task provenance와 사용자 override

```ts
type TaskSource = 'manual' | 'conversation' | 'note' | 'review' | 'system'

type Task = {
  // existing fields
  source: TaskSource
  sourceRef?: string
  createdAt: string
  updatedAt: string
  userEditedAt?: string
  deletedAt?: string
}
```

- main이 수동 Task ID와 `source=manual`을 만든다. renderer가 source나 ID를 주장하지 않는다.
- extractor는 `conversation + sessionId`, note 전환은 `note + noteId`, review 후속은 `review + reviewId`를 명시한다.
- 자동 Task도 사용자가 title/status/priority/dueDate를 수정할 수 있다. 수정 뒤 `userEditedAt`을 기록하고 재-ingest는 사용자 소유 필드를 보존한다.
- 사용자 삭제는 `deletedAt` tombstone이다. 같은 `source + sourceRef`의 재-ingest가 Task를 부활시키지 않는다.
- source에서 사라진 자동 Task는 user edit/tombstone이 없을 때만 정리한다.
- 기본 list와 `nextUp`은 `deletedAt`이 없는 Task만 반환한다.
- UI badge는 `직접 입력`, `대화 추출`, `메모 전환`, `리뷰 후속`, `시스템`을 표시하고, `userEditedAt`이 있으면 `사용자 수정`을 덧붙인다.

수동 mutation DTO는 수정 가능한 필드만 받는다.

```ts
type TaskCreateReq = { projectId: string; title: string; status?: TaskStatus; priority?: TaskPriority; dueDate?: string }
type TaskUpdateReq = { projectId: string; taskId: string; title: string; status: TaskStatus; priority: TaskPriority; dueDate?: string }
type TaskDeleteReq = { projectId: string; taskId: string }
```

모든 update/delete는 `task.projectId === req.projectId`를 검증한다.

### 4.3 `NextNote` 호환 확장

새 `notes` 테이블을 만들지 않고 기존 데이터를 그대로 확장한다.

```ts
type NextNote = {
  id: string
  projectId: string
  text: string
  createdAt: string
  updatedAt: string
  done: boolean
  pinned: boolean
  archivedAt?: string
  convertedTaskId?: string
}
```

- 표시 lifecycle은 `archivedAt 존재 → archived`, 그 외 `done=true → completed`, 나머지 `active` 순서로 파생하고 store가 전이를 담당한다. archive/restore는 기존 완료 여부를 보존한다.
- 기본 정렬은 pinned desc → updatedAt desc다.
- 기존 `nextNoteAdd/toggle/delete`는 호환 wrapper로 유지하고 신규 API는 ownership을 검증한다.
- note→Task는 한 SQLite transaction에서 `source=note` Task 생성과 note의 `convertedTaskId`/archive를 함께 저장한다.
- 같은 note를 다시 전환하면 기존 Task를 반환하여 idempotent하게 동작한다.

### 4.4 agent pane과 활동 상태

```ts
type AgentPaneIdentity = {
  paneId: string
  projectId: string
  worktreePath: string
  slotId: string
  agent: 'claude' | 'codex' | 'opencode'
  sessionId?: string
}

type AgentActivity = {
  pane: AgentPaneIdentity
  launchId: string
  connection: 'starting' | 'connected' | 'disconnected' | 'error'
  phase: 'idle' | 'working' | 'awaiting_user'
  processAlive: boolean
  lastActivityAt: string
  lastInputAt?: string
  lastOutputAt?: string
  staleSince?: string
  currentLabel?: string
  lastQuestion?: {
    displayText: string
    askedAt: string
    sessionId?: string
    exchangeId?: string
    privacy: 'visible' | 'masked' | 'hidden'
    source: 'pty' | 'transcript'
  }
  exitCode?: number
  reason?: string
  revision: number
}
```

`processAlive`와 사용자용 상태를 합치지 않는다. 사용자용 5상태는 다음 우선순위로 파생한다.

1. `connection=error` → 오류
2. `connection=disconnected` → 연결 끊김
3. `phase=awaiting_user` → 응답 대기
4. `phase=working` → 작업 중
5. 그 외 → 유휴

PTY start에 pane identity와 `launchId`를 함께 보내고 data/exit event에도 launchId를 되돌린다. 동일 pane을 재시작했을 때 이전 PTY의 늦은 exit가 새 세션을 종료시키지 못하게 current launch 여부를 확인한다.

`AgentRunStore`는 Task에 귀속된 공식 run 기록으로 유지한다. `전체` 화면에서는 interactive activity와 official run을 presentation DTO에서만 함께 보여준다.

### 4.5 위키 진행 이벤트

run별 `progress.jsonl`에 아래 versioned envelope을 append한다.

```ts
type WikiRunEvent = {
  version: 1
  seq: number
  eventId: string
  runId: string
  projectId: string
  at: string
} & (
  | { kind: 'run_started' | 'run_completed' | 'run_failed'; message?: string }
  | { kind: 'phase_started' | 'phase_completed' | 'phase_failed' | 'phase_paused'; phase: string; message?: string }
  | { kind: 'work_planned'; total: number }
  | { kind: 'worker_started' | 'worker_completed' | 'worker_failed' | 'worker_retrying'; workerId: string; folder?: string; attempt: number; message?: string }
  | { kind: 'node_discovered' | 'node_accepted' | 'node_dropped'; workerId: string; proposalId: string; title: string; nodeType: string; sourceFolder?: string }
  | { kind: 'engine_request_started' | 'engine_activity' | 'engine_request_finished'; workerId?: string }
  | { kind: 'transport_reconnecting'; workerId?: string; attempt: number; message?: string }
)
```

- append는 run별 직렬 queue를 사용하고 seq는 단조 증가한다.
- replay는 마지막의 불완전한 JSONL 한 줄을 무시한다.
- `progress-summary.json`은 같은 reducer 결과를 temp+rename으로 atomic 저장한다.
- 노드의 임시 identity는 `workerId + proposalId`다. 최종 artifact와 reconcile해 accepted/dropped를 기록한다.
- `work.total`은 folder worker 단위 수이며, 단일 작업은 1이다. 발견 노드 수와 혼동하지 않는다.
- `worker_retrying`과 `transport_reconnecting`은 실제 retry가 있을 때만 발생한다. 구현되지 않은 재시도를 UI가 꾸며내지 않는다.

```ts
type WikiProgressSummary = {
  runId: string
  projectId: string
  status: 'generating' | 'waiting' | 'reconnecting' | 'completed' | 'failed'
  health: 'active' | 'quiet' | 'stalled' | 'interrupted'
  phase?: string
  startedAt: string
  lastActivityAt: string
  endedAt?: string
  work: { total: number; completed: number; inProgress: number; failed: number; retries: number }
  workers: WikiWorkerSummary[]
  nodes: WikiNodeProgress[]
}
```

### 4.6 파일 reference와 preview

```ts
type ParsedFileReference = {
  raw: string
  path: string
  line?: number
  column?: number
  form: 'markdown' | 'inline_code' | 'quoted' | 'bare'
  start: number
  end: number
}

type ResolvedFileReference = ParsedFileReference & {
  token: string
  projectId: string
  canonicalPath: string
  displayPath: string
  workspaceRoot: string
  kind: 'markdown' | 'html' | 'python'
  size: number
}
```

- tokenizer는 POSIX, Windows drive, `/mnt/<drive>`, UNC/WSL UNC, 상대경로, Markdown destination, backtick, `:line[:column]`을 지원한다.
- `http`, `https`, `mailto`는 로컬 파일 후보에서 제외한다.
- allowlist는 `.md/.mdx/.markdown`, `.html/.htm`, `.py`다.
- 상대경로 root 우선순위는 검증된 session workspace → active worktree → primary repo/vault다. panel에 선택된 root를 표시한다.
- `fileRefsResolve`는 후보를 batch 검증하고 짧은 수명의 opaque token을 반환한다.
- `filePreviewRead`는 token을 신뢰하는 대신 현재 project/worktree를 기준으로 realpath·containment·확장자·크기(기본 1 MiB)를 다시 검증한다.

## 5. 저장소와 migration

모든 migration은 fresh DB, legacy DB, 반복 실행에서 안전해야 한다.

| 저장소 | 변경 |
|---|---|
| core `projects` | `goal_source`, `goal_confirmed_at`, `current_focus_source`, `current_focus_confirmed_at` 추가 |
| PM `tasks` | `source`, `source_ref`, `created_at`, `updated_at`, `user_edited_at`, `deleted_at` 추가 및 legacy source backfill |
| PM `next_notes` | `updated_at`, `pinned`, `archived_at`, `converted_task_id` 추가 |
| PM `agent_activity` | pane identity, launch, connection/phase/process, timestamps, sanitized question, exit/reason/revision 저장 |
| desktop pane persistence | `workspace_pane_v2`에 pane/worktree/slot/session 저장; legacy `(project, agent)` row 1회 이관 |
| run filesystem | `progress.jsonl`, `progress-summary.json` 추가 |

legacy Task source backfill은 알려진 ID prefix를 사용한다.

- `req:`/`todo:` → `conversation`
- review service의 알려진 `auto-` row → `review`
- 나머지 → `manual`

backfill 이후 모든 producer가 source를 명시해야 하며 새 ID prefix 추론에 의존하지 않는다.

## 6. 사용자 경험

### 6.1 프로젝트 목표와 현재 집중 항목

- ProjectSidebar의 생성·편집 dialog에 목표 textarea와 현재 집중 항목 input을 추가한다.
- 저장 중에는 dialog를 유지하고 중복 제출을 막는다. 실패하면 값을 보존한 채 inline reason과 재시도를 제공한다.
- `PmHome`과 `WorkspaceHome` 프로젝트 카드에 두 값을 표시한다.
- badge는 `사용자 작성`, `AI 제안`, `AI 제안 · 사용자 확정`을 구분한다.
- 미확정 제안에는 `확정`과 `직접 수정` action을 제공한다.

### 6.2 수동 Task

- `PmHome`의 다음 할 일과 `TaskBoard`에서 같은 Task editor를 연다.
- editor는 title 필수, status, priority, due date를 지원한다.
- 완료는 status=`done`, 삭제는 확인 뒤 tombstone으로 처리한다.
- source와 사용자 수정 badge를 카드에 항상 표시한다.
- mutation 성공 뒤 tasks, dashboard, resume card, workspace overview를 같은 refresh orchestration으로 갱신한다.
- 저장 실패 시 editor를 닫지 않으며 optimistic row가 있었다면 rollback한다.

### 6.3 프로젝트 메모

- 어느 main tab에서든 toolbar의 메모 버튼으로 오른쪽 drawer를 연다. `Ctrl/Cmd+Shift+N`은 drawer를 열고 입력에 focus한다.
- active/completed/archived filter, pinned-first 정렬, add/edit/delete/complete/archive/restore/pin/Task 전환을 제공한다.
- 메모와 Task는 heading, 색, action 문구를 다르게 하며 ResumeBanner도 메모라는 명칭을 사용한다.
- note→Task 성공 후 생성된 Task로 이동할 수 있다.

### 6.4 `전체` 화면 agent activity와 최근 질문

- 프로젝트 카드에는 goal 요약 아래 pane별 agent row를 표시한다.
- 각 row는 사용자용 상태, process alive indicator, agent, worktree/slot, current label 또는 recent run, last activity를 보여준다.
- stale은 상태를 임의로 바꾸지 않고 `마지막 활동 2분 전 · 중단 가능성` 보조 경고로 표시한다.
- activity row 클릭은 정확한 pane/worktree/slot을 열고, official run row는 run detail로 이동한다.
- 최근 질문은 sanitized 한 줄, 시각, agent를 표시한다.
- transcript의 session/exchange가 있으면 HistoryFocus로 이동하고, 아직 ingest되지 않은 live 질문이면 해당 pane을 활성화한다.
- 초기 snapshot 뒤 `agent:activity` event로 실시간 patch한다. 전체 화면의 수동 새로고침에 의존하지 않는다.

### 6.5 terminal 제목과 질문 privacy

- header는 질문이 있을 때 `Codex [최근 질문]` 형태로 표시하고 CSS ellipsis를 적용한다.
- hover/detail에는 sanitized 전체 문장만 표시한다. raw secret은 어느 DOM attribute에도 넣지 않는다.
- 질문이 없으면 기존 agent 이름만 표시한다.
- PTY input의 Enter 제출 후보로 optimistic title을 즉시 갱신한 뒤 transcript 재조회 결과로 session/exchange와 최종 문구를 reconcile한다.
- IME 조합, 화살표 편집, TUI 입력 때문에 key stream을 역사 원장으로 사용하지 않는다. `question_log`는 ingest된 확정 이력을 유지하고 optimistic 값은 `agent_activity`에만 둔다.
- password/secure prompt 중 입력, 한 글자 승인(`y/n`), control sequence는 질문으로 저장하지 않는다.

### 6.6 위키 생성 진행

- 기본 화면은 사용자용 상태, worker counts, active workers, node list, 마지막 활동/경과 시간만 보여준다.
- worker row는 folder/worker, attempt, status, 마지막 message를 한 줄로 표시한다.
- node가 발견될 때 title/type/source folder를 즉시 추가하고 최종 accepted/dropped 상태까지 갱신한다.
- 상세 engine log는 접힌 상태가 기본이며 별도 capped API로 lazy load한다. prompt/secret은 기본 응답에 포함하지 않는다.
- run 선택 또는 app restart 시 main의 persisted summary+journal을 replay한다.
- 30초 무이벤트는 `응답 대기 중` 경고, 120초는 `중단 가능성` 경고다. 경고만 표시하며 run을 자동 실패시키지 않는다.
- nonterminal run인데 main active job이 없으면 `interrupted`와 Resume action을 표시한다.

상태 전이는 다음 사실에 근거한다.

| 사실 | 상태 |
|---|---|
| worker/node/engine output event | 생성 중 |
| engine request 시작 후 첫 activity 전, human gate | 응답 대기 |
| 실제 transport retry | 재연결 중 |
| terminal success state | 완료 |
| `FAILED` 또는 terminal failure | 실패 |

### 6.7 터미널 붙여넣기

- `Ctrl+V`, `Ctrl+Shift+V`, `Shift+Insert`, macOS의 `Cmd+V`, 우클릭 Paste가 모두 `requestPaste()` 하나를 호출한다.
- clipboard는 명시적 user gesture에서만 main의 좁은 text API로 읽는다. 최대 크기를 검증하고 원문 문자·개행을 바꾸지 않는다.
- 성공 시 raw `writePty`가 아니라 `term.paste(text)`를 사용한다. xterm이 `?2004h` mode에서 bracketed paste marker를 적용한다.
- multiline인데 bracketed paste가 활성화되지 않은 경우 preview와 실행 위험을 알리고 사용자가 확인하기 전에는 전송하지 않는다.
- 권한 거부, 빈 clipboard, 크기 초과, read 실패를 terminal 근처 `aria-live` notice로 표시한다.
- copy/paste 원문은 log, telemetry, activity record에 남기지 않는다.

### 6.8 `tmux` 글자 깨짐 방지

문제를 색상 하나로 취급하지 않고 환경, 폭 계산, 글꼴, resize 네 층으로 나눈다.

- local Unix/WSL PTY는 `TERM=xterm-256color`, `COLORTERM=truecolor`를 명시하고 기존 UTF-8 `LANG/LC_CTYPE`는 보존한다. UTF-8이 아닌 경우 지원되는 UTF-8 locale로만 보정한다.
- SSH는 등록된 연결을 사용하며 remote locale을 임의 설치·변경하지 않는다. UTF-8 charmap이 아니면 진단 문구와 확인 명령을 제공한다.
- xterm Unicode 11 width addon을 활성화하고 한글·wide emoji·box drawing의 cell width fixture를 고정한다.
- terminal font preference를 제공하고 CJK monospace 후보를 우선한다. Powerline/Nerd glyph가 없는 환경은 깨진 문자를 숨기지 않고 `글꼴에 해당 글리프 없음` 진단과 설정 진입을 제공한다.
- font load, dock 재노출, window resize, pane split/reattach 뒤 `FitAddon.fit()` → PTY resize → terminal refresh 순서를 animation frame에 맞춰 실행한다.
- `tmux` 안팎에서 같은 fixture(`한글 ABC`, box drawing, wide emoji, 256/true color)를 나란히 비교한다.

### 6.9 대화 파일 preview

- 질문 row의 disclosure button과 파일 reference control을 분리해 nested button을 만들지 않는다.
- 일반 click은 기존 선택/토글 동작을 유지한다. `Ctrl+click` 또는 `Cmd+click`, keyboard action만 preview를 연다.
- 검증된 reference만 link affordance를 표시하고 unresolved text는 원문 그대로 둔다.
- 오른쪽 panel은 280~720px resize, close/Escape, width preference, loading/empty/error 상태를 지원한다.
- `.md`는 `MarkdownContent`를 재사용하되 raw HTML을 escape하고, 내부 local link는 resolver를 다시 거친다.
- `.py`는 text tokenization으로 keyword/comment/string/number를 강조하고 line number와 target line scroll/highlight를 제공한다. HTML injection을 사용하지 않는다.
- `.html`은 다음 제약의 iframe `srcDoc`에서만 렌더링한다.
  - `sandbox=""`, `referrerPolicy="no-referrer"`
  - CSP: `default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; img-src data:; style-src 'unsafe-inline'`
  - script/forms/popups/top navigation 없음
  - line 지정 시 렌더 결과가 아니라 Source tab을 기본으로 열어 정확한 줄을 강조
- 새 preview 요청이 오면 request generation으로 이전 느린 응답을 무시한다.

## 7. 상태 머신과 시간 기준

### 7.1 agent activity

| event | connection | phase | 비고 |
|---|---|---|---|
| restore stale row | disconnected | 보존 | 질문과 마지막 시각은 유지, alive=false |
| start requested | starting | idle | 새 launchId |
| spawn success | connected | idle | alive=true |
| question submitted | connected | working | sanitized optimistic question |
| substantive output | connected | working | lastOutput/Activity 갱신 |
| explicit permission/clarification prompt | connected | awaiting_user | 단순 shell prompt는 제외 |
| assistant complete/prompt ready | connected | idle | alive는 true일 수 있음 |
| intentional stop | connected | idle | alive=false, reason=user/restart/unmount |
| spawn/non-transport failure | error | idle | exit reason 보존 |
| unexpected exit/SSH transport loss | disconnected | idle | reconnect action 제공 |

침묵만으로 `awaiting_user`를 만들지 않는다. 30초/120초는 `quiet/stale` 보조 health일 뿐 phase를 거짓으로 바꾸지 않는다.

### 7.2 위키 progress

- reducer는 event `at`을 신뢰하되 역순 event는 seq로 정렬한다.
- UI elapsed time은 현재 clock으로 계산하지만 완료 run은 `endedAt-startedAt`에 고정한다.
- renderer timer는 표시만 갱신하며 persistent state를 write하지 않는다.
- backend의 기존 step timeout은 유지한다. UI stale threshold와 실행 timeout은 다른 개념이다.

## 8. 보안·개인정보·경계

### 8.1 최근 질문

- live 질문도 `packages/agents/src/redact.ts`를 main에서 재사용한다.
- redaction이 발생하면 제목은 보수적으로 `[민감한 질문]`으로 대체하고 hover에도 부분 원문을 넣지 않는다.
- DB와 event에는 `displayText + privacy`만 저장한다. raw input은 저장·로그하지 않는다.
- displayText는 길이 상한과 제어문자 제거 뒤 저장한다.

### 8.2 파일

- local root와 target 모두 native realpath 후 relative containment를 검사해 symlink escape를 거부한다.
- absolute 경로도 등록 project repo/vault 또는 검증된 active worktree 안에 있어야 한다.
- Windows↔WSL mapping은 순수 함수로 테스트하고 host platform의 `path` 해석에만 의존하지 않는다.
- SSH reader는 등록된 host/root만 사용한다. remote `realpath -e`, root `case` containment, regular file, extension, size를 remote에서 검사하고 base64로 반환한다.
- renderer가 준 root, canonical path, MIME은 신뢰하지 않는다.
- BrowserWindow는 `setWindowOpenHandler`와 navigation guard로 허용하지 않은 scheme/navigation을 차단한다.

### 8.3 PTY와 clipboard

- `pty:start/input/resize/kill` payload를 strict validation하고 project/worktree ownership, input size, cols/rows 범위를 검사한다.
- kill reason을 `user | restart | unmount | quit`로 보내 unexpected disconnect와 구분한다.
- clipboard read는 background polling하지 않고 user gesture에서만 수행한다.

## 9. IPC와 event 계약

invoke 채널:

- project: 기존 register/update payload에 goal/currentFocus와 explicit confirmation action 추가
- Task: `taskCreate`, `taskUpdate`, `taskDelete`
- note: `nextNotesList`, `nextNoteUpdate`, `nextNoteSetPinned`, `nextNoteSetLifecycle`, `nextNoteConvertToTask`
- activity: `agentActivitySnapshot`, `agentQuestionReconcile`
- wiki: `harnessListRuns`, `harnessGetProgress`, `harnessReadLog`
- files: `fileRefsResolve`, `filePreviewRead`
- terminal: `clipboardReadText`, terminal preference/diagnostic query

event 채널:

- `agent:activity` — full activity row + revision
- `harness:activity` — full `WikiRunEvent` + seq
- 기존 `harness:progress`, `harness:nodes`, `harness:engineLog`는 한 release 동안 compatibility adapter로 유지한 뒤 제거한다.

호출 성공은 mutation의 실제 저장 완료를 의미한다. 모든 mutation 응답은 최소 `{ok, reason?}`을 가지며 UI는 실패 reason을 표시한다.

## 10. 수용 기준 추적표

| ID | 수용 기준 |
|---|---|
| PC-1 | 생성·편집한 goal/focus가 재시작 뒤 동일하고 Home/전체에 보인다. AI 제안과 확정 상태가 구분된다. |
| PM-1 | Home/Board에서 Task CRUD가 가능하고 source/user-edit badge와 nextUp 정렬이 정확하다. 재-ingest가 사용자 수정·삭제를 되돌리지 않는다. |
| PM-2 | 메모 drawer에서 CRUD/완료/보관/고정/복원/Task 전환이 가능하고 legacy NextNote가 그대로 보인다. |
| AO-1 | 전체 화면에서 5상태, process alive, project/worktree, last activity/current label이 보이고 정확한 pane/run으로 이동한다. |
| Q-1 | 질문 제출/재개 직후 terminal 제목과 전체 화면이 갱신되고 transcript와 reconcile된다. project/worktree/slot 간 값이 섞이지 않는다. |
| Q-2 | secret/password/승인 입력 원문이 DB, event, DOM title, status-web에 노출되지 않는다. |
| WG-1 | worker와 node event가 live로 보이고 count/시간/stale/실패가 정확하며 재시작·run 선택 뒤 replay된다. |
| TP-1 | 4개 paste gesture가 한글·코드·경로·multiline 원문을 `term.paste()`로 전달하고 실패/위험을 알린다. |
| TM-1 | Windows 패키징 앱의 local/WSL/SSH shell에서 tmux 전후 한글·box drawing·wide glyph 정렬과 resize가 유지된다. 미지원 glyph는 진단된다. |
| FP-1 | Ctrl/Cmd-click으로 검증된 md/html/py만 현재 project/worktree 우측 panel에서 열리고 line 이동·오류 안내가 동작한다. |
| SEC-1 | traversal, symlink escape, 다른 프로젝트 경로, oversized file, SSH injection, HTML script/network가 차단된다. |
| ERR-1 | 모든 surface에 loading/empty/save failure/disconnected/interrupted 상태가 있고 실패를 조용히 삼키지 않는다. |

## 11. 테스트 전략

### 11.1 도메인·migration

- Project context provenance round-trip과 legacy backfill
- Task source producer별 값, user override, tombstone, re-ingest, project ownership
- NextNote lifecycle/pinned ordering, note→Task transaction/idempotency
- agent activity 모든 transition, revision, restart stale normalization, old launch exit race
- wiki journal seq/replay/truncated tail/atomic summary/resume continuation

### 11.2 renderer

- async dialog가 저장 성공 전 닫히지 않고 실패 값을 보존
- Task/Note mutation 뒤 관련 dashboard cache 동기화
- pane/worktree/slot별 header isolation, privacy, ellipsis/detail
- agent snapshot/event merge와 HistoryFocus/pane navigation
- paste shortcut/context menu/multiline/bracketed/error aria-live
- Unicode width/font-ready/resize adapter를 fake terminal로 검증
- wiki reducer fake clock 30초/120초, out-of-order worker, replay
- path parsing, Ctrl-only behavior, stale response, panel resize/line scroll
- Markdown escape, HTML CSP+sandbox, Python text highlighting

### 11.3 main·보안

- strict IPC와 project ownership
- local traversal/symlink/size/extension/multi-project/root precedence
- Windows drive/WSL/UNC 변환을 플랫폼 독립 fixture로 검증
- fake SSH containment/injection/timeout
- clipboard size/error 및 raw 값 logging 금지
- status-web overview 응답에 recent question이 포함되지 않는 회귀 검사

### 11.4 통합·패키징

- `pnpm typecheck`
- focused Vitest 뒤 `pnpm test`
- `pnpm qa:fixture`, `pnpm qa:electron`
- Windows x64 packaged app에서 실제 node-pty/clipboard/tmux 검증
- local Windows/WSL/등록 SSH 각각 일반 shell↔tmux 비교
- app restart 뒤 project/task/note/activity/wiki 이력 복원

## 12. 병렬 구현 전략

### 12.1 의존 관계

```text
W0 공통 계약·migration 동결 (직렬)
                 │ J0
     ┌───────────┼───────────┬───────────┐
     │           │           │           │
 A Project/PM  B Terminal   C Wiki     D File preview
     │           │           │           │
     └───────────┴───────────┴───────────┘ J1
                 │
       W2 Desktop 중앙 통합 (단일 소유자)
                 │ J2
     ┌───────────┼───────────┐
 domain QA    renderer QA   Windows/WSL/SSH QA
                 │
                Release
```

### 12.2 스트림 소유권

| 스트림 | 소유 범위 | 직접 수정하지 않는 중앙 파일 |
|---|---|---|
| W0 계약 | shared schema/DTO, DB DDL, IPC channel/type skeleton | feature UI |
| A Project/PM | ProjectRegistry, Task/Note stores/services, ProjectSidebar/PmHome/TaskBoard, 신규 editor/drawer | `App.tsx`, `WorkspaceHome.tsx`, renderer `store.ts`, 공용 CSS |
| B Terminal | activity machine/store, SessionStore v2, PtyManager, AgentTerminal/Header/Dock, paste/tmux | `App.tsx`, `WorkspaceHome.tsx`, renderer `store.ts`, 중앙 IPC wiring |
| C Wiki | RunArtifactStore, runner/drivers/service, reducer, WikiProgress/Dashboard/RunList | 중앙 IPC wiring, `App.tsx`, renderer `store.ts` |
| D File preview | parser, local/SSH resolver, preview components, ConversationHistory/MarkdownContent | 중앙 IPC wiring, `App.tsx`, renderer `store.ts` |
| W2 통합 | 아래 hot files와 cross-feature navigation/cache | feature 내부 알고리즘 |

중앙 hot files는 한 명만 소유한다.

- `apps/desktop/src/shared/ipc-contract.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/api.ts`
- `apps/desktop/src/main/container.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/renderer/store.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/components/WorkspaceHome.tsx`
- `apps/desktop/src/renderer/app.css`
- `apps/desktop/src/renderer/qa/fixture-bridge.ts`

각 feature stream은 component 전용 CSS module/file 또는 BEM block과 mock API를 사용하고, 중앙 import/wiring은 W2에서 한다.

### 12.3 합류 gate

- **J0 Contract Freeze:** schema typecheck, fresh/legacy/idempotent migration test, event JSON fixture, IPC payload compile 완료
- **J1 Feature Ready:** 각 stream focused test green, 중앙 hot file 미수정, public interface와 integration note 제출
- **J2 Integrated:** snapshot+event replay, navigation/cache, fixture bridge, full typecheck/test green
- **Release:** Windows packaged clipboard/tmux/node-pty와 local/WSL/SSH file path smoke 증거 기록

동시성은 최대 4 feature stream으로 제한한다. 조정자를 포함해 실행 슬롯이 4개라면 A/B/C를 먼저 돌리고, 가장 먼저 끝난 슬롯에서 D를 시작해 중앙 통합 담당자가 J0/J1 review를 유지한다.

## 13. 위험과 완화

- **PTY 질문 오탐:** key stream을 확정 이력으로 쓰지 않고 transcript reconcile, secure prompt 억제, 짧은 승인 제외로 완화한다.
- **상태가 실제보다 낙관적으로 보임:** process/connection/phase/health를 분리하고 silence는 경고에만 사용한다.
- **자동 Task 재수집 충돌:** `userEditedAt`과 tombstone을 producer-aware upsert에서 보존한다.
- **위키 event 폭증:** engine token마다 emit하지 않고 의미 있는 activity를 coalesce하며 UI는 capped tail과 reduced summary를 쓴다.
- **JSONL crash tail:** serial append, seq, truncated last line 무시, atomic summary로 복구한다.
- **HTML preview 탈출:** sandbox, CSP, navigation guard, renderer 직접 주입 금지의 중복 방어를 둔다.
- **Windows/WSL 경로 혼동:** namespace별 parser와 mapping을 pure test로 고정하고 main realpath를 최종 권위로 둔다.
- **CJK/Powerline font 차이:** CJK monospace preference와 glyph diagnostics를 제공하고 실제 packaged target에서 acceptance fixture를 기록한다.
- **병렬 merge 충돌:** 계약과 중앙 hot file을 단일 소유하고 feature stream은 새 모듈·props 경계 안에서 구현한다.

## 14. 구현 기록과 운영 보정

### 14.1 실행 방식

설계는 A~D stream을 병렬화할 수 있도록 계약·파일 소유권·합류 gate를 분리했다. 실제 구현은 사용자 요청에 따라 `feat/resume-recall-surface` 한 branch에서 task별 commit을 순차 적용했다. 따라서 병렬 worktree와 stream 간 handoff는 실행하지 않았고, 중앙 hot file도 같은 단일 구현자가 통합했다. 병렬 구조는 이후 분산 유지보수에 사용할 수 있는 계획으로 남긴다.

### 14.2 동결된 실제 값

| 항목 | 구현값 |
|---|---|
| 위키 event envelope | `WikiRunEvent.version = 1`, run별 단조 증가 `seq` |
| 위키 health | 30초 quiet, 120초 stalled; 둘 다 terminal 실패로 바꾸지 않음 |
| local/SSH preview | UTF-8 allowlist 파일 최대 1 MiB, opaque token TTL 60초, read 시 containment 재검증 |
| terminal paste | 최대 1 MiB, user gesture에서만 clipboard read, 원문은 비영속 |
| live question | 제어문자 제거·redaction 뒤 최대 180자만 activity에 저장 |
| xterm 폭 계산 | Unicode 11 addon과 `allowProposedApi: true`를 함께 활성화 |
| pane/PTY event | scoped `pane + launchId`, `pty:data:v2`/`pty:exit:v2`; 오래된 launch event 거부 |
| journal log 조회 | 기본 UI는 요약만 사용하고 상세 log API는 1 MiB로 제한 |

`allowProposedApi`는 xterm Unicode provider API를 쓰기 위한 필수 런타임 옵션이다. 이 옵션이 없으면 빌드는 성공해도 terminal mount 시 예외가 발생하므로 fixture와 Electron smoke에서 함께 고정한다.

### 14.3 legacy compatibility 제거 기준

- 기존 `harness:progress`, `harness:nodes`, `harness:engineLog`와 unscoped PTY start/data/exit 경로는 이번 배포의 compatibility adapter로 유지한다.
- 신규 renderer와 fixture는 `harness:activity` 및 scoped PTY v2를 권위 경로로 사용한다.
- 제거는 이 변경을 포함한 compatibility release가 배포된 뒤, 다음 release 준비 시 repository consumer 검색과 fixture/Electron smoke로 legacy consumer가 없음을 확인한 경우에만 한다.
- 제거 commit은 channel 상수, preload listener, main fan-out, renderer fallback, compatibility test를 함께 삭제한다. 일부만 먼저 제거하지 않는다.

### 14.4 migration backup과 rollback

이번 migration은 기존 table에 column/table을 더하는 단방향 additive migration이며 down migration을 제공하지 않는다.

1. upgrade 전에 앱을 완전히 종료한다.
2. Electron `app.getPath('userData')` 아래 `apc.db`와 존재하는 `apc.db-wal`/`apc.db-shm`, 그리고 `apc-harness-runs` 디렉터리를 같은 시점의 backup으로 복사한다.
3. rollback이 필요하면 새 binary에서 쓰기를 중단하고 앱을 종료한 뒤, DB와 run 디렉터리를 모두 같은 backup 세트로 복원한다.
4. 이전 binary가 추가 column을 무시할 수 있더라도 이를 rollback으로 간주하지 않는다. 지원되는 rollback은 backup 복원뿐이다.

fresh/legacy/idempotent migration과 file-DB container 재생성은 자동 test로 검증했다. 실제 사용자 DB에 대한 upgrade 전 backup은 운영 단계에서 수행해야 한다.
