# 프로젝트 컨텍스트·실시간 작업 UX Implementation Plan

> 이 계획은 `docs/superpowers/specs/2026-07-20-project-context-and-live-ux-design.md`를 구현하는 실행 문서다. 각 작업은 checkbox 단위로 추적하며, 병렬 stream에서 별도 branch/worktree를 사용할 수 있도록 경계를 정의한다. 실제 실행 방식은 아래 기록을 따른다.

**Goal:** 프로젝트 목표·Task·메모, agent activity·최근 질문, 위키 실시간 진행, 안전한 terminal paste·`tmux` 렌더링, 대화 파일 preview를 영속적이고 project/worktree-safe한 한 UX로 구현한다.

**Architecture:** 공통 schema/IPC/event 계약과 idempotent migration을 먼저 동결한다. 이후 A(Project/PM), B(Terminal), C(Wiki), D(File preview) 네 stream을 격리된 파일 소유권으로 병렬 구현한다. `ipc.ts`, `App.tsx`, renderer store 같은 hot file은 마지막 중앙 통합에서 한 명만 수정한다.

**Tech Stack:** TypeScript 5.5, Electron 31, React 18.3, Zustand 4.5, SQLite, Zod, xterm 5.5, node-pty, Vitest 2, Playwright/Electron fixture QA.

**Status:** 구현·자동 검증·Windows x64 package 생성 완료. Packaged app의 WSL/SSH tmux와 실제 paste 제스처 수동 acceptance는 남아 있다.

**Execution:** 병렬화 가능한 A~D 소유권은 유지했지만, 실제 작업은 사용자 요청대로 한 branch에서 task별 commit을 순차 적용했다. 병렬 branch/worktree 생성과 stream handoff 항목은 아래에 미실행으로 남긴다.

## 구현 결과와 증적

| 범위 | 대표 commit | 결과 |
|---|---|---|
| 문서·계약·migration·IPC | `d620356`~`848e5e0` | shared/DB/IPC 계약과 idempotent migration 완료 |
| Project/Task/Note | `567c963`~`85fdfa3` | context provenance, Task CRUD/tombstone, Note lifecycle/Task 전환 UI 완료 |
| Activity/질문/paste/tmux | `a2d15d3`~`e5ac6e5`, `070162f` | pane/launch isolation, privacy, paste controller, Unicode 11/font/resize 완료 |
| Wiki progress | `39fc609`~`e4d83d4` | journal, worker/node event, replay UI 완료 |
| File preview | `af19ee6`~`2a5d135` | parser, local/SSH boundary, sandbox preview, Ctrl/Cmd-click 완료 |
| Desktop 통합 | `b5e7c6f`~`cbf42bb` | main/renderer wiring, cache/revision/seq guard 완료 |
| 자동 QA | `17735d3`, `1514b3e`, `27998c5` | fixture, file-DB restart, privacy/security/race 검증 완료 |
| Windows package | `29b3e1d` | full package와 Windows Electron smoke 통과; 수동 packaged matrix는 일부 남음 |

최종 자동 결과:

- `pnpm typecheck`: 통과
- `pnpm test`: 1,396 passed, 2 skipped
- `pnpm qa:fixture`: 15 passed, Windows-only 1 skipped
- Windows 네이티브 `pnpm --filter @apc/desktop qa:electron`: 1 passed
- Windows x64 unpacked/portable/NSIS 생성과 Electron·native module PE 검사: 통과

패키징 후 최종 환경 감사:

- 위 `pnpm test` 수치는 Windows packaging 전에 WSL에서 실행한 전체 suite 결과이며 이 구현의 기준 회귀 증적이다.
- packaging workflow가 `node_modules`를 Windows ABI 상태로 만든 뒤 WSL에서 다시 실행한 `pnpm test`는 Linux Rollup optional binary가 없어 test 수집 전에 중단됐다. Windows native module 상태를 보존하기 위해 재설치하지 않았다.
- 참고로 Windows 네이티브 전체 Vitest는 1,376 passed, 11 failed, 11 skipped였다. 실패는 Unix 전용 fake SSH path/newline filename/`chmod` fixture와 Windows git timeout/file-lock/path-separator 차이에 한정됐다. Windows release gate는 별도 Electron smoke로 통과했다.

Acceptance 상태:

| ID | 상태 | 핵심 증적 |
|---|---|---|
| PC-1 | 완료 | registry/context component와 file-DB restart test |
| PM-1 | 완료 | Task CRUD/provenance/re-ingest/tombstone service·UI test |
| PM-2 | 완료 | Note lifecycle/transaction/idempotency/drawer test |
| AO-1 | 완료 | activity machine/store/list와 pane navigation test |
| Q-1 | 완료 | live capture/reconcile/header/worktree isolation test |
| Q-2 | 완료 | redaction test와 실제 DB/vault byte scan |
| WG-1 | 완료 | journal/reducer/fake-clock/replay/restart test |
| TP-1 | 자동 완료·수동 일부 남음 | 네 shortcut·우클릭·원문·bracketed/error test와 Windows clipboard smoke; packaged gesture 관찰 필요 |
| TM-1 | 부분 완료 | Unicode 11/env/font/resize 자동 test와 Windows PTY smoke; packaged WSL/SSH tmux 관찰 필요 |
| FP-1 | 완료 | parser/local/SSH/renderer/Ctrl-click/stale response test |
| SEC-1 | 완료 | traversal/symlink/TOCTOU/SSH injection/HTML sandbox test |
| ERR-1 | 완료 | fixture와 component/main failure-state test |

상세 Windows 증적과 미검증 범위는 `docs/handoffs/2026-07-20-project-context-live-ux-windows-qa.md`에 기록한다.

## 0. 실행 규칙

### 0.1 명령과 품질 gate

- 모든 명령은 repo root `ai_dashboard-main/`에서 실행한다.
- focused test → package/area test → `pnpm typecheck` → `pnpm test` 순서로 넓힌다.
- renderer fixture 변경 뒤 `pnpm qa:fixture`, Electron seam 변경 뒤 `pnpm qa:electron`을 실행한다.
- Windows package는 `build-apc-windows-from-wsl` skill 지침을 읽고 해당 workflow로 검증한다.
- migration은 fresh/legacy/idempotent 세 경우를 모두 테스트한다.
- mutation handler는 strict payload, project ownership, stable `{ok, reason?}` 오류 계약을 가진다.
- raw question, clipboard text, password, HTML body를 log/snapshot에 넣지 않는다.
- 자동 retry, 상태 추정, file access 범위를 테스트 없이 늘리지 않는다.

### 0.2 branch와 병렬 일정

권장 branch/worktree:

| 단계 | branch | 실행 |
|---|---|---|
| W0 | `feat/context-live-contract` | 직렬, 통합 담당자 |
| A | `feat/context-pm` | W0 뒤 병렬 |
| B | `feat/terminal-live-ux` | W0 뒤 병렬 |
| C | `feat/wiki-live-progress` | W0 뒤 병렬 |
| D | `feat/conversation-file-preview` | W0 뒤 병렬 |
| W2 | `feat/context-live-integration` | A~D 합류 뒤 직렬 |

동시 실행 슬롯이 조정자 포함 4개라면:

1. 조정자가 W0을 완료한다.
2. A/B/C를 동시에 시작한다.
3. 먼저 끝난 슬롯에서 D를 시작한다.
4. 조정자는 J0/J1 review와 integration branch 준비를 담당한다.

### 0.3 파일 소유권

W0/W2 통합 담당자만 다음 파일을 수정한다. feature stream에서 변경이 필요하면 patch 요구사항만 전달한다.

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
- `apps/desktop/src/main/ipc.test.ts`

Feature UI는 새 component와 component 전용 CSS 파일에 고립한다. 공용 CSS import는 W2에서 한다.

### 0.4 합류 산출물

각 stream은 merge 전에 다음을 남긴다.

- public exports와 integration에 필요한 props/callback 목록
- 실행한 focused test와 결과
- migration 또는 fixture 영향
- 중앙 hot file에 필요한 wiring 목록
- 남은 known limitation

---

## Wave 0 — 공통 계약과 migration 동결

### Task F0: 기준선과 작업 범위 고정

**Files:**

- Read: `TODO.md`
- Read: spec 문서
- Read: 현재 `packages/shared`, core/PM migration, desktop IPC/export 구조

**Steps:**

- [ ] 미실행(순차 실행으로 대체): 새 contract branch/worktree가 깨끗한지 확인한다.
- [x] `pnpm typecheck`와 관련 기존 test를 실행해 시작 baseline을 기록한다.
- [x] TODO 열 항목을 spec acceptance ID `PC/PM/AO/Q/WG/TP/TM/FP/SEC/ERR`와 대조한다.
- [x] 기존 미커밋 변경이 있으면 사용자 변경과 겹치지 않는지 확인하고 그대로 보존한다.

**Verify:**

```bash
git status --short
pnpm typecheck
npx vitest run packages/core packages/pm apps/desktop/src/main apps/desktop/src/renderer/components/AgentTerminal.test.tsx
```

이 작업은 코드 commit을 만들지 않는다.

### Task F1: shared schema와 순수 계약 추가

**Files:**

- Modify: `packages/shared/src/schema.ts`
- Modify: `packages/shared/src/kh-schema.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/agent-activity.ts`
- Create: `packages/shared/src/wiki-run-event.ts`
- Create: `packages/shared/src/file-reference.ts`
- Test: 대응하는 `*.test.ts`

**Produces:**

- Project provenance/confirmation 필드
- Task source/timestamps/user edit/tombstone
- NextNote lifecycle 확장
- `AgentPaneIdentity`, `AgentActivity`
- `WikiRunEvent`, `WikiProgressSummary`
- parsed/resolved file reference와 preview DTO

**Steps:**

- [x] legacy object를 parse하는 실패 test부터 작성한다.
- [x] optional wire field + normalized domain default를 구분한다.
- [x] event discriminated union과 schema version `1`을 고정한다.
- [x] activity의 connection/phase/processAlive를 분리하고 5상태 파생 함수를 순수 함수로 만든다.
- [x] file extension/size kind 계약을 shared에 두되 filesystem 접근 코드는 두지 않는다.
- [x] package export와 type-only 소비 test를 추가한다.

**Verify:**

```bash
npx vitest run packages/shared
pnpm typecheck
```

**Commit:** `feat(shared): define context and live UX contracts`

### Task F2: idempotent DB migration 추가

**Files:**

- Modify: `packages/core/src/db.ts`
- Modify: `packages/core/src/project-registry.ts`
- Modify: `packages/pm/src/migrate.ts`
- Modify: `apps/desktop/src/main/session-store.ts`
- Test: `packages/core/src/db.test.ts`
- Test: `packages/core/src/project-registry.test.ts`
- Test: `packages/pm/src/migrate.test.ts`
- Test: `apps/desktop/src/main/session-store.test.ts`

**Steps:**

- [x] legacy projects DB에서 goal/focus가 user-confirmed로 보존되는 실패 test를 쓴다.
- [x] task source backfill prefix와 timestamp default를 fixture로 고정한다.
- [x] next_notes의 updated/pinned/archive/conversion column을 반복 추가해도 안전하게 만든다.
- [x] `agent_activity` table을 만든다. raw question column은 만들지 않는다.
- [x] `workspace_pane_v2`를 paneId PK로 만들고 legacy `(project,agent)`를 main worktree `<agent>-1`로 1회 이관한다.
- [x] migration을 두 번 실행한 뒤 row/count/schema가 같은지 검증한다.

**Verify:**

```bash
npx vitest run packages/core/src/db.test.ts packages/core/src/project-registry.test.ts packages/pm/src/migrate.test.ts apps/desktop/src/main/session-store.test.ts
pnpm typecheck
```

**Commit:** `feat(storage): migrate project task note and activity data`

### Task F3: IPC 채널·payload와 renderer client skeleton 동결

**Files (W0 단일 소유):**

- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/api.ts`
- Test: `apps/desktop/src/shared/ipc-contract.test.ts` 또는 기존 contract test

**Steps:**

- [x] spec §9의 invoke/event channel을 추가한다.
- [x] project/task/note mutation은 renderer가 ID/provenance를 보내지 못하는 좁은 DTO로 정의한다.
- [x] PTY payload에 pane identity, launchId, kill reason을 넣고 data/exit event에도 launchId를 추가한다.
- [x] `onAgentActivity`, `onHarnessActivity` event unsubscribe API를 preload에 추가한다.
- [x] clipboard API는 text/plain, explicit invoke 결과 `{ok,text?,reason?}`만 노출한다.
- [x] feature stream이 mock 없이 import 가능한 `api` wrapper를 추가한다. handler 구현은 W2로 미룬다.
- [x] legacy harness event API는 compatibility 기간 동안 유지한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/shared
pnpm typecheck
```

**Commit:** `feat(desktop): freeze live UX IPC contracts`

### Gate J0: contract freeze

- [x] F1~F3 commit을 integration base에 순서대로 합친다.
- [x] schema/event JSON fixture review를 수행한다.
- [x] fresh/legacy/idempotent migration이 모두 green이다.
- [ ] 미실행(순차 실행으로 대체): A~D stream이 동일 SHA에서 branch한다.
- [x] 이후 shared/IPC 계약 변경은 통합 담당자만 수행한다.

---

## Stream A — Project context, Task, Note

### Task A1: Project context 저장·확정 service

**Depends:** J0

**Files:**

- Modify: `packages/core/src/project-registry.ts`
- Test: `packages/core/src/project-registry.test.ts`
- Create: `apps/desktop/src/renderer/components/ProjectContextFields.tsx`
- Test: `apps/desktop/src/renderer/components/ProjectContextFields.test.tsx`
- Modify: `apps/desktop/src/renderer/components/ProjectSidebar.tsx`
- Test: `apps/desktop/src/renderer/components/ProjectSidebar.context.test.tsx`

**Steps:**

- [x] registry에서 agent proposal, user edit, explicit confirm 전이를 테스트한다.
- [x] confirmed user value를 agent proposal이 덮지 못하게 한다.
- [x] `INSERT OR REPLACE`를 conflict-update로 바꿔 project 수정 시 `project_source_map` cascade 손실이 없음을 테스트한다.
- [x] sidebar callback을 async result로 바꾸고 saving/inline error 동안 dialog를 유지한다.
- [x] callback의 context 인자는 W2 전까지 optional trailing 인자로 두어 integration 전 branch도 typecheck되게 한다.
- [x] goal textarea/currentFocus input과 provenance badge/confirm action을 추가한다.
- [x] 공백 normalization, cancel, double-submit을 검증한다.

**Verify:**

```bash
npx vitest run packages/core/src/project-registry.test.ts apps/desktop/src/renderer/components/ProjectSidebar.context.test.tsx apps/desktop/src/renderer/components/ProjectContextFields.test.tsx
```

**Commit:** `feat(projects): edit and confirm project context`

### Task A2: Task CRUD, provenance, 재-ingest 보호

**Files:**

- Modify: `packages/pm/src/task-store.ts`
- Test: `packages/pm/src/task-store.test.ts`
- Modify: `packages/app-services/src/task-extractor.ts`
- Test: `packages/app-services/src/task-extractor.test.ts`
- Modify: `packages/pm/src/review-service.ts`
- Test: `packages/pm/src/review-service.test.ts`
- Create: `packages/pm/src/task-command-service.ts`
- Test: `packages/pm/src/task-command-service.test.ts`

**Steps:**

- [x] manual create/update/soft-delete와 project ownership 실패 test를 쓴다.
- [x] derived upsert가 source/sourceRef를 명시하고 user-owned fields를 보존하게 한다.
- [x] tombstone과 같은 sourceRef가 다시 들어와도 list에 부활하지 않는 test를 추가한다.
- [x] source에서 사라진 자동 row의 정리 조건을 테스트한다.
- [x] extractor/review producer가 각각 conversation/review source를 기록하도록 한다.
- [x] list/nextUp 입력에서 tombstone을 제외한다.

**Verify:**

```bash
npx vitest run packages/pm/src/task-store.test.ts packages/pm/src/task-command-service.test.ts packages/app-services/src/task-extractor.test.ts packages/pm/src/review-service.test.ts packages/dashboard-api
```

**Commit:** `feat(pm): add user-safe task CRUD and provenance`

### Task A3: Note lifecycle과 atomic Task 전환

**Files:**

- Modify: `packages/pm/src/next-note-store.ts`
- Test: `packages/pm/src/next-note-store.test.ts`
- Create: `packages/pm/src/note-task-service.ts`
- Test: `packages/pm/src/note-task-service.test.ts`
- Modify: `packages/pm/src/index.ts`

**Steps:**

- [x] edit, pin order, complete, archive, restore와 archived-over-completed 표시 우선순위를 테스트한다.
- [x] 기존 toggleDone API가 compatibility wrapper로 같은 결과를 내게 한다.
- [x] note→Task를 transaction으로 구현하고 중간 실패 rollback test를 추가한다.
- [x] 같은 note 재전환이 기존 task를 반환하는지 검증한다.
- [x] converted task가 사용자 삭제된 경우의 정책을 `이미 전환됨`으로 고정하고 reason을 반환한다.

**Verify:**

```bash
npx vitest run packages/pm/src/next-note-store.test.ts packages/pm/src/note-task-service.test.ts
```

**Commit:** `feat(pm): expand project notes and task conversion`

### Task A4: PM feature UI를 격리 구현

**Files:**

- Create: `apps/desktop/src/renderer/components/TaskEditorDialog.tsx`
- Test: `apps/desktop/src/renderer/components/TaskEditorDialog.test.tsx`
- Create: `apps/desktop/src/renderer/components/ProjectNotesDrawer.tsx`
- Test: `apps/desktop/src/renderer/components/ProjectNotesDrawer.test.tsx`
- Create: `apps/desktop/src/renderer/components/project-context-pm.css`
- Modify: `apps/desktop/src/renderer/components/PmHome.tsx`
- Test: `apps/desktop/src/renderer/components/PmHome.test.tsx`
- Modify: `apps/desktop/src/renderer/components/TaskBoard.tsx`
- Test: `apps/desktop/src/renderer/components/TaskBoard.test.tsx`
- Modify: `apps/desktop/src/renderer/components/ResumeBanner.tsx`
- Test: `apps/desktop/src/renderer/components/ResumeBanner.test.tsx`

**Steps:**

- [x] editor CRUD, validation, due date, failure rollback을 test-first로 구현한다.
- [x] Task card에 source와 user-edited badge, edit/complete/delete action을 추가한다.
- [x] `nextUp`에는 기존 `nextUp()` 함수만 사용한다.
- [x] drawer에 active/completed/archived filter와 pin/edit/delete/convert action을 구현한다.
- [x] ResumeBanner 문구를 메모로 명확히 하고 legacy note를 같은 drawer에서 보이게 한다.
- [x] component는 `onChanged`, `onOpenTask` callback만 노출하고 `App.tsx`를 수정하지 않는다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/components/TaskEditorDialog.test.tsx apps/desktop/src/renderer/components/ProjectNotesDrawer.test.tsx apps/desktop/src/renderer/components/PmHome.test.tsx apps/desktop/src/renderer/components/TaskBoard.test.tsx apps/desktop/src/renderer/components/ResumeBanner.test.tsx
pnpm typecheck
```

**Commit:** `feat(desktop): add project task and note controls`

### Gate A

- [x] registry/task/note persistence test green
- [x] automatic producer regression green
- [x] UI가 중앙 hot file을 수정하지 않음
- [ ] 미실행(순차 통합으로 대체): W2에 필요한 project/task/note handler와 refresh 목록 전달

---

## Stream B — Agent activity, recent question, paste, tmux

### Task B1: Activity state machine과 persistent store

**Depends:** J0

**Files:**

- Create: `packages/pm/src/agent-activity-machine.ts`
- Test: `packages/pm/src/agent-activity-machine.test.ts`
- Create: `packages/pm/src/agent-activity-store.ts`
- Test: `packages/pm/src/agent-activity-store.test.ts`
- Modify: `packages/pm/src/question-log-store.ts`
- Test: `packages/pm/src/question-log-store.test.ts`
- Modify: `packages/pm/src/index.ts`

**Steps:**

- [x] spec §7.1의 transition table을 fake clock test로 고정한다.
- [x] silence는 phase가 아니라 staleSince만 바꾸는지 검증한다.
- [x] processAlive=true legacy row를 startup에서 disconnected로 바꾼다.
- [x] revision compare-and-update로 오래된 event를 거부한다.
- [x] sanitized last question만 저장하고 latestForSession/latestByProject query를 추가한다.

**Verify:**

```bash
npx vitest run packages/pm/src/agent-activity-machine.test.ts packages/pm/src/agent-activity-store.test.ts packages/pm/src/question-log-store.test.ts
```

**Commit:** `feat(pm): persist truthful agent activity`

### Task B2: Pane v2와 PTY launch race 제거

**Files:**

- Modify: `apps/desktop/src/main/session-store.ts`
- Test: `apps/desktop/src/main/session-store.test.ts`
- Modify: `apps/desktop/src/main/pty-manager.ts`
- Test: `apps/desktop/src/main/pty-manager.resume.test.ts`
- Create: `apps/desktop/src/main/pty-manager.lifecycle.test.ts`
- Create: `apps/desktop/src/main/agent-runtime-coordinator.ts`
- Test: `apps/desktop/src/main/agent-runtime-coordinator.test.ts`

**Steps:**

- [x] paneId/project/worktree/slot/agent/session restore를 검증한다.
- [x] PtyManager map을 `{launchId, pty, identity}`로 바꾼다.
- [x] old launch의 data/exit가 current launch를 삭제하거나 상태를 바꾸지 않는 race test를 쓴다.
- [x] start/spawn/output/prompt/stop/error/disconnect를 coordinator event로 연결한다.
- [x] kill reason별 intentional/unexpected 종료를 구분한다.
- [x] strict size/resize validation에 필요한 pure guard를 노출한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/main/session-store.test.ts apps/desktop/src/main/pty-manager.resume.test.ts apps/desktop/src/main/pty-manager.lifecycle.test.ts apps/desktop/src/main/agent-runtime-coordinator.test.ts
```

**Commit:** `feat(desktop): track pane identity and PTY lifecycle`

### Task B3: Live question capture와 privacy reconciliation

**Files:**

- Create: `apps/desktop/src/renderer/terminal-question-buffer.ts`
- Test: `apps/desktop/src/renderer/terminal-question-buffer.test.ts`
- Create: `apps/desktop/src/main/live-question-service.ts`
- Test: `apps/desktop/src/main/live-question-service.test.ts`
- Modify: `packages/agents/src/redact.ts`
- Test: `packages/agents/src/redact.test.ts`
- Modify: `apps/desktop/src/main/conversation-history.ts`
- Test: `apps/desktop/src/main/conversation-history.test.ts`

**Steps:**

- [x] IME printable input, backspace, Enter, paste, arrow/control input을 buffer fixture로 고정한다.
- [x] password/secure prompt와 한 글자 y/n 승인을 capture하지 않는다.
- [x] main에서 redact 후 변경이 있으면 전체 title을 `[민감한 질문]`으로 숨긴다.
- [x] max length/control character 정책을 적용하고 raw를 logger에 전달하지 않는다.
- [x] optimistic activity 질문 뒤 transcript session/exchange로 reconcile한다.
- [x] resume 때 session latest question을 복원한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/terminal-question-buffer.test.ts apps/desktop/src/main/live-question-service.test.ts packages/agents/src/redact.test.ts apps/desktop/src/main/conversation-history.test.ts
```

**Commit:** `feat(desktop): capture and reconcile private terminal questions`

### Task B4: 안전한 clipboard와 paste controller

**Files:**

- Create: `apps/desktop/src/renderer/terminal-paste-controller.ts`
- Test: `apps/desktop/src/renderer/terminal-paste-controller.test.ts`
- Modify: `apps/desktop/src/renderer/components/AgentTerminal.tsx`
- Test: `apps/desktop/src/renderer/components/AgentTerminal.test.tsx`
- Create: `apps/desktop/src/renderer/components/TerminalContextMenu.tsx`
- Test: `apps/desktop/src/renderer/components/TerminalContextMenu.test.tsx`

**Steps:**

- [x] Ctrl+V/Ctrl+Shift+V/Shift+Insert/Cmd+V가 하나의 callback을 호출하는 test를 쓴다.
- [x] 우클릭 Copy/Paste가 같은 controller를 사용하게 한다.
- [x] 한글, 코드, Windows/WSL 경로, trailing newline을 변경 없이 `term.paste()`에 전달한다.
- [x] multiline + bracketed mode off에서 confirm 전 전송하지 않는다.
- [x] empty/permission/oversize/read error를 aria-live notice로 표시한다.
- [x] selection copy rejection도 조용히 삼키지 않는다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/terminal-paste-controller.test.ts apps/desktop/src/renderer/components/AgentTerminal.test.tsx apps/desktop/src/renderer/components/TerminalContextMenu.test.tsx
```

**Commit:** `feat(terminal): support safe native clipboard paste`

### Task B5: tmux Unicode·환경·resize 안정화

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/src/renderer/terminal-rendering.ts`
- Test: `apps/desktop/src/renderer/terminal-rendering.test.ts`
- Create: `apps/desktop/src/main/pty-environment.ts`
- Test: `apps/desktop/src/main/pty-environment.test.ts`
- Modify: `apps/desktop/src/main/pty-manager.ts`
- Modify: `apps/desktop/src/renderer/components/AgentTerminal.tsx`
- Create: `apps/desktop/src/renderer/components/terminal.css`

**Steps:**

- [ ] 남은 수동 QA: 실제 packaged terminal에서 tmux 전후 fixture(`TERM`, `locale charmap`, 한글/box/wide/color, resize 증상)를 수집한다.
- [x] `@xterm/addon-unicode11`을 추가하고 active Unicode version을 11로 고정한다.
- [x] local/WSL/SSH별 env builder가 UTF-8 값을 보존하고 `TERM=xterm-256color`, `COLORTERM=truecolor`를 설정하는 test를 쓴다.
- [x] 지원되지 않는 remote locale은 억지로 덮지 않고 diagnostic result를 만든다.
- [x] CJK monospace font preference와 installed-font/glyph diagnostic UI contract를 구현한다.
- [x] font ready, dock show, window resize, tmux pane split/reattach에서 rAF-debounced fit→resize→refresh를 실행한다.
- [x] repeated resize와 disposed terminal race를 테스트한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/main/pty-environment.test.ts apps/desktop/src/renderer/terminal-rendering.test.ts apps/desktop/src/renderer/components/AgentTerminal.test.tsx
pnpm typecheck
```

**Commit:** `fix(terminal): preserve Unicode rendering inside tmux`

### Task B6: Terminal header와 activity presentation components

**Files:**

- Modify: `apps/desktop/src/renderer/components/AgentDockHeader.tsx`
- Test: `apps/desktop/src/renderer/components/AgentDockHeader.test.tsx`
- Modify: `apps/desktop/src/renderer/components/AgentWorkspaceDock.tsx`
- Test: `apps/desktop/src/renderer/components/AgentWorkspaceDock.test.tsx`
- Create: `apps/desktop/src/renderer/components/AgentActivityList.tsx`
- Test: `apps/desktop/src/renderer/components/AgentActivityList.test.tsx`
- Create: `apps/desktop/src/renderer/components/agent-activity.css`

**Steps:**

- [x] 질문 없음/visible/masked/hidden header를 테스트한다.
- [x] long title ellipsis와 sanitized detail을 구현한다.
- [x] 같은 agent의 다른 worktree/slot title이 섞이지 않는 test를 추가한다.
- [x] 5상태, process indicator, stale warning, last activity/current label을 순수 props component로 만든다.
- [x] row click은 pane identity/run target callback만 호출하고 `App.tsx`를 수정하지 않는다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/components/AgentDockHeader.test.tsx apps/desktop/src/renderer/components/AgentWorkspaceDock.test.tsx apps/desktop/src/renderer/components/AgentActivityList.test.tsx
pnpm typecheck
```

**Commit:** `feat(desktop): show live agent state and recent question`

### Gate B

- [x] activity transition/race/privacy test green
- [x] paste 원문이 log/store에 남지 않음
- [x] tmux fixture와 packaged QA 절차를 W2에 전달
- [x] `AgentTerminal` 단일 stream 소유로 paste/tmux/activity conflict 없음

---

## Stream C — Wiki live progress와 replay

### Task C1: Run event journal과 reducer

**Depends:** J0

**Files:**

- Modify: `packages/knowledge-harness/src/runtime/run-artifact-store.ts`
- Test: `packages/knowledge-harness/src/runtime/run-artifact-store.test.ts`
- Create: `packages/knowledge-harness/src/runtime/wiki-progress-reducer.ts`
- Test: `packages/knowledge-harness/src/runtime/wiki-progress-reducer.test.ts`
- Modify: `packages/knowledge-harness/src/index.ts`

**Steps:**

- [x] serial append, monotonic seq, restart continuation test를 작성한다.
- [x] 마지막 JSONL line이 잘렸을 때 이전 event까지 replay하는지 검증한다.
- [x] summary temp+rename과 journal→summary rebuild를 구현한다.
- [x] worker/node/retry counts와 terminal status reduction을 fixture로 고정한다.
- [x] pre-dedupe proposal을 final accepted/dropped로 reconcile한다.

**Verify:**

```bash
npx vitest run packages/knowledge-harness/src/runtime/run-artifact-store.test.ts packages/knowledge-harness/src/runtime/wiki-progress-reducer.test.ts
```

**Commit:** `feat(harness): persist wiki progress event journal`

### Task C2: Runner·worker lifecycle event 계측

**Files:**

- Modify: `packages/knowledge-harness/src/runtime/harness-runner.ts`
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts`
- Test: `packages/knowledge-harness/src/runtime/folder-workers.test.ts`
- Add/modify: paper driver 관련 test

**Steps:**

- [x] phase started/completed/failed를 state write와 같은 순서로 emit한다.
- [x] work_planned와 worker started/completed/failed를 병렬 out-of-order fixture로 검증한다.
- [x] node_discovered를 worker batch 완료 전 proposal 단위로 emit한다.
- [x] paper single-shot flow도 total=1과 terminal event를 보장한다.
- [x] 구현되지 않은 retry/reconnect event가 발생하지 않는 negative test를 추가한다.
- [x] event sink 실패가 run 결과를 손상하지 않되 diagnostic에 남도록 정책을 고정한다.

**Verify:**

```bash
npx vitest run packages/knowledge-harness/src/runtime/folder-workers.test.ts packages/knowledge-harness/src/runtime
```

**Commit:** `feat(harness): emit worker and node lifecycle events`

### Task C3: HarnessService 연결·조회·resume

**Files:**

- Modify: `packages/app-services/src/harness-service.ts`
- Test: `packages/app-services/src/harness-service.test.ts`
- Test: `packages/app-services/src/harness-service.fanout.test.ts`
- Test: `packages/app-services/src/harness-service.workspace.test.ts`
- Test: `packages/app-services/src/harness-service.interactive.e2e.test.ts`

**Steps:**

- [x] runId/store를 workspace pull보다 먼저 만들고 초기 실패도 journal에 남긴다.
- [x] run/resume/confirm 모두 같은 event sink를 사용한다.
- [x] EngineLogEvent에 runId를 보존하고 active run filtering을 가능하게 한다.
- [x] listRuns/getProgress/readLog service를 만들고 log size를 cap한다.
- [x] nonterminal + active job 없음의 interrupted summary를 반환한다.
- [x] runId path를 `resolveInside`로 검증한다.

**Verify:**

```bash
npx vitest run packages/app-services/src/harness-service.test.ts packages/app-services/src/harness-service.fanout.test.ts packages/app-services/src/harness-service.workspace.test.ts packages/app-services/src/harness-service.interactive.e2e.test.ts
```

**Commit:** `feat(app-services): replay persisted wiki progress`

### Task C4: Wiki progress UI와 fake-clock health

**Files:**

- Create: `apps/desktop/src/renderer/wiki-progress-state.ts`
- Test: `apps/desktop/src/renderer/wiki-progress-state.test.ts`
- Modify: `apps/desktop/src/renderer/components/WikiProgress.tsx`
- Test: `apps/desktop/src/renderer/components/WikiProgress.test.tsx`
- Modify: `apps/desktop/src/renderer/components/WikiGenDashboard.tsx`
- Test: `apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx`
- Modify: `apps/desktop/src/renderer/components/HarnessRunList.tsx`
- Test: `apps/desktop/src/renderer/components/HarnessRunList.test.tsx`
- Create: `apps/desktop/src/renderer/components/wiki-progress.css`

**Steps:**

- [x] snapshot+journal+live event를 같은 reducer로 처리한다.
- [x] 30초 quiet, 120초 stalled, interrupted, terminal elapsed를 fake clock으로 테스트한다.
- [x] worker count와 node list를 별도 label로 표시한다.
- [x] logs는 기본 collapsed이고 open 시에만 capped API callback을 호출한다.
- [x] run 선택/restart replay와 stale async response guard를 구현한다.
- [x] reconnecting은 실제 event가 있을 때만 표시한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/wiki-progress-state.test.ts apps/desktop/src/renderer/components/WikiProgress.test.tsx apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx apps/desktop/src/renderer/components/HarnessRunList.test.tsx
pnpm typecheck
```

**Commit:** `feat(desktop): render replayable wiki worker progress`

### Gate C

- [x] journal crash/restart/out-of-order test green
- [x] run/resume/confirm/paper 모두 terminal event 보유
- [x] renderer localStorage가 진행 이력의 권위가 아님
- [ ] 미실행(순차 통합으로 대체): W2에 event emitter/query wiring 목록 전달

---

## Stream D — Conversation file reference와 preview

### Task D1: 순수 file reference tokenizer

**Depends:** J0

**Files:**

- Expand: `packages/shared/src/file-reference.ts`
- Test: `packages/shared/src/file-reference.test.ts`

**Steps:**

- [x] Markdown destination, inline code, quoted, bare 우선순위를 fixture로 고정한다.
- [x] POSIX/relative/Windows drive/WSL/UNC, `:line[:col]`, optional `#L`을 테스트한다.
- [x] 공백·한글·균형 괄호와 trailing punctuation을 처리한다.
- [x] drive colon을 line suffix로 오인하지 않는다.
- [x] URL/mailto/unsupported extension/fenced code 정책을 명시한다.
- [x] source range가 원문을 정확히 재구성하는 property-style test를 추가한다.

**Verify:**

```bash
npx vitest run packages/shared/src/file-reference.test.ts
```

**Commit:** `feat(shared): parse conversation file references`

### Task D2: Local/Windows/WSL resolver와 read boundary

**Files:**

- Create: `apps/desktop/src/main/file-preview.ts`
- Test: `apps/desktop/src/main/file-preview.test.ts`
- Reuse/read: `apps/desktop/src/main/project-files.ts`
- Reuse/read: `apps/desktop/src/main/conversation-history.ts`

**Steps:**

- [x] session workspace → active worktree → primary repo/vault root precedence를 테스트한다.
- [x] renderer-provided worktree를 actual git worktree list로 검증한다.
- [x] root/target native realpath와 relative containment로 traversal/symlink escape를 막는다.
- [x] Windows↔WSL/UNC mapping을 platform-independent pure functions로 만든다.
- [x] regular file/extension/1MiB/UTF-8를 검증한다.
- [x] resolve token 뒤 파일 교체/경로 변경을 가정해 read 시 다시 검증하는 TOCTOU test를 추가한다.
- [x] 동일 상대경로를 가진 두 project가 섞이지 않는 test를 쓴다.

**Verify:**

```bash
npx vitest run apps/desktop/src/main/file-preview.test.ts apps/desktop/src/main/project-files.test.ts
```

**Commit:** `feat(desktop): resolve project-scoped preview files`

### Task D3: SSH file preview reader

**Files:**

- Create: `apps/desktop/src/main/remote-file-preview.ts`
- Test: `apps/desktop/src/main/remote-file-preview.test.ts`
- Reuse/read: `apps/desktop/src/main/ssh-exec.ts`
- Reuse/read: `apps/desktop/src/main/remote-docs.ts`

**Steps:**

- [x] 등록 SSH project/root 외 host/path를 거부한다.
- [x] base64-framed input과 `bash -s`로 shell injection을 막는다.
- [x] remote realpath/root case containment/regular file/extension/size를 remote script에서 검증한다.
- [x] multiline base64, 한글 path/content, timeout/connection failure를 테스트한다.
- [x] reason에는 secret이나 전체 command를 포함하지 않는다.

**Verify:**

```bash
npx vitest run apps/desktop/src/main/remote-file-preview.test.ts apps/desktop/src/main/remote-docs.test.ts
```

**Commit:** `feat(desktop): read scoped SSH file previews`

### Task D4: 안전한 preview renderer

**Files:**

- Create: `apps/desktop/src/renderer/components/FilePreviewPanel.tsx`
- Test: `apps/desktop/src/renderer/components/FilePreviewPanel.test.tsx`
- Create: `apps/desktop/src/renderer/components/PythonCodePreview.tsx`
- Test: `apps/desktop/src/renderer/components/PythonCodePreview.test.tsx`
- Create: `apps/desktop/src/renderer/components/SandboxedHtmlPreview.tsx`
- Test: `apps/desktop/src/renderer/components/SandboxedHtmlPreview.test.tsx`
- Create: `apps/desktop/src/renderer/components/file-preview.css`

**Steps:**

- [x] panel open/close/Escape/280~720 resize/width preference/stale response를 test-first로 구현한다.
- [x] Markdown은 raw HTML escape를 유지하고 local links를 resolver callback으로 돌린다.
- [x] Python은 text tokenization, line numbers, target scroll/highlight를 구현한다.
- [x] HTML srcDoc 선두에 CSP를 삽입하고 `sandbox=""`/no-referrer 속성을 검증한다.
- [x] script/network/form/popup 문자열 fixture가 권한을 얻지 못하는지 DOM test를 추가한다.
- [x] HTML line target은 Source tab을 기본으로 한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/components/FilePreviewPanel.test.tsx apps/desktop/src/renderer/components/PythonCodePreview.test.tsx apps/desktop/src/renderer/components/SandboxedHtmlPreview.test.tsx
```

**Commit:** `feat(desktop): render sandboxed file previews`

### Task D5: Conversation text와 reference interaction

**Files:**

- Create: `apps/desktop/src/renderer/components/FileReferenceText.tsx`
- Test: `apps/desktop/src/renderer/components/FileReferenceText.test.tsx`
- Modify: `apps/desktop/src/renderer/components/MarkdownContent.tsx`
- Test: `apps/desktop/src/renderer/components/MarkdownContent.test.tsx`
- Modify: `apps/desktop/src/renderer/components/ConversationHistoryView.tsx`
- Test: `apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx`
- Modify: `apps/desktop/src/main/conversation-history.ts`

**Steps:**

- [x] question disclosure와 reference control을 분리해 nested interactive element를 없앤다.
- [x] normal click은 기존 동작, Ctrl/Cmd-click과 keyboard action만 open callback을 호출하게 한다.
- [x] batch resolve 뒤 검증된 range만 affordance를 표시한다.
- [x] unresolved/read failure는 원문을 보존하고 reason을 알린다.
- [x] ConversationSession에 main이 검증한 session workspace hint를 추가한다.
- [x] Markdown local link도 같은 resolver/read 경계를 재사용한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/components/FileReferenceText.test.tsx apps/desktop/src/renderer/components/MarkdownContent.test.tsx apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx apps/desktop/src/main/conversation-history.test.ts
pnpm typecheck
```

**Commit:** `feat(history): open scoped file references from conversations`

### Gate D

- [x] parser platform/path matrix green
- [x] local/SSH containment와 TOCTOU test green
- [x] HTML CSP/sandbox/navigation test green
- [ ] 미실행(순차 통합으로 대체): W2에 panel mount와 IPC handler wiring 목록 전달

---

## Wave 2 — 중앙 desktop 통합

W2는 A~D branch를 먼저 합친 integration branch에서 한 명이 수행한다. conflict를 feature branch로 되돌려 보내지 않는다.

### Task I1: Container와 main handler 연결

**Files (단일 소유):**

- Modify: `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc.test.ts`
- Add focused main integration tests as needed

**Steps:**

- [x] project/task/note service를 container에 주입하고 mutation ownership/cache invalidation을 연결한다.
- [x] activity store/coordinator를 PtyManager lifecycle과 연결하고 snapshot/event를 보낸다.
- [x] live question redaction/reconcile와 clipboard read를 연결한다.
- [x] wiki list/progress/log handler와 versioned event emitter를 연결한다.
- [x] file resolve/read local/SSH handler를 연결하고 read-time 재검증한다.
- [x] pty event payload strict validation, size/resize limits, launchId filtering을 적용한다.
- [x] BrowserWindow navigation/window-open guard를 설치한다.
- [x] handler 성공/실패/persistence restart test를 파일 DB로 검증한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/main
pnpm typecheck
```

**Commit:** `feat(desktop): wire context and live UX services`

### Task I2: Renderer store, App, WorkspaceHome 결합

**Files (단일 소유):**

- Modify: `apps/desktop/src/renderer/store.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/WorkspaceHome.tsx`
- Test: `apps/desktop/src/renderer/components/WorkspaceHome.test.tsx`
- Modify: `apps/desktop/src/renderer/app.css` only for imports/global layout
- Import feature CSS files

**Steps:**

- [x] store에 activity snapshot/event revision merge와 active worktree/pane target을 결합한다.
- [x] project goal/context summary, AgentActivityList, recent questions를 WorkspaceHome에 조립한다.
- [x] activity row는 정확한 pane/run으로, question row는 HistoryFocus 또는 live pane으로 이동한다.
- [x] notes drawer toolbar와 `Ctrl/Cmd+Shift+N`을 연결한다.
- [x] FilePreviewPanel을 conversation surface 오른쪽에 mount하고 resize layout을 연결한다.
- [x] run selection 시 wiki progress snapshot replay를 요청한다.
- [x] project 전환 중 stale response가 현재 state를 덮지 않는 test를 추가한다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer/components/WorkspaceHome.test.tsx apps/desktop/src/renderer/App.test.tsx apps/desktop/src/renderer
pnpm typecheck
```

**Commit:** `feat(desktop): integrate project and live work surfaces`

### Task I3: Mutation refresh와 compatibility adapter

**Files:**

- Modify: `apps/desktop/src/renderer/store.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/main/container.ts`
- Modify: harness compatibility event wiring
- Test: focused cache/event tests

**Steps:**

- [x] project mutation 뒤 project list/dashboard/workspace가 같은 revision을 보게 한다.
- [x] task/note mutation 뒤 dashboard/resume/workspace cache를 한 orchestration에서 갱신한다.
- [x] activity snapshot 이후 더 낮은 revision event를 무시한다.
- [x] wiki snapshot 이후 더 낮은 seq event를 무시한다.
- [x] legacy harness progress/nodes/log consumer가 한 release 동안 동작하는 adapter를 유지한다.
- [x] status-web overview에 recent question이 추가되지 않았는지 assertion을 넣는다.

**Verify:**

```bash
npx vitest run apps/desktop/src/renderer packages/dashboard-api packages/status-web
pnpm typecheck
```

**Commit:** `fix(desktop): synchronize live UX caches and events`

### Task I4: Fixture와 Electron seam 갱신

**Files (단일 소유):**

- Modify: `apps/desktop/src/renderer/qa/fixture-data.ts`
- Modify: `apps/desktop/src/renderer/qa/fixture-bridge.ts`
- Modify: renderer fixture tests/snapshots
- Modify: `apps/desktop/e2e/electron/smoke.spec.ts`

**Steps:**

- [x] user/agent-confirmed project, 모든 Task source, note lifecycle fixture를 추가한다.
- [x] activity 5상태와 visible/masked question fixture를 추가한다.
- [x] active/quiet/stalled/completed/failed wiki run fixture를 추가한다.
- [x] md/html/py와 rejected path fixture를 추가한다.
- [x] clipboard는 실제 OS clipboard test와 fake failure test를 분리한다.
- [x] PTY event에 launchId/pane identity가 포함되는 smoke를 갱신한다.

**Verify:**

```bash
pnpm qa:fixture
pnpm qa:electron
```

**Commit:** `test(desktop): cover context and live UX fixtures`

### Gate J2: 통합 완료

- [x] `pnpm typecheck` green
- [x] `pnpm test` green
- [x] `pnpm qa:fixture` green
- [x] `pnpm qa:electron` green 또는 플랫폼상 skip 사유 기록
- [x] TODO acceptance ID별 자동 test evidence 표 작성

---

## Wave 3 — 보안·패키징·실사용 QA

### Task Q1: 저장·재시작 복구 시나리오

- [x] project goal/focus를 저장하고 app/container 재생성 뒤 확인한다.
- [x] manual/edited/deleted automatic Task가 재-ingest 뒤 정확한지 확인한다.
- [x] active/completed/archived/pinned note와 converted Task를 복원한다.
- [x] 살아 있던 activity가 restart 뒤 disconnected로 보이고 question은 sanitized 상태로 남는지 확인한다.
- [x] 완료/실패/interrupted wiki run을 run list에서 선택해 journal replay한다.

**Verify:** 새 file-DB integration test + `pnpm test`

**Commit:** `test(integration): verify persisted live UX recovery`

### Task Q2: 보안과 race adversarial test

- [x] old PTY launch late exit/data
- [x] activity snapshot/event revision 역전
- [x] wiki event seq 역전·truncated tail
- [x] secret 질문/password/clipboard raw logging
- [x] path traversal/symlink swap/다른 project/oversize/unsupported extension
- [x] SSH command injection/timeout
- [x] HTML script/fetch/form/popup/top navigation
- [x] stale preview/project-switch response

**Verify:** focused security tests + `pnpm test`

**Commit:** `test(security): harden terminal progress and preview boundaries`

### Task Q3: Windows x64 packaged acceptance

**Prerequisite:** `build-apc-windows-from-wsl` skill을 읽고 그대로 실행한다.

**Target matrix (`✓`는 필수 acceptance이며 관찰 완료 표시가 아님):**

| Surface | Windows local | WSL path/shell | registered SSH |
|---|---:|---:|---:|
| 한글 single-line paste | ✓ | ✓ | ✓ |
| code/path/multiline bracketed paste | ✓ | ✓ | ✓ |
| Ctrl+V/Ctrl+Shift+V/Shift+Insert/right-click | ✓ | ✓ | ✓ |
| clipboard failure notice | ✓ | N/A | N/A |
| tmux 한글/box/wide/color | 가능한 환경 | 필수 | 필수 |
| tmux resize/split/detach/attach | 가능한 환경 | 필수 | 필수 |
| Windows/WSL/relative file Ctrl-click | ✓ | ✓ | ✓ |
| md/html/py preview와 line jump | ✓ | ✓ | ✓ |

**Steps:**

- [ ] 남은 수동 QA: 일반 shell과 tmux에서 동일 fixture의 screenshot/text observation을 기록한다.
- [ ] 남은 수동 QA: Powerline glyph 미설치 환경에서 diagnostic이 표시되는지 확인한다.
- [ ] 남은 수동 QA: packaged app을 종료·재실행해 데이터와 run progress를 확인한다.
- [x] clipboard/question/file content가 log에 남지 않았는지 검사한다.
- [x] 실패한 항목은 platform/locale/font/remote 설정과 앱 bug를 구분해 기록한다.

이 작업은 검증 결과와 필요한 fix를 별도 commit으로 남긴다.

### Task Q4: 문서·TODO 마감

**Files:**

- Modify: `TODO.md`
- Modify: 이 spec/plan의 status 및 implementation corrections
- Add: 필요 시 QA evidence 문서

**Steps:**

- [x] 자동 test와 packaged evidence가 있는 acceptance만 `[x]`로 바꾼다.
- [x] 부분 구현을 완료로 표시하지 않는다.
- [x] 실제 threshold/schema/IPC가 spec과 달라졌으면 correction을 먼저 기록한다.
- [x] legacy channel 제거 시점과 migration rollback/backup 지침을 기록한다.

**Verify:**

```bash
git diff --check
rg -n '^[- ]*\[ \]' TODO.md docs/superpowers/plans/2026-07-20-project-context-and-live-ux.md
```

**Commit:** `docs(todo): record context and live UX completion evidence`

## 최종 Definition of Done

- [ ] `TM-1` packaged 관찰 대기: 전체 acceptance ID 각각 test 또는 packaged QA evidence가 있다.
- [x] 기존 프로젝트/Task/NextNote/run/session 데이터가 migration 뒤 손실되지 않는다.
- [x] 자동 데이터 출처와 사용자 확정·수정 상태가 UI와 persistence에서 일치한다.
- [x] app restart가 활동·위키 이력을 거짓 `작업 중`으로 복원하지 않는다.
- [x] recent question raw secret과 clipboard content가 desktop DB/log/status-web에 없다.
- [x] 파일 preview가 프로젝트/worktree/SSH 경계를 벗어나지 않고 HTML이 실행 권한을 얻지 않는다.
- [ ] 남은 수동 QA: Windows packaged app에서 node-pty, paste, tmux, WSL path를 실제로 검증한다.
- [x] 모든 hot file이 단일 통합 소유자에 의해 합쳐졌고 unresolved merge marker가 없다.
- [x] `pnpm typecheck`, `pnpm test`, fixture QA, 가능한 Electron QA가 green이다.
