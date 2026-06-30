# Spec — SP3: 에이전트 헤더 실행 아이콘 (▶ 시작/재시작 · ⏹ 중지)

**날짜:** 2026-06-30
**상태:** 설계(spec). 승인 후 writing-plans로 분기.
**상위 맥락:** 사용자의 ai_dashboard 니즈 — ① 프로젝트 빠른 전환 ② 이전 요청+남은 작업 시각화(작업↔위키 그래프). 분해된 3개 sub-project 중 **SP3(빠른 실행/전환 아이콘)** = 가장 작고 독립적인 즉각 개선. (SP1 작업 자동 캡처 · SP2 작업↔위키 그래프 뷰는 후속 spec.)
**결정 사항(브레인스토밍):** 실행 대상 = 프로젝트 에이전트 세션 · 아이콘 위치 = 에이전트 헤더(접근법 A) · ▶ 기본 동작 = 최신 세션 resume("이어서").

---

## 1. 배경 / 문제

desktop 앱은 **이미** 프로젝트별 멀티에이전트 터미널 dock을 갖고 있다(`apps/desktop/src/renderer/App.tsx` ~L346–394): 선택한 프로젝트의 `AGENTS`(claude/codex/opencode)를 나란히 렌더, 각 패널은 마운트 시 PTY를 spawn/resume, 상태 dot·Shift 단축키 제공. 사용자 불만 = **"실행 버튼이 없고, (있어도) 아이콘이 아니다"** — 에이전트 헤더가 텍스트(`claude`)+수동 상태 dot이라, 세션을 명시적으로 **시작/재시작/중지**하는 한 클릭 아이콘이 없다.

즉 엔진은 완비돼 있고, 빠진 것은 **UX 어포던스(실행 아이콘)** 하나다.

### 이미 존재하는 빌딩블록 (신규 구현 불필요)
- PTY IPC: `api.startPty / writePty / killPty / resizePty / onPtyData / onPtyExit` (`apps/desktop/src/renderer/api.ts` L30–35, L173–177). **`killPty` 이미 존재 → 중지 IPC 신규 불필요.**
- `pty-manager`(main, `src/main/pty-manager.ts`): `sessions: Map<id, IPty>`; `start(id,…)`는 **같은 id의 기존 세션을 먼저 kill 후 재spawn**(L85–86) → 재시작이 내장; `kill(id)`(L127–129).
- `AgentTerminal`(`src/renderer/components/AgentTerminal.tsx`): props `{ sessionId, command, args, cwd, agent, resumeSessionId, onStatus, onActivate }`; 마운트 useEffect에서 spawn; 상태 `idle|running|attention|done` 보고; `resumeSessionId` = `null`(최신 resume) | `undefined`(fresh).
- store(`src/renderer/store.ts`): `agentStatus: Record<key, AgentRunStatus>`(L33), `openPanes`(L35), `setAgentStatus(key,status)`(L173).
- 세션 키 규약: `` `${projectId}:${agent}` ``.

---

## 2. 목표 / 비목표

**목표:** dock의 각 에이전트 헤더에 **▶(시작/재시작) · ⏹(중지)** 아이콘 버튼을 추가해, 에이전트 세션 실행을 그 자리에서 한 클릭 아이콘으로 제어한다. 기존 상태 dot은 유지.

**In:**
- 헤더 아이콘 버튼 ▶/⏹ (접근성 `aria-label`).
- ▶ = 정지 상태면 시작(최신 세션 resume), 실행 중이면 재시작(pty-manager가 같은 id 자동 kill+respawn).
- ⏹ = 실행/attention일 때만 활성, 누르면 세션 kill → 상태 idle.
- store 세션 단위 제어(`restartNonce`, `restartAgent`, `stopAgent`).
- `AgentTerminal`이 외부 재시작 신호(nonce)에 반응해 재spawn.

**Out (후속/범위 외):**
- SP1(에이전트 세션 → Task 자동 캡처), SP2(작업↔위키 그래프 뷰).
- 사이드바 프로젝트별 실행 아이콘(접근법 B) — 본 spec은 헤더(A)만.
- fresh-vs-resume 토글 UX(▶은 항상 resume-latest; fresh 시작은 YAGNI).
- 새 PTY IPC(killPty 재사용).

---

## 3. 아키텍처

신규 엔진 없음. 데이터 흐름:

```
▶ 클릭 → store.restartAgent(key)  → restartNonce[key]++
        → <AgentTerminal restartNonce>  effect deps 변경 → cleanup(이전 xterm/리스너 dispose) → re-spawn
        → api.startPty({ id:key, command, cwd, resume })  → pty-manager.start (같은 id kill+respawn)
        → onPtyData 스트림 → onStatus('running') → dot 갱신

⏹ 클릭 → store.stopAgent(key)  → api.killPty({ id:key })
        → pty-manager.kill  → onPtyExit  → onStatus → setAgentStatus(key,'idle')
```

핵심: **▶는 AgentTerminal의 재spawn 경로를 통과**(nonce), **⏹는 killPty 직접 호출 후 기존 onPtyExit가 상태 정리**(AgentTerminal 변경 최소).

---

## 4. 컴포넌트 / 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/renderer/store.ts` | `restartNonce: Record<string, number>` 상태 추가(기본 `{}`). `restartAgent(key)` = nonce 1 증가. `stopAgent(key)` = `api.killPty({ id: key })` 호출 + `setAgentStatus(key,'idle')`. |
| `src/renderer/components/AgentTerminal.tsx` | props에 `restartNonce?: number` 추가. spawn useEffect의 deps에 `restartNonce` 포함 → 값이 바뀌면 cleanup(기존 PTY는 같은 id로 재spawn 시 pty-manager가 kill; xterm/IPC 리스너는 effect cleanup에서 dispose) 후 재spawn. 다른 동작 불변. |
| `src/renderer/App.tsx` (에이전트 헤더, ~L369–381) | 상태 dot 앞에 `▶`/`⏹` `<button>` 2개 추가. ▶ onClick=`restartAgent(key)`, ⏹ onClick=`stopAgent(key)` (`key = `${pid}:${a}``). ⏹은 `statusOf(pid,a) ∈ {running,attention}`일 때만 enabled. 헤더 행 클릭(setAgent) 동작 보존 — 버튼은 `e.stopPropagation()`. `<AgentTerminal>`에 `restartNonce={restartNonce[`${pid}:${a}`] ?? 0}` 전달. |

새 IPC·새 컴포넌트 없음. 아이콘은 유니코드(`▶`/`⏹`) 또는 소형 인라인 SVG; 버튼은 `aria-label`("에이전트 시작/재시작", "에이전트 중지").

---

## 5. 동작 규칙 (상태 매핑)

| 현재 상태 | ▶ 동작 | ⏹ 활성 |
|---|---|---|
| `idle`(미시작/중지됨) | 시작 — 최신 세션 resume(`resumeSessionId` 기존값 유지) | 비활성 |
| `running` | 재시작(kill+respawn) | 활성 |
| `attention`(권한 프롬프트) | 재시작 | 활성 |
| `done`(종료됨) | 시작 — 최신 세션 resume | 비활성 |

dot 색은 기존 `STATUS_COLOR` 매핑 유지. ▶은 항상 활성.

> 구현 메모: "시작"과 "재시작"은 별도 코드 경로가 아니다 — ▶은 상태와 무관하게 **항상 `restartNonce[key]++` 한 동작**이고, 세션이 떠 있었으면 pty-manager가 같은 id를 kill 후 재spawn(=재시작), 떠 있지 않았으면 그냥 spawn(=시작)된다.

---

## 6. 에러 / 엣지

- **재시작 중복 spawn 방지:** AgentTerminal의 spawn effect cleanup이 xterm 인스턴스와 `onPtyData/onPtyExit` 구독을 확실히 dispose해야 한다(현 구현이 마운트마다 그러듯, nonce 변경 시에도 동일 cleanup 경로). pty-manager는 같은 id로 start 시 기존 PTY를 kill하므로 OS 프로세스 중복도 없음.
- **mounted 유지 동작 불변:** 재시작은 세션 단위(nonce)지 언마운트가 아님 → "프로젝트 전환해도 dock mounted 유지"(App.tsx 주석 L343–345) 깨지지 않음.
- **죽은 세션에 ⏹:** `killPty`는 없는 id에 no-op(`pty-manager.kill` L128 옵셔널 체이닝) → 무해. 그래도 ⏹은 running/attention에서만 노출.
- **resume 세션 없음:** `resumeSessionId`가 `null`(최신 resume)인데 과거 세션이 없으면 기존 `pty-manager.resolveResume`가 fresh로 폴백(현 동작) → ▶ 시작이 깨지지 않음.

---

## 7. 테스트

`apps/desktop` vitest(+ @testing-library). AgentTerminal은 PTY를 IPC로 spawn하므로 `api`를 모킹.

1. **AgentTerminal 재시작:** `restartNonce`를 0→1로 리렌더 시 `api.startPty`가 같은 `id`로 재호출됨(spy). cleanup이 이전 `onPtyData` 구독 해제 함수를 호출.
2. **stopAgent:** `stopAgent(key)` 호출 시 `api.killPty({id:key})` 1회 + `agentStatus[key]==='idle'`.
3. **헤더 렌더/클릭:** 에이전트 헤더에 ▶/⏹ 버튼(aria-label)이 렌더되고, 클릭이 각각 `restartAgent`/`stopAgent`를 올바른 key로 호출. 헤더 버튼 클릭이 `setAgent`(행 선택)로 버블링되지 않음(stopPropagation).
4. **⏹ 활성 게이트:** status `idle/done`이면 ⏹ `disabled`, `running/attention`이면 enabled.

**수용 기준:** 위 4개 테스트 green; typecheck 0; 기존 dock/터미널 테스트 회귀 없음. 수동: 앱에서 프로젝트 선택 → 헤더 ▶로 에이전트 시작·재시작, ⏹로 중지가 한 클릭 아이콘으로 동작.
