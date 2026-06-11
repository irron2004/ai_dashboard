# 핸드오프 — UI 재디자인: 접이식 사이드바 레일 + 위키 생성 세로 스테퍼

- **Date**: 2026-06-11
- **Branch**: `main` (커밋·push 완료)
- **성격**: 데스크톱 렌더러 UI 재디자인. 기능/IPC 변경 없음, 순수 프론트엔드(컴포넌트 + CSS).
  사용자 요청 2건: (1) 프로젝트 리스트 바가 너무 커서 다른 화면이 좁다 → 접고 펼 수 있게,
  (2) "위키 생성" 진행 화면이 알아보기 힘들다 → 단계를 쪼개고 요약 로그만 표시.

## 0. 한 줄 요약

기존 다크 테마(파란 패널 시스템)는 그대로 두고, **사이드바를 56px 아이콘 레일로 접을 수 있게** 만들고,
**위키 생성 진행을 raw 로그 10줄 dump → 세로 단계 스테퍼**로 교체했다. 인터랙션 방향(레일 형태 vs
완전 숨김 / 스테퍼 vs 컴팩트 바)은 작업 전 사용자에게 확인받아 **레일 + 세로 스테퍼**로 확정.

## 1. 변경 내용

### 1.1 접이식 사이드바 — 아이콘 레일
- `apps/desktop/src/renderer/App.tsx`
  - `sidebarCollapsed` 상태 신설, **`localStorage('apc:sidebarCollapsed')`** 에 영속(재시작 유지).
  - `RAIL_W = 56`. 그리드 트랙 `--sidebar-width` 를 **접힘 56px / 펼침은 기존 드래그 너비(`sidebarW`)**
    로 전환(`effectiveSidebarW`). `toggleSidebar()` 가 상태+localStorage를 같이 갱신.
  - 접혔을 땐 사이드바/메인 **리사이즈 divider를 렌더하지 않음**(레일 폭은 고정). aside에
    `app-layout__sidebar--rail` 클래스 부여.
- `apps/desktop/src/renderer/components/ProjectSidebar.tsx`
  - `collapsed` / `onToggleCollapse` prop 추가. return을 Fragment로 감싸 **레일 / 풀 리스트**를 분기.
  - **레일**: `▸` 펼침 버튼 → 프로젝트 이니셜 dot 리스트(선택 항목 = 액센트 + 좌측 바, `title`에
    이름·status, 우클릭 편집/삭제 메뉴 동작) → 하단 `+`(새 프로젝트, flex로 바닥 정렬).
  - **풀**: 기존 그룹 리스트 그대로 + 헤더(`project-sidebar__header`)에 `◂` 접기 버튼.
  - 컨텍스트 메뉴/추가·편집 다이얼로그는 두 모드 공용으로 Fragment 바깥에 유지.

### 1.2 위키 생성 진행 — 세로 단계 스테퍼
- `apps/desktop/src/renderer/components/WikiProgress.tsx` **(신설)**
  - 파이프라인 `KhState` 12개를 **사용자용 9단계 한글 라벨**로 매핑(`STEPS`):
    프로젝트 스캔 / 소스 추출 / 문서 분류 / 노드 제안 생성 / 리드 병합 / 작성 계획 /
    위키 작성·스테이징 / 검증 / 리뷰 대기.
  - 상태 계산: `harnessProgress`(도달한 마일스톤)를 `HARNESS_STATE_ORDER` 인덱스로 보고,
    **아직 도달 안 한 첫 단계 = 진행중(●, 펄스)**, 그 이전 = 완료(✓ 초록), 이후 = 대기(○).
    `state===null` → 첫 단계 진행중, `state==='FAILED'` → 전용 에러 뷰.
  - **요약 로그만 노출**: 진행중 단계 아래에 `harnessLiveTail`의 **마지막 비어있지 않은 한 줄**만 표시
    (없으면 단계 hint). raw 전체 로그는 **`자세히 ▾` 토글** 안에 접어둠(기본 숨김).
  - 상단: 스피너 + `N / 9` 카운트 + 진행 바(`pct`).
- `apps/desktop/src/renderer/components/HarnessDashboard.tsx`
  - Coverage 탭의 `harnessLoading` 블록(기존 `⏳ … (현재 단계: X)` + raw `<pre>`)을
    `<WikiProgress state={harnessProgress} liveLabel={harnessLiveLabel} liveTail={harnessLiveTail} />`
    로 교체. store 셀렉터는 이미 노출돼 있어 배선만 교체.
- `apps/desktop/src/renderer/app.css`
  - `.project-sidebar__header` / `__collapse-btn`, `.app-layout__sidebar--rail`,
    `.project-sidebar--rail` / `__rail-toggle` / `__rail-list` / `__rail-dot(--selected)` / `__rail-add`,
    그리고 `.wiki-progress*` 일습(스피너·진행 바·마커·연결선·요약줄·로그·실패뷰) 추가. 기존
    `.harness-dashboard__live-tail` 규칙은 남겨둠(미사용이나 무해).

## 2. 동작/구현 메모 (다음 사람이 헷갈릴 지점)

- **스테퍼가 뜨는 위치는 Coverage 탭의 로딩 상태 한 곳**(기존과 동일). `harnessLoading`은 run뿐 아니라
  refresh/resume/promote에서도 true가 되므로 그 동안에도 스테퍼가 보이는데, 진행 단계는
  **materialize run("전 문서로 위키 생성") 중에만** `harness:progress` 이벤트로 갱신된다. 다른 작업 땐
  단계가 안 움직여도 정상.
- **`harnessProgress`는 `string | null`** 이고 WikiProgress에서 `KhState`로 캐스팅. 엔진이 미지의 state를
  내보내면 모든 단계가 '대기'로 표시된다(안전한 폴백).
- **claude json 모드 live tail 한계는 그대로**: `claude -p --output-format json`은 단계 중 stdout이 비고
  끝에 한 번에 출력 → 진행중 단계의 요약 한 줄이 직전 청크에 머무를 수 있다(codex는 스트리밍됨).
  이전 핸드오프(`2026-06-11-harness-wiki-end-to-end.md` §4-3)와 동일한 알려진 제약.
- **반응형**: `app.css`의 `@media (max-width:1280px)`에서 `.app-layout`이 단일 컬럼으로 바뀐다(기존 동작).
  좁은 창에서도 레일/스테퍼는 정상 동작하나, 격리 미리보기를 만들 때 이 그리드를 통째로 쓰면 무너지므로
  컴포넌트를 분리해서 보는 게 낫다(검증 때 한 번 헤맸음).

## 3. 검증

- `pnpm run typecheck` 클린.
- `pnpm --filter @apc/desktop exec vitest run` → **20 파일 / 85 테스트 전부 green**
  (AgentConfigEditorPanel의 act() 경고는 변경과 무관한 기존 노이즈).
- **시각 확인**: 실제 `app.css`를 링크한 격리 HTML 미리보기를 헤드리스 크로미움으로 스크린샷 →
  펼친 사이드바(◂)·접은 레일(▸/이니셜 dot/＋)·세로 스테퍼(✓/●+요약/○, 연결선, `자세히 ▾`)가 의도대로
  렌더됨을 확인. **실제 Electron 기동으로는 아직 안 봄**(WSL 네이티브 리빌드 비용 때문에 보류 —
  절차는 memory `dev-env-node-pnpm.md` §"Running the desktop app in WSL").

## 4. 후속/잔여

- 실제 Electron 앱에서 한 번 띄워 보고(특히 한글 폰트·레일 좌측 액센트 바가 `overflow:hidden`에 살짝
  잘리는지) 미세 조정 여지.
- 스테퍼를 materialize 외 작업(refresh/resume)에서도 띄울지, 아니면 그때는 단순 스피너로 분기할지 결정 여지.
- 단위 테스트는 추가하지 않음(순수 표현 컴포넌트). 회귀가 걱정되면 `WikiProgress`의 상태 계산
  (`statusFor`/`currentStepIdx`)에 대한 가벼운 테스트가 후보.

## 5. 핵심 파일

```
apps/desktop/src/renderer/App.tsx                            # sidebarCollapsed + localStorage + 그리드 폭/divider
apps/desktop/src/renderer/components/ProjectSidebar.tsx      # 레일/풀 분기, 토글 버튼, 이니셜 dot
apps/desktop/src/renderer/components/WikiProgress.tsx        # (신설) 세로 단계 스테퍼 + 요약 로그
apps/desktop/src/renderer/components/HarnessDashboard.tsx    # Coverage 탭 로딩 → <WikiProgress/>
apps/desktop/src/renderer/app.css                            # 레일 + 스테퍼 스타일
```
