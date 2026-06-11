# 핸드오프 — 하니스 대시보드 UX: 노드클릭·Runs레일·강제promote·슬림헤더·Agent패널 재설계

- **Date**: 2026-06-11
- **Branch**: `main` (커밋·push 완료)
- **성격**: 데스크톱 렌더러 UX 개선 묶음. 사용자가 실제 Electron 앱을 띄워 쓰면서 발견한 6가지를 한 세션에 처리.
  IPC/main/네이티브 불변, 전부 렌더러(컴포넌트 + store + CSS). 직전 핸드오프
  `2026-06-11-ui-sidebar-rail-wiki-stepper.md`의 후속.

## 0. 한 줄 요약

위키 생성(하니스) 화면을 더 직관적으로: **그래프 노드 클릭 → 문서 표시**, **Runs 패널 접이식 레일**,
**Promote가 graph 검증에 막힐 때 강제 override**, **상단 헤더 슬림화**, 그리고 오른쪽
**Agent Configuration 패널을 ①실행/②안전/③미구현 3그룹으로 재편 + 파이프라인 agent 라이브 펄스**.

## 1. 변경 내용

### 1.1 그래프 노드 클릭 → 문서 표시
- `HarnessDashboard.handleNodeClick`: 매칭 아티팩트를 찾으면 `setSelectedArtifactPath` 뒤에
  **`setTab('markdown')`** 까지 호출. 기존엔 Graph 탭에 머물러 문서가 안 보였음.

### 1.2 Runs/Timeline 접이식 레일
- `HarnessRunList`에 `collapsed`/`onToggleCollapse` prop. 접으면 **52px 레일**(▸ 토글 +
  run 상태 dot[`stateTone` 색] + 하단 `+` start), 펼치면 기존 카드 리스트(헤더에 `◂`).
- `HarnessDashboard`: `runsCollapsed` 상태 + `localStorage('apc:runsCollapsed')` 영속. 그리드에
  `harness-dashboard__grid--runs-collapsed` → 첫 컬럼 `minmax(250,300)` → `52px`. (사이드바 레일과 동일 패턴.)

### 1.3 Promote 강제 override (graph integrity 차단 해제)
- **원인**: 생성된 위키 그래프가 결정론적 `GraphIntegrity` 검증의 HARD-FAIL(거의 항상 `broken_links` —
  아직 없는 페이지로 `[[링크]]`)에 걸려 `HarnessPromoteService.gate()`가 promotion을 막음.
  메시지: `graph integrity validation failed; promotion blocked (pass allowInvalid to override)`.
- **핵심**: `allowInvalid`는 **IPC·preload·api·service까지 이미 전부 배선돼 있었고 렌더러만 안 넘김**.
  - `store.promoteHarnessRun(runId?, allowInvalid=false)`: allowInvalid면 `{runId, allowInvalid:true}`로 호출.
    실패 사유가 `/pass allowInvalid to override/i`면 `harnessPromoteBlockedReason`에 저장(단, 이미 force였으면 null → 루프 방지).
  - `AgentConfigPanel`: 차단 시 **⚠ 사유 + "검증 무시하고 promote"** 버튼(`onForcePromote` → `promoteHarnessRun(undefined, true)`).
  - `harnessPromoteBlockedReason`는 run 시작/선택/refresh/hydrate에서 정리.
- **안전**: 강제는 graph/markdown/link 검증만 무시한다. **시크릿 스캔 차단은 allowSecrets 미전달이라 그대로 유지**(더 위험).
  canonical 프로모트(`promoteCanonicalDoc`)는 같은 게이트를 타지만 **아직 force UI 없음**(아래 후속).

### 1.4 상단 헤더(툴바) 슬림화
- `.app-layout__toolbar` 패딩 `12px 14px → 6px 12px`, radius `--radius → --radius-sm`,
  `.app-layout__toolbar button { padding:5px 12px; font-size:.82rem }`. 앱 셸 `gap/padding 14 → 10px`.

### 1.5 Agent Configuration 패널 재설계 (가장 큰 변경)
- **Feature Gates 3그룹화** — `GATE_WIRING`으로 분기:
  - `실행 단계 [작동 중]` = `honored`(5개, 초록 dot)
  - `안전장치 [항상 켜짐]` = `structural`(7개, 파랑 dot)
  - `▸ 미구현 N개 · 예정 기능` = `forward-declared`(10개) → **`<details>`로 접고 흐리게**.
  22개 평면 카드 → 그룹·색·접기로 "지금 진짜 작동하는 것"만 부각.
- **Pipeline Agents 라이브 펄스** — `AGENT_STATE`가 각 `HARNESS_AGENT_PROMPTS` 키를 그 agent가 만드는
  `KhState`에 매핑(projectDiscovery→PROJECT_SCANNED, … policyGuard→VALIDATED). `running`(=harnessLoading) 중
  **아직 도달 안 한 첫 단계 = active(펄스)**, 그 이전 = ✓done(초록), 이후 = idle(흐림). 헤더에 `● <agent> 작동 중`
  라이브 배지(깜빡임). `HarnessDashboard`가 `running={harnessLoading} activeState={harnessProgress}` 전달.
- Model의 `Engine`만 "변경 가능" 배지로 강조, Temperature/MaxTokens·Safety는 `고급/고정` `<details>`로 접음.

## 2. 동작/구현 메모 (다음 사람이 헷갈릴 지점)

- **`/mnt/c` HMR이 안 먹는다 (중요).** 레포가 Windows FS에 있어 vite의 chokidar가 WSL쪽 편집의 fs 이벤트를
  못 받는다 → dev 서버가 **편집 전 번들을 계속 서빙**. 렌더러 변경을 실물로 보려면 **`pnpm --filter @apc/desktop
  dev`를 재시작**해야 함(HMR/`Page.reload`로는 반영 안 됨). 이번에 이걸로 두 번 헛돌았음.
- **펄스 trigger = `harnessLoading`.** refresh/resume 중에도 잠깐 켜지지만, 그땐 `harnessProgress`가 직전 run의
  최종 state라 모든 agent가 done으로 떠 false-active가 거의 없음(최초 refresh+progress=null만 예외). 전용
  `generating` 플래그를 두면 더 깔끔(후속).
- **노드→문서**는 매칭 아티팩트가 있을 때만 탭 전환(run/task 같은 비문서 노드 클릭 시 화면이 안 튐).
- graph integrity 실패는 **진짜 콘텐츠 결함**(LLM이 만든 깨진 wikilink). override가 설계 의도(`allowInvalid`)지,
  근본 해결(생성기가 유효 그래프를 내게)은 별개의 더 큰 작업.

## 3. 검증

- `pnpm run typecheck` 클린. `pnpm --filter @apc/desktop exec vitest run` → **20파일/85테스트 green**.
- **실물 Electron(CDP 9222) 캡처로 전부 확인**: 슬림 헤더 / Runs 레일(가운데가 넓어짐) / Promote 차단+강제버튼
  (사용자가 본 그 문구 재현) / Agent 패널 3그룹 게이트 / Pipeline agent 펄스(active 시뮬레이션으로 애니메이션 렌더까지).
  네이티브는 직전 세션에서 리빌드(better-sqlite3 ABI125 + node-pty node-gyp) 해둔 상태 그대로 사용.

## 4. 후속/잔여

1. **canonical 프로모트에 force 없음**: `HarnessDashboard`의 "Promote to <canonical>" 버튼(`promoteCanonicalDoc`)도
   같은 게이트라 graph 검증에 막히는데 override UI가 main "Promote current"에만 있음. 같은 패턴 이식 필요.
2. **생성기 broken-link 근절**: graph integrity가 통과하도록 wikilink 타깃 보장(또는 미존재 링크를 plain text로).
3. `running`을 전용 generating 플래그로 분리하면 펄스 false-positive 제거.
4. 새 렌더 로직(`activityOf`/게이트 그룹/`statusFor`)에 단위 테스트 없음.
5. `app.css`에 옛 `.agent-config-panel__prompts` / `__prompt textarea` 규칙이 미사용으로 남음(무해, 정리 대상).

## 5. 핵심 파일

```
apps/desktop/src/renderer/store.ts                          # allowInvalid + harnessPromoteBlockedReason
apps/desktop/src/renderer/components/HarnessDashboard.tsx    # node→markdown, runs collapse state, running/activeState 배선
apps/desktop/src/renderer/components/HarnessRunList.tsx      # 접이식 Runs 레일
apps/desktop/src/renderer/components/AgentConfigPanel.tsx    # 게이트 3그룹 + 라이브 펄스 agent + 강제 promote
apps/desktop/src/renderer/app.css                            # 슬림 헤더 + runs 레일 + 게이트 그룹 + 펄스 + promote 블록
```
