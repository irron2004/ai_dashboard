# 진단 — 다중 프로젝트 사용 시 성능 저하·멈춤: 원인 사슬과 최적화 우선순위

**날짜:** 2026-07-23
**기준 브랜치:** feat/wikigen-review-redesign (진단 시점 코드 기준, 수정 미적용)
**증상:** 대시보드에서 여러 프로젝트를 열어 에이전트를 돌리면 앱이 느려지고 간헐적으로 멈춘다.
**범위:** `apps/desktop/src/main` (PTY·IPC·DB), `apps/desktop/src/renderer` (App 셸·AgentWorkspaceDock·AgentTerminal), `packages/pm` (agent-activity)

---

## 0. 요약 (TL;DR)

원인은 "연결이 많아서"가 아니다. **터미널 출력 청크 1개당 앱이 하는 일이 너무 많고, 그 비용이 살아있는 터미널 수에 비례해 곱해지는 구조**가 원인이다.

출력 청크 1개마다: 메인 프로세스가 **동기 SQLite SELECT+UPDATE**를 실행하고(이벤트 루프 블록), 렌더러에서는 **마운트된 모든 터미널의 IPC 리스너**가 호출되며, activity IPC가 **App 트리 전체 리렌더**를 일으킨다. 터미널은 최근 8개 프로젝트 × 방문 worktree × 슬롯만큼 전부 살아있다(`display:none` keep-alive).

→ **개선 1번(출력 이벤트 스로틀) 하나만으로도 청크당 DB 쓰기·IPC·전체 리렌더가 사라져 체감이 크게 달라진다.** 1~4번이 본 처방, 5~6번은 위생 처방이다.

---

## 1. 무엇이 쌓이는가 — 프로젝트를 열 때 생기는 리소스

서비스(`Container`, DB, HarnessService 등)는 전부 **윈도우 싱글턴**이라 프로젝트 수와 무관하다 (`apps/desktop/src/main/index.ts:43`, `container.ts:273`). 프로젝트 수에 비례해 늘어나는 것은 다음뿐이다.

| 리소스 | 스케일 | 근거 |
|---|---|---|
| PTY 자식 프로세스 (claude/codex/opencode, ssh 포함) | 최근 **8개** 프로젝트 × 방문 worktree × 슬롯 | `App.tsx:26` `MAX_KEPT_DOCKS = 8`, `pty-manager.ts:161` |
| 마운트된 `<AgentTerminal>` (숨김 포함) | 위와 동일 — `display:none`으로 유지, 언마운트 안 됨 | `AgentWorkspaceDock.tsx:675-756`, `:690` |
| 터미널당 `ipcRenderer.on(ptyDataV2)`·`ptyExitV2` 리스너 | 터미널 수만큼 | `AgentTerminal.tsx:175-179`, `preload/index.ts:27-31` |
| `agent_activity` 테이블 행 | pane당 1행, **삭제 코드 없음 — 재시작 후에도 영구 누적** | `packages/pm/src/agent-activity-store.ts` (delete/prune 부재) |

- worktree·슬롯 수에는 상한이 없다. 9번째 프로젝트를 열면 가장 오래된 프로젝트가 FIFO로 언마운트되고, 이때 PTY는 정상적으로 정리된다(`AgentTerminal.tsx:244` → `killPty`).
- keep-alive는 의도된 설계다("재방문 시 CLI 재로딩 방지", `App.tsx:24-25`). 문제는 keep-alive 자체가 아니라, **숨겨진 터미널도 활성 터미널과 같은 비용을 계속 낸다**는 점이다.
- 파일 워처·주기적 git 폴링은 존재하지 않음(확인 완료). 앱 전체에 `setInterval`은 2개뿐이다(§3).

---

## 2. 핵심 진단 — 출력 청크 1개당 일어나는 일 (freeze의 원인 사슬)

에이전트가 출력을 한 번 뿜을 때마다 아래가 전부 실행된다.

### 2-1. 메인 프로세스: 청크당 동기 SQLite 2회 + IPC 3회

```
child.onData (pty-manager.ts:178-182)
 ├─ emitData → webContents.send × 2  (ptyData + ptyDataV2, pty-manager.ts:262-265)
 └─ onLifecycle({type:'output'})
     → AgentRuntimeCoordinator.handle (agent-runtime-coordinator.ts:37-45)
        ├─ store.get(paneId)   ← 동기 SQLite SELECT
        ├─ transitionAgentActivity — substantive_output은 항상 changed:true
        │                            (agent-activity-machine.ts:106-111, 스로틀 없음)
        ├─ store.put(...)      ← 동기 SQLite UPDATE
        └─ emit → webContents.send(agentActivity)
```

- better-sqlite3는 완전 동기다(`sqlite-shim.ts:9-29`). **청크 속도 그대로 메인 프로세스 이벤트 루프가 블록**되며, 메인 프로세스는 모든 IPC·PTY 중계를 담당하므로 이 순간 다른 터미널의 입출력도 함께 밀린다.
- 에이전트 N개가 동시에 스트리밍하면 이 비용은 N배가 된다. "간헐적 멈춤"의 1차 용의자.

### 2-2. 렌더러: 리스너 팬아웃 O(터미널 × 청크)

- 메인은 단일 윈도우에 브로드캐스트하고(`index.ts:188`), **각 터미널이 자기 리스너에서 id를 비교해 걸러낸다**(`AgentTerminal.tsx:177`). 터미널 20개가 마운트돼 있으면 청크 1개에 콜백 20번.
- 리스너 10개 초과 시 Node `MaxListenersExceededWarning` 영역에 이미 들어와 있다.

### 2-3. 렌더러: activity IPC → App 전체 리렌더

- `App.tsx:31-38`은 **셀렉터 없는 `useStore()` 전체 구독**이라 스토어의 어떤 `set()`에도 App이 리렌더된다.
- `mergeAgentActivity`(`store.ts:247-249`)가 activity IPC마다 새 배열을 만들고 전체 재정렬(`store.ts:212-225`) → **App 트리 전체(사이드바·독·메인 패널) 리렌더**.
- `AgentWorkspaceDock`·`MainPanel`·`AgentTerminal` 어디에도 `React.memo`가 없고, 렌더마다 슬롯별 `activityForAgentSlot` filter+reduce가 다시 돈다(`AgentWorkspaceDock.tsx:701`, `:108-118`). 합치면 **O(이벤트 × 슬롯 × activity 수)**.

### 2-4. 렌더러: xterm이 최저 성능 구성

- addon은 Fit·Unicode11뿐 — **WebGL/canvas 렌더러 없음 = 가장 느린 DOM 렌더러** (`AgentTerminal.tsx:103-110`, `package.json:36`).
- `scrollback` 미설정(기본 1000줄), 숨겨진 터미널도 계속 버퍼에 write하고 청크마다 rAF fit/resize/refresh를 재무장한다(`AgentTerminal.tsx:166-170`, `terminal-rendering.ts:121-138`). resize는 `resizePty` IPC를 메인으로 되쏜다.
- 독/사이드바 리사이즈는 `window 'resize'`를 dispatch하는데(`AgentWorkspaceDock.tsx:224`), 이것이 **마운트된 모든 터미널**의 fit/refresh로 팬아웃된다(`AgentTerminal.tsx:217-222`).

---

## 3. 부차 요인 (지속 비용·누적 비용)

1. **5초 silence 스윕** (`index.ts:244-251`) — 5초마다 `agent_activity` **전체 테이블 동기 스캔**(`agent-activity-store.ts:81`, LIMIT 없음) + 살아있는 pane당 SELECT 1회를 메인 스레드에서 실행. pane 수·행 수에 비례.
2. **`agent_activity` 영구 누적** — 행을 지우는 코드가 없어 지금까지 만든 모든 pane의 행이 남는다. 위 스윕·시작 시 `normalizeStartup()`(`agent-activity-store.ts:158-165`)이 전체를 훑으므로 **오래 쓸수록 조금씩 무거워진다.**
3. **동기 git 호출** — `project-changes.ts:105-147`의 status/diff가 `execFileSync`(15s 타임아웃)로 메인을 블록. 주기 폴링은 아니고 GitSyncPanel 마운트·worktree 변경 시 이벤트성으로 실행되지만, 큰 diff에서는 그 자체로 멈춤 체감.
4. 기타 소소: `resumeCard`는 호출마다 3개 엔진 세션 전체 재파싱(`container.ts:289-290`, 캐시로 완화됨), `resumeCardCache`·renderer 스토어 맵 무제한 성장(실질 영향 작음).

앱 전체에서 `setInterval`은 위 5초 스윕과 WikiProgress의 1초 시계(`WikiProgress.tsx:69`, 정리 정상) 2개뿐이다. 즉 **주기 폴링은 범인이 아니고, 이벤트당 비용 구조가 범인**이다.

---

## 4. 개선 우선순위

| # | 개선 | 내용 | 기대 효과 | 변경 규모 |
|---|---|---|---|---|
| 1 | **output 이벤트 스로틀** | `pty-manager.ts` 또는 coordinator에서 pane당 `substantive_output`을 ~1초 코얼레스 (마지막 emit 시각 비교) | 청크당 동기 DB 쓰기·activity IPC·전체 리렌더 제거. **최소 변경·최대 효과** | 소 |
| 2 | **Zustand 셀렉터 + memo** | `App.tsx` 전체 구독 해체, `activities`는 소비 컴포넌트만 구독. `AgentWorkspaceDock`·`MainPanel` 등에 `React.memo`, `activityForAgentSlot`·정렬 `useMemo` | activity·로그 이벤트가 관련 컴포넌트만 리렌더 | 중 |
| 3 | **PTY 리스너 단일화** | preload에 `ptyDataV2`·`ptyExitV2` 채널 리스너 각 1개 + `id → callback` Map 라우팅 | 팬아웃 O(터미널×청크) → O(청크), MaxListeners 경고 해소 | 소 |
| 4 | **xterm 렌더링** | `@xterm/addon-webgl` 도입(실패 시 DOM 폴백), `scrollback` 명시(예: 1000~2000), 숨김(`display:none`) 터미널은 write 버퍼링만 하고 fit/refresh 스킵 → 표시 시 1회 refresh | 스트리밍 중 렌더러 CPU 대폭 절감 | 중 |
| 5 | **agent_activity 위생** | 시작 시 오래된 dead 행 prune, silence 스윕은 DB 대신 메모리 캐시(살아있는 pane만) 순회 | 장기 사용 시 점진 열화 제거, 5초 블록 제거 | 소 |
| 6 | **git 비동기화** | `project-changes.ts`의 `execFileSync` → `execFile`(async) | 큰 diff·느린 저장소에서 메인 블록 제거 | 소 |

보조 옵션: `MAX_KEPT_DOCKS`를 설정값으로 노출(8 → 4로 낮추면 즉시 완화되지만, keep-alive 이점을 깎는 대증요법이므로 1~4 이후 판단).

**코드 수정 없이 지금 당장 완화하려면:** 안 쓰는 슬롯·worktree 패널을 닫아 둔다(살아있는 터미널 수 = 곱셈 항이 직접 줄어든다).

---

## 5. 검증 방법 (수정 시)

1. **재현 기준선:** 프로젝트 4~8개 열고 에이전트 2~3개 동시 스트리밍 상태에서 DevTools Performance 녹화 + 메인 프로세스 CPU 관찰.
2. 개선 1 적용 후: 스트리밍 중 `agentActivity` IPC 빈도가 pane당 ~1Hz인지, App 리렌더 횟수가 청크와 무관해졌는지 React DevTools Profiler로 확인.
3. 개선 3 적용 후: `ptyDataV2` 채널의 `listenerCount`가 1인지 확인.
4. 회귀 게이트: `pnpm test`, `pnpm typecheck` (특히 `ipc.test.ts`, `App.test.tsx`, activity machine 테스트).

---

## 6. 진행 상태

- [x] 원인 조사·코드 확인 (본 문서)
- [ ] 개선 1~6 구현 — **미착수.** 착수 시 `feat/wikigen-review-redesign` 위가 아니라 별도 브랜치/worktree로 분리할 것 (해당 브랜치에 미커밋 변경 존재, 워크스페이스 §3 규칙).
