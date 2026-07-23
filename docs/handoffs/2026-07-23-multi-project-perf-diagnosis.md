# 재진단 — 다중 프로젝트 사용 시 성능 저하·멈춤

- **날짜:** 2026-07-23
- **기준 브랜치:** feat/wikigen-review-redesign
- **상태:** P0~P3 코드 개선·자동 회귀 검증 완료, 동일 실부하 전·후 프로파일은 미수행
- **조사 범위:** 데스크톱 main/preload/renderer, PTY·activity·session discovery·Git 변경 조회·Dev/Wiki Harness
- **근거 수준:** 정적 코드 추적 + 실행 중 프로세스/DB 읽기 전용 스냅샷 + 합성 SQLite 벤치마크. 다중 에이전트 부하 상태의 CPU 프로파일은 아직 없음.

> §1~§7의 코드 경로와 file:line은 **수정 전 진단 기준선**을 기록한다. 현재 구현 상태와 검증 결과는 §8~§9에 따로 정리했다.

---

## 0. TL;DR

기존 문서의 핵심인 **“PTY 출력 청크마다 수행하는 작업이 많고, 살아 있는 터미널 수가 그 비용을 증폭한다”**는 진단은 맞다. 특히 다음 경로는 코드상 확정적이다.

    PTY output
      ├─ legacy + V2 PTY IPC를 모두 전송
      ├─ 동기 SQLite SELECT + UPSERT
      ├─ agentActivity IPC
      ├─ selector 없는 App 전체 구독으로 React 트리 재렌더
      └─ 대상 xterm write 뒤 fit + resize IPC + refresh 예약

다만 기존 결론의 일부는 교정해야 한다.

- “연결 수는 원인이 아니다”라고 단정할 근거는 아직 없다. 앱 자체의 청크당 증폭 경로는 강한 원인이지만, 여러 CLI 자식 프로세스의 CPU·메모리·I/O 경쟁도 함께 측정해야 한다.
- 숨긴 xterm은 활성 터미널과 **동일한 DOM 렌더 비용**을 내지 않는다. xterm 5.5의 IntersectionObserver가 실제 행 렌더를 멈춘다. 대신 출력 파싱·버퍼 갱신과 앱의 fit/resize/refresh 예약은 계속된다.
- scrollback 미설정은 병목 근거가 아니다. xterm 기본값이 이미 1000줄로 제한돼 있다.
- resumeCard는 모든 세션 본문을 파싱하지 않는다. 그러나 캐시 miss 때 모든 세션 파일을 동기 탐색·stat·prefix-read하므로 프로젝트 전환 지연 원인은 맞다.
- agent_activity 누적은 구조적 결함이지만 현재 테이블은 8행뿐이다. 현재 멈춤의 주원인으로 보기는 어렵다.
- 기존 문서에 없던 **중복 PTY IPC, 프로젝트 삭제 후 숨은 터미널 유지, Harness의 청크별 동기 파일 쓰기와 무제한 문자열 누적, progress 저널의 O(E²) 재읽기**를 추가해야 한다.

가장 먼저 할 수정은 activity 출력 이벤트를 pane별로 코얼레스하고 메모리 상태를 hot path로 쓰는 것이다. 그 다음 중복 PTY IPC 제거, 단일 IPC 라우터, Zustand 구독 분리 순서가 비용 대비 효과가 크다.

---

## 1. 기존 진단 감사 결과

| 기존 주장 | 판정 | 교정·보강 |
|---|---|---|
| 출력 청크마다 동기 SQLite SELECT+UPDATE | **확인** | 실제로 SELECT + UPSERT이며 prepare도 매 이벤트 반복한다. apps/desktop/src/main/agent-runtime-coordinator.ts:39-43, packages/pm/src/agent-activity-store.ts:73-127 |
| activity IPC마다 App 전체 재렌더 | **확인** | App.tsx의 selector 없는 useStore 구독이 원인이다. 현재 activity 8행이라 배열 정렬보다 전체 트리 재렌더가 더 중요한 비용이다. apps/desktop/src/renderer/App.tsx:30-38, store.ts:212-249 |
| 터미널 수만큼 PTY IPC 콜백이 호출됨 | **확인** | 각 AgentTerminal이 동일 V2 채널에 별도 리스너를 붙이고 JS에서 id를 거른다. AgentTerminal.tsx:175-184, preload/index.ts:27-35 |
| 숨긴 터미널도 활성 터미널과 같은 렌더 비용 | **부분 확인** | write/파싱/버퍼 및 커스텀 coordinator 비용은 남지만 xterm 내부 실제 행 렌더는 hidden 상태에서 pause된다. 동일 비용이라는 표현은 과장이다. |
| WebGL 없음과 scrollback 미설정이 문제 | **부분 확인 / scrollback 기각** | WebGL addon은 설치되지 않았고 활성 터미널 최적화 후보는 맞다. 반면 기본 scrollback은 이미 1000이라 명시만으로 성능이 좋아지지 않는다. |
| resumeCard가 3개 엔진의 모든 세션을 재파싱 | **교정** | 모든 source를 발견하지만 본문 파싱은 보통 adapter별 최신 후보 1개다. 메타데이터가 없는 후보가 이어지면 여러 본문을 파싱할 수 있다. packages/agents/src/latest-session.ts:12-29 |
| 5초 activity 전체 스윕과 영구 누적이 현재 주원인 | **우선순위 하향** | 구조는 사실이나 현재 activity는 8행이다. 장기 위생·정합성 문제이지 현재 freeze의 1차 설명은 아니다. apps/desktop/src/main/index.ts:244-250 |
| 동기 git 호출이 앱을 멈출 수 있음 | **확인, 조건부** | 주기 polling은 아니며 변경 패널 조회 시 발생한다. 큰 저장소·diff에서 최대 15초 main block 가능. project-changes.ts:105-147 |
| 원인은 연결 수가 아님 | **미입증** | 앱 hot path는 확인됐지만 다중 CLI 프로세스의 자원 경쟁을 배제하는 부하 프로파일은 아직 없다. “앱 측 확정 병목”과 “전체 증상의 유일 원인”을 구분해야 한다. |

---

## 2. 리소스가 실제로 늘어나는 방식

### 2-1. 정적 구조

- App은 최근 프로젝트 독을 최대 8개 유지한다. 단, App.tsx:242-252의 구현은 진짜 LRU가 아니라 **최초 삽입 순서 FIFO**다. 이미 열린 프로젝트를 다시 방문해도 순서가 갱신되지 않는다.
- 8개 제한은 프로젝트 수에만 적용된다. 각 프로젝트의 방문 worktree와 agent slot 수에는 명시적 상한이 없다.
- AgentWorkspaceDock은 열린 프로젝트 × 방문 worktree × slot의 AgentTerminal을 DOM에 유지하고 비활성 workspace만 display:none 처리한다. AgentWorkspaceDock.tsx:675-756.
- 각 마운트된 AgentTerminal은 독립 PTY 자식 프로세스, xterm 인스턴스, V2 data/exit IPC 리스너, ResizeObserver와 window/document 이벤트 리스너를 가진다. AgentTerminal.tsx:96-124, 175-220.
- 독을 접는 collapsed 상태도 body를 display:none으로 바꿀 뿐 terminal을 종료하지 않는다. “접기”는 자원 해제가 아니다. AgentWorkspaceDock.tsx:666.

따라서 실질 곱셈 항은 단순 프로젝트 수가 아니라 다음에 가깝다.

    살아 있는 터미널 수
    = FIFO에 남은 프로젝트
      × 각 프로젝트에서 방문한 worktree
      × 각 workspace의 agent slot

### 2-2. 2026-07-23 읽기 전용 스냅샷

아래 숫자는 한 시점의 관측값이며 부하 재현 결과가 아니다.

| 항목 | 관측값 | 해석 |
|---|---:|---|
| 현재 등록 프로젝트 | 5 | UI의 현재 프로젝트 수 |
| agent_activity | 8행 | 누적 테이블이 현재 스윕 병목일 정도로 크지는 않음 |
| process_alive activity | 4행 | activity 기준 살아 있다고 표시된 pane |
| workspace_pane_v2 was_open | 28행 / 9개 project id | 실제 live PTY 수가 아니라 영속 restore 상태 |
| 위 28행 중 삭제된 project id 소속 | 13행 | 삭제 정리 누락이 실제 데이터에 존재 |
| agent_activity의 삭제된 project 소속 | 2행 | 동일한 orphan 정합성 문제 |
| 대시보드 프로세스 트리 working set | 약 583.1 MB | Electron 계열 510.3 MB + node/codex/cmd/conhost 약 72.8 MB |
| 해당 시점 CLI 자식 | codex 1, claude 0 | freeze가 발생하는 다중 스트리밍 상태는 아니었음 |

이 스냅샷은 “activity 테이블이 현재 매우 커서 느리다”는 가설은 약화한다. 반대로 삭제된 프로젝트의 session/activity 상태가 남는다는 사실은 확인한다. 프로세스 메모리는 기준선일 뿐이며, 프로젝트 4~8개와 여러 에이전트를 동시에 실행한 상태에서 다시 측정해야 한다.

---

## 3. 확정된 주 병목: PTY 출력 hot path

### 3-1. main 프로세스에서 청크마다 발생하는 일

apps/desktop/src/main/pty-manager.ts:178-182의 child.onData는 매 청크마다 두 갈래를 모두 실행한다.

1. pty-manager.ts:262-265가 legacy ptyData와 ptyDataV2를 모두 webContents에 전송한다.
2. output lifecycle을 AgentRuntimeCoordinator에 전달한다.
3. coordinator는 store.get으로 동기 SELECT를 수행한다.
4. substantive_output transition은 매번 revision을 올리고 changed=true를 반환한다. packages/pm/src/agent-activity-machine.ts:106-111.
5. store.put이 동기 UPSERT를 수행한다.
6. 성공한 activity를 renderer로 다시 전송한다.

현재 AgentTerminal은 V2만 소비하므로 legacy ptyData는 청크마다 발생하는 불필요한 직렬화·프로세스 경계 전송이다. 결과적으로 정상 출력 청크 하나가 main에서 최소 PTY IPC 2회 + activity IPC 1회와 동기 DB 왕복을 만든다.

### 3-2. SQLite 합성 벤치마크

Windows 네이티브 Node의 node:sqlite로 임시 DB를 만들고 WAL + synchronous=FULL 조건에서 SELECT + UPSERT 1000회를 비교했다. production의 better-sqlite3 및 실제 스키마를 그대로 재현한 수치는 아니므로 절대 성능값이 아니라 방향성 근거다.

| 방식 | 1000 이벤트 | 이벤트당 |
|---|---:|---:|
| 매 이벤트 statement prepare + autocommit | 584.3 ms | 약 584 µs |
| statement cache + autocommit | 423.7 ms | 약 424 µs |
| statement cache + 단일 transaction | 9.4 ms | 약 9 µs |

statement cache만으로는 약 27% 줄었지만 transaction/coalescing 차이는 두 자릿수 배다. 즉 **prepare cache보다 출력 이벤트를 묶고 DB commit 빈도를 낮추는 것이 우선**이라는 기존 1순위는 타당하다.

### 3-3. renderer 증폭

- 모든 AgentTerminal이 같은 ptyDataV2 채널에 listener를 하나씩 등록한다. 대상이 아닌 terminal도 callback에 진입한 뒤 id를 비교한다. 비용은 O(마운트 terminal × 청크)다.
- activity IPC는 renderer store의 activities 배열을 새로 만들고 정렬한다. 현재 8행이라 정렬 자체는 작지만 selector 없는 App 전체 구독 때문에 App 셸과 하위 트리가 다시 렌더된다.
- AgentWorkspaceDock 렌더 때 각 slot이 activity 전체를 filter/reduce한다. AgentWorkspaceDock.tsx:102-118, 698-701.
- 대상 terminal은 term.write 뒤 TerminalRenderCoordinator를 예약한다. coordinator는 rAF에서 fit, PTY resize IPC, 전체 viewport refresh를 수행한다. terminal-rendering.ts:121-138.
- 프로젝트 전환 시 App이 전역 resize 이벤트를 발생시키고, 마운트된 모든 terminal이 이를 받아 coordinator를 예약한다. App.tsx:242-252, AgentTerminal.tsx:213-220.

### 3-4. hidden xterm에 대한 정확한 해석

설치된 @xterm/xterm은 5.5.0이고 기본 renderer는 DOM이다. node_modules/@xterm/xterm/src/browser/Terminal.ts:584. 다만 xterm RenderService는 IntersectionObserver로 보이지 않는 terminal의 실제 row rendering을 pause한다. node_modules/@xterm/xterm/src/browser/services/RenderService.ts:106-139. 기본 scrollback 1000은 node_modules/@xterm/xterm/src/common/services/OptionsService.ts:34에서 확인했다.

따라서 hidden terminal의 비용은 다음처럼 나눠야 한다.

- **계속 발생:** PTY 프로세스 실행, output IPC, xterm parser와 buffer write, terminal별 listener callback, 앱의 rAF 예약과 fit 치수 확인, 경우에 따른 resize IPC.
- **대체로 중단:** 화면에 행을 실제로 그리는 DOM render.
- **다시 표시할 때 발생:** 누적 buffer를 현재 viewport에 반영하는 fit/refresh.

WebGL은 활성 terminal의 그리기 비용을 줄이는 후보지만, hidden terminal의 PTY·DB·IPC 비용을 해결하지 않는다. 우선순위는 activity coalescing과 listener/구독 구조보다 뒤다.

---

## 4. 추가로 확인된 원인

### 4-1. 프로젝트 삭제가 terminal lifecycle을 끝내지 않음

main의 deleteProject handler는 registry row와 resume cache만 제거한다. apps/desktop/src/main/ipc.ts:157-161.

renderer도 프로젝트 목록을 새로 읽지만 App의 openedIds, AgentWorkspaceDock의 projectDocks·visitedPaths·slot maps를 지우지 않는다. 렌더는 projects 목록이 아니라 openedIds와 projectDocks를 기준으로 terminal을 만들기 때문에 삭제된 프로젝트의 terminal이 hidden 상태로 계속 마운트될 수 있다. App.tsx:242-252, AgentWorkspaceDock.tsx:208, 675-756, store.ts:470-480.

동시에 workspace_pane, workspace_pane_v2, agent_activity에는 project registry를 참조하는 foreign key/cascade가 없다. 실제 DB에도 orphan row가 존재했다. 이는 다음 FIFO 퇴출 또는 앱 재시작 전까지 PTY가 남을 수 있는 **실제 lifecycle leak**이다.

추가로 pendingStarts와 PtyManager.latestLaunch map도 완료/종료 시 key를 지우지 않는다. 크기는 pane id 수 수준이라 1차 병목은 아니지만 같은 cleanup 경계에서 정리해야 한다. apps/desktop/src/main/index.ts:191-219, pty-manager.ts:77-117.

### 4-2. 프로젝트 선택 시 session source 전체 동기 탐색

App은 선택 프로젝트가 바뀔 때 resumeCard를 읽고, container는 project별 cache를 둔다. cache miss 또는 ingest/mutation으로 무효화된 뒤에는 latestSessionDetail이 실행된다. apps/desktop/src/main/container.ts:289-294, 825-839.

모든 세션 본문을 파싱한다는 기존 설명은 틀렸지만, 발견 단계는 다음 동기 작업을 main 스레드에서 한다.

- Claude/Codex session 디렉터리 재귀 readdirSync
- 각 JSONL statSync
- repoPath 확인을 위해 파일마다 최대 64 KiB prefix read
- source schema 생성·정렬
- adapter별 최신 일치 후보 본문 파싱

이 머신에는 조사 시 Claude 140개와 Codex 119개, 총 259개 JSONL이 있었고 discovery prefix 대상은 약 14.7 MB였다. Windows Node로 동일한 디렉터리 순회·stat·prefix read만 warm 측정했을 때 약 117 ms였다. JSON/Zod 처리와 최신 본문 파싱은 제외한 값이다.

이는 단독으로 수 초 freeze를 증명하지는 않지만 프로젝트 전환 순간의 main-thread stutter로 충분히 관측 가능하다. project별 결과 cache만 둘 것이 아니라 **세션 메타데이터 인덱스를 엔진별로 한 번 만들고 증분 갱신**해야 한다.

### 4-3. Dev/Wiki Harness의 별도 스트리밍 병목

PTY와 별개로 Harness를 실행할 때는 또 다른 청크당 비용이 있다.

- DevHarnessService는 stdout/stderr 청크마다 appendFileSync 후 renderer IPC를 보낸다. packages/app-services/src/dev-harness-service.ts:61-64.
- DevHarnessPanel은 청크마다 setLog(prev + chunk)로 전체 누적 문자열을 복사하고 무제한으로 DOM에 보관한다. apps/desktop/src/renderer/components/DevHarnessPanel.tsx:49-55.
- CliAgentRunner는 stdout/stderr 전체를 문자열로 계속 누적한다. packages/llm-wiki/src/cli-agent-runner.ts:32-45.
- LoggingAgentRunner는 최대 바이트 제한은 있지만 제한까지 매 청크 appendFileSync한다. packages/llm-wiki/src/logging-agent-runner.ts:45-55.
- RunArtifactStore는 progress 이벤트마다 journal tail을 읽고, append 후 progress.jsonl 전체를 다시 읽어 summary를 reduce한다. 이벤트 수 E에 대해 누적 읽기·파싱량이 O(E²)다. packages/knowledge-harness/src/runtime/run-artifact-store.ts:82-130.
- StagingVault diff는 spawnSync git diff --no-index를 maxBuffer 256 MB로 실행한다. packages/knowledge-harness/src/staging/staging-vault.ts:35.

이 경로들은 해당 기능을 실행할 때만 활성화되는 조건부 병목이다. 일반 terminal streaming의 원인과 분리해서 측정해야 하지만, Harness와 여러 terminal을 함께 돌리면 main/renderer 정지가 합산될 수 있다.

### 4-4. 동기 Git 변경 조회

project-changes.ts는 git status와 diff를 execFileSync로 실행하며 각 호출 timeout이 15초다. 이는 주기 polling이 아니라 Diff/문서 변경 화면을 열거나 새로고침할 때의 이벤트성 경로다.

따라서 “여러 프로젝트를 열어 둔 것만으로 계속 발생하는 비용”은 아니지만 큰 저장소·느린 파일시스템·큰 untracked diff에서는 단독 freeze 원인이 될 수 있다. 비동기 child_process로 전환하고 중복 요청 취소 또는 최신 결과만 반영해야 한다.

### 4-5. activity 스윕과 영속 상태 누적

5초 timer는 agent_activity 전체를 list한 뒤 process_alive 항목에 다시 coordinator를 호출한다. 이 구조는 행 수가 커지면 main을 주기적으로 막는다. apps/desktop/src/main/index.ts:244-250.

하지만 현재 8행이므로 이것을 현 증상의 1차 원인으로 두면 안 된다. 올바른 처방은 다음 두 가지다.

- live pane은 메모리 map으로 추적해 silence 판정을 DB full scan과 분리한다.
- 프로젝트 삭제·pane 폐쇄·보존 기간 정책에 따라 activity와 workspace session row를 정리한다.

---

## 5. 수정 우선순위

| 우선순위 | 수정 | 구현 핵심 | 기대 효과 |
|---|---|---|---|
| P0 | **output activity coalescing** | pane별 최신 activity는 메모리에서 즉시 갱신하고 substantive_output의 DB persist/renderer emit만 250~1000 ms로 묶는다. start/question/exit/stop은 즉시 emit하고 종료·quit 때 pending 상태를 flush한다. | 청크당 동기 DB와 App 재렌더 제거 |
| P0 | **legacy PTY IPC 제거** | V2 consumer 전환이 끝났다면 ptyData/ptyExit 전송을 중단한다. 호환 기간이 필요하면 capability flag로 한 채널만 보낸다. | 청크 직렬화·IPC 절반 제거 |
| P1 | **preload 단일 PTY router** | data/exit 채널 listener를 각각 1개만 두고 id 또는 id+launchId → callback Map으로 라우팅한다. | O(T×chunk) callback을 O(chunk)로 축소 |
| P1 | **Zustand selector와 렌더 경계** | App의 useStore 전체 구독을 selector로 분해하고 activities는 실제 소비 subtree만 구독한다. AgentWorkspaceDock/terminal header의 memo와 slot별 activity index를 사용한다. | 고빈도 activity가 앱 전체를 재렌더하지 않음 |
| P1 | **삭제·퇴출 lifecycle 정리** | project 삭제 시 openedIds·dock/slot/localStorage 상태 제거, 관련 PTY kill/paneClosed, workspace_pane 계열과 agent_activity 삭제. pendingStarts/latestLaunch도 종료 시 정리한다. | 숨은 프로세스와 orphan 상태 누적 방지 |
| P1 | **terminal render scheduling 개선** | hidden이면 custom fit/resize/refresh를 예약하지 않고 표시 시 1회 실행한다. cols/rows가 실제로 바뀐 경우에만 resize IPC. 활성 terminal에는 WebGL addon을 실패 시 DOM fallback으로 검토한다. | renderer CPU·불필요 resize IPC 감소 |
| P2 | **session discovery index** | 엔진별 source metadata를 공유 cache/index로 만들고 파일 변경분만 갱신하거나 worker로 옮긴다. project별 resumeCard는 그 인덱스를 조회한다. | 프로젝트 전환 main-thread stutter 제거 |
| P2 | **Harness 스트림 bounded/batched 처리** | 파일 쓰기와 IPC를 시간/바이트 단위로 batch, renderer는 ring buffer/virtualized view 사용, runner 전체 문자열에 상한을 둔다. progress summary는 메모리 incremental reduce 후 checkpoint한다. | 긴 run에서 GC·동기 I/O·O(E²) 제거 |
| P2 | **동기 Git 비동기화** | execFileSync/spawnSync를 async process 또는 worker로 바꾸고 취소·timeout·stale result guard를 둔다. | 큰 diff에서 main freeze 방지 |
| P3 | **activity/session 보존 정책** | 오래된 dead/orphan row prune, 5초 sweep은 live map만 순회한다. | 장기 사용 시 점진 열화 방지 |

P0의 activity coalescing은 단순 debounce만 넣으면 마지막 상태 유실이나 question/exit 지연이 생길 수 있다. 이벤트 종류별 정책과 flush 테스트가 반드시 필요하다.

---

## 6. 코드 수정 전 즉시 완화

- 쓰지 않는 agent slot은 “접기”가 아니라 제거/종료한다. collapsed와 다른 프로젝트로 이동하는 것만으로는 PTY가 종료되지 않는다.
- 동시에 스트리밍하는 terminal 수를 줄인다.
- 긴 Dev/Wiki Harness 실행과 여러 PTY 스트리밍을 가능하면 겹치지 않는다.
- 큰 diff가 있는 프로젝트에서 변경 패널을 반복 새로고침하지 않는다.
- 프로젝트를 삭제한 뒤에도 프로세스가 남는 현 구조에서는 앱 재시작이 임시 정리 수단이다.

MAX_KEPT_DOCKS를 8에서 낮추는 것은 즉시 효과가 있을 수 있지만 keep-alive 경험을 희생하는 대증요법이다. 우선 P0/P1을 적용한 뒤 설정값 노출 여부를 판단하는 편이 낫다.

---

## 7. 구현 전·후 검증 기준

### 7-1. 먼저 추가할 계측

main과 renderer에 개발 모드 전용 집계를 넣는다.

- live PTY 수, terminal별 bytes/s와 chunks/s
- ptyData legacy/V2 및 agentActivity IPC/s
- activity SELECT/UPSERT 수와 소요 시간
- main event-loop delay p50/p95/max
- App과 AgentWorkspaceDock commit 횟수
- hidden/visible terminal별 fit·resize·refresh 횟수
- 프로세스 트리 CPU·working set
- resume discovery 파일 수·bytes·duration
- Harness log IPC/s, renderer log bytes, progress journal 이벤트 수/처리 시간

### 7-2. 재현 시나리오

1. 프로젝트 1개, terminal 1개 idle.
2. 프로젝트 1개, terminal 1개 고속 출력.
3. 프로젝트 4개, 프로젝트당 terminal 2개, 2개 동시 출력.
4. 프로젝트 8개와 여러 방문 worktree, 3개 이상 동시 출력.
5. 4번 상태에서 프로젝트 전환과 Diff 패널 조회.
6. 4번 상태에서 Dev 또는 Wiki Harness 동시 실행.
7. 열린 terminal이 있는 프로젝트 삭제.

각 시나리오는 같은 명령·출력량·60초 구간으로 3회 측정한다.

### 7-3. 최소 합격 조건

- substantive_output DB persist와 agentActivity emit이 pane당 설정 상한을 넘지 않는다.
- legacy PTY IPC는 0, V2 data/exit listenerCount는 채널당 1이다.
- activity 이벤트가 App 전체 commit을 만들지 않는다.
- hidden terminal에서 fit/resize/refresh가 0에 가깝고, 재표시 후 1회 정상 동기화된다.
- 동일 cols/rows에 대한 resize IPC가 발생하지 않는다.
- project 삭제 직후 관련 PTY가 종료되고 opened dock/local state 및 DB orphan row가 남지 않는다.
- resume cache miss가 UI main thread를 장시간 막지 않는다.
- 긴 Harness run에서 renderer log 메모리가 상한 안에 있고 progress 이벤트 처리 시간이 이벤트 수에 선형으로 악화되지 않는다.
- 회귀 테스트: pnpm test, pnpm typecheck와 PTY lifecycle/activity/session restore 관련 테스트를 모두 통과한다.

---

## 8. 결론과 진행 상태

**높은 확신:** 출력 청크별 동기 activity 영속화, 중복 PTY IPC, terminal별 listener fanout, selector 없는 App 구독은 실제 코드에 존재하며 동시 스트리밍 시 서로 증폭한다.

**중간 확신:** session discovery, hidden terminal coordinator, 동기 Git, Harness 로그 경로는 특정 동작 시 멈춤을 더하는 독립 병목이다.

**아직 미입증:** 이 앱 측 병목만으로 사용자가 본 모든 freeze를 설명할 수 있는지, CLI 자식 프로세스 자원 경쟁이 얼마만큼 기여하는지. 이는 위 부하 시나리오의 프로파일로 확인해야 한다.

- [x] 기존 진단 주장별 코드 대조
- [x] 실행 중 프로세스와 DB 읽기 전용 스냅샷
- [x] SQLite hot-path 합성 비교
- [x] 누락 병목과 교정 사항 문서화
- [x] P0~P3 코드 구현(활성 terminal WebGL은 계측 후 검토로 보류)
- [x] 단위·통합 회귀 테스트와 TypeScript 검사
- [ ] 시나리오 1~7의 동일 실부하 전·후 CPU/메모리/event-loop 프로파일

---

## 9. 구현 결과 (2026-07-23)

### 9-1. P0 — 출력 hot path

- `AgentRuntimeCoordinator`가 pane별 최신 상태를 메모리에 유지한다. `substantive_output`은 기본 500 ms로 코얼레스하고, start/question/stop/error/exit처럼 순서가 중요한 이벤트는 pending output을 포함한 더 새로운 revision을 즉시 저장·전송한다. 앱 종료 시 pending 상태를 flush한다.
- 5초 silence sweep은 DB 전체 `list()`가 아니라 coordinator의 live map만 순회한다.
- legacy `ptyData`/`ptyExit` 채널과 송신을 제거했다. 모든 PTY launch는 utility terminal을 포함해 `launchId`를 사용하고, renderer는 V2만 소비한다.

### 9-2. P1 — IPC·React·terminal lifecycle

- preload에 data/exit 채널당 Electron listener를 하나씩만 두고 `pane id -> callback Set`으로 라우팅한다. terminal 수에 따른 채널 callback fanout을 제거했다.
- `App` 및 관련 컴포넌트의 selector 없는 Zustand 구독을 필드별 selector로 분리했다. `AgentWorkspaceDock`은 activity를 project/worktree/slot/agent key로 한 번 index하여 slot별 전체 filter/reduce를 제거했다.
- hidden/collapsed terminal은 커스텀 fit/resize/refresh frame을 예약하지 않고, 다시 보일 때 1회 동기화한다. cols/rows가 바뀐 경우에만 resize IPC를 보낸다.
- project 삭제 시 pending start 취소, 해당 PTY kill, `workspace_pane`/`workspace_pane_v2`/`agent_activity` 삭제, renderer dock/slot/status/localStorage 정리를 하나의 lifecycle 경계에서 수행한다. 삭제된 project의 늦은 pane open/close 보고는 무시한다.
- `PtyManager.latestLaunch`와 main `pendingStarts`는 종료·실패·자연 exit에서 정리한다.

### 9-3. P2 — session·Harness·Git

- Claude/Codex JSONL의 repoPath prefix parse 결과를 file size/mtime signature로 무효화하는 4096-entry LRU에 보관한다. latest-session source listing은 adapter별 10초 TTL·single-flight cache를 사용하고, 기본 adapter instance를 공유하며 ingest 직후 무효화한다.
- Dev Harness transcript·live IPC는 50 ms 또는 64 KiB 단위로 배치한다. CLI/LLM runner가 보유하는 stdout/stderr는 stream당 기본 10 MiB로 제한하되 원본 live callback은 계속 전달한다. renderer live log는 50 ms 배치 + 256 Ki character tail로 제한한다.
- Wiki progress는 저널을 최초 1회 replay한 후 메모리 accumulator를 O(1) 갱신한다. summary는 pipeline 경계와 1/2/4/8… 이벤트에서 checkpoint하고, sidecar sequence로 stale/crash checkpoint를 감지해 필요할 때만 O(E) replay한다.
- 변경 패널의 `git status/diff`와 staging `git diff --no-index`를 async `execFile`로 전환했다. 변경 조회는 15초/32 MiB, staging diff는 60초/32 MiB 상한을 두고, 동일 project/path의 새 요청이 오면 이전 child process를 AbortSignal로 취소한다.

### 9-4. P3 — 보존 정책

- 앱 시작 시 등록에 없는 project의 session/activity 행을 제거한다.
- 30일 이상 닫힌 workspace pane과 30일 이상 비활성인 dead activity를 정리한다. `was_open=1` pane과 `process_alive=1` activity는 보존한다.

### 9-5. 검증과 보류 사항

- 코얼레싱, immediate-state supersede/flush, preload 단일 router, hidden terminal, 동일-size resize 억제, project 삭제, source cache 무효화, bounded/batched output, progress 최초 1회 read, async Git, 30일 prune에 대한 회귀 테스트를 추가했다.
- `pnpm typecheck`, `pnpm --filter @apc/desktop build`, `git diff --check`가 통과했다. 단일 Vitest 프로세스는 WSL 실행 제한 시간을 넘겨 비renderer/renderer로 분리했으며, 비renderer suite 전체와 renderer 59개 파일·379개 테스트가 모두 통과했다. 최초 전체 실행에서 발견한 배치 timer/`launchId` 기대값 2건도 수정 후 이 분할 실행에 포함해 재검증했다.
- WebGL addon은 현재 의존성에 없고 hidden terminal의 PTY/IPC 비용을 해결하지 않으므로 이번 변경에 추가하지 않았다. 활성 terminal render가 실부하 프로파일에서 남은 상위 비용일 때 DOM fallback과 함께 도입한다.
- 남은 필수 검증은 §7-2의 다중 CLI 실부하를 같은 명령·출력량으로 수정 전 build와 현 build에 각 3회 적용하는 CPU/메모리/event-loop 프로파일이다.
