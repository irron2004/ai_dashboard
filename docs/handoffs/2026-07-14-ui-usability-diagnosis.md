# 진단 — UI 사용성: 비전 대비 화면 구조 점검과 개선 우선순위

**날짜:** 2026-07-14
**기준 브랜치:** feat/resume-recall-surface
**선행 문서:** [2026-07-02 제품 진단·로드맵](./2026-07-02-product-diagnosis-and-roadmap.md)
**제안 화면 목업:** [docs/mockups/2026-07-14-ui-proposal-mockups.html](../mockups/2026-07-14-ui-proposal-mockups.html) — 브라우저에서 열어 확인 (개선 1~4 반영)
**범위:** `apps/desktop/src/renderer` — App 셸, Home/Knowledge/Wiki Gen/전체 4탭, PmHome·TaskBoard·DevHarnessPanel·ResumeBanner, app.css

---

## 0. 요약 (TL;DR)

기능은 로드맵 P1~P3(의존성 모델, Context Composer, 멀티프로젝트 홈)까지 거의 완주했다.
그러나 **UI 계층이 아직 "위키 툴 시절"의 구조(문서 뷰어 중심)에 머물러 있어, PM 대시보드 비전이 화면에 드러나지 않는다.**

- 비전의 심장인 PmHome이 Home 탭 footer의 "자세히 ▾" 토글 뒤에 숨어 있음 (기본 접힘)
- task → LLM 핸드오프가 6단계로 파편화 (TaskBoard와 DevHarnessPanel이 서로 연결 안 됨)
- Recent Runs가 원시 run ID 나열이라 "무엇이 실행됐는지" 읽을 수 없음
- 에이전트 상태색이 done=빨강 — 보편 관습(빨강=에러)과 반대

→ **개선 1~4번(§4)만 반영해도 체감이 크게 달라진다.**

---

## 1. 비전 재확인 — UI가 답해야 할 질문

선행 진단 문서 기준, 이 제품은 **"여러 프로젝트를 오가며 ① 전후 작업을 빠르게 파악하고 ② 다음 작업을 LLM에게 빠르게 넘기는 개인 PM 대시보드 + llm-wiki 관리 툴"**이다.

핵심 사용 루프:

```
상태 파악 → 다음 작업 선정 → 컨텍스트 조립해 LLM에 전달 → 실행 관찰 → 리뷰
```

이 루프의 기능은 이미 존재한다: `blockedBy` 의존성, `nextUp` 위젯, Context Composer(`composeContext`), 터미널 주입(`writePty`), dev-run transcript, WorkspaceHome, ResumeBanner.
**문제는 기능이 아니라 배치다.**

---

## 2. 핵심 진단

### 🔴 D1. PM 대시보드가 footer 토글 뒤에 숨어 있다 — 최우선

- 근거: `HomeView.tsx` — `PmHome`(Goal·Timeline·다음 할 일·Task Board·Run Harness·Review Queue)은 하단 스트립의 "자세히 ▾" 클릭 시에만 렌더, 기본값 접힘(`pmOpen=false`).
- Home 탭의 주인공은 current.md 뷰어 + git 변경분 피드.
- 결과: "다음에 뭘 해야 하지?"(이 제품의 1번 질문)에 답하려면 **Home 탭 → 하단 시선 이동 → 자세히 클릭 → 7개 섹션 세로 스택 스크롤**. 가장 중요한 워크플로가 가장 접근성이 낮다. 정보 구조가 비전과 뒤집혀 있음.

### 🔴 D2. LLM 핸드오프 6단계 파편화 — 비전 3("빠르게 전달")과 직접 충돌

현재 경로:

```
자세히 열기 → DevHarnessPanel의 원시 <select>에서 task 다시 찾기 → 📋 컨텍스트 조립
→ textarea 검토 → 주입 대상 에이전트 선택 → ▸ 주입 → dock 터미널에서 Enter
```

- 뿌리: **TaskBoard 카드와 DevHarnessPanel이 연결돼 있지 않다.** 카드에 "이 작업 시작/조립" 버튼이 없어, 바로 위 보드에서 본 task를 드롭다운에서 다시 찾아야 한다.
- 터미널 주입 후 Enter는 사용자 검토를 위한 의도된 설계(유지) — 문제는 그 앞의 5단계.

### 🔴 D3. Run 가시성 — 무엇이 실행됐는지 읽을 수 없음

- 근거: `PmHome.tsx` Recent Runs — `{r.id} — {r.agent} — {r.status}` 원시 run ID 나열.
- task 제목 없음, 시각 없음, 클릭 동작 없음. transcript는 DevHarnessPanel 안의 별도 링크(역시 원시 ID)로만 도달 가능.
- 선행 문서의 "dev-run 가시성" 지적이 UI 계층에 그대로 남아 있는 지점.

### 🟡 D4. 상태 색상 의미론이 관습과 반대

- 근거: `App.tsx` `STATUS_COLOR` — **done = 빨강(#f87171)**, running = 초록, attention = 노랑.
- 빨강은 보편적으로 실패/에러. 완료된 에이전트가 여럿이면 대시보드가 "망가진" 인상을 준다.
- 교정: done → 파랑/회청, 빨강은 (향후) 에러 상태에 예약.

### 🟡 D5. 수동 task 추가 수단 부재

- 렌더러 전체에 task 생성 UI/IPC 없음(grep 확인: `taskCreate|createTask|addTask` 0건). task는 세션 ingest(req:/todo:)로만 생성.
- "머릿속의 다음 할 일"을 보드에 올리려면 에이전트와 대화부터 해야 함 — PM 툴로서 큰 공백.
- ResumeBanner의 📌 next-note가 있으나 task와 별개 저장소라 보드에 나타나지 않음.

### 🟡 D6. 의존성 편집이 `<select multiple>`

- 근거: `TaskBoard.tsx` — blockedBy 편집이 브라우저 기본 다중 선택 리스트. Ctrl+클릭 요구, task 많으면 스크롤 지옥, 검색 없음.
- P1(의존성 모델)의 가치가 입력 UI에서 깎이는 중. 검색 가능한 체크리스트 팝오버로 교체 권장.

### 🟡 D7. 멀티프로젝트 홈("🌐 전체")이 마지막 탭

- 비전 2·5의 답인 WorkspaceHome이 4번째 탭 + 수동 새로고침 전용.
- 앱을 열었을 때 첫 질문은 "어느 프로젝트부터?" — 전체 뷰가 시작 화면(최소 첫 탭)이 되는 게 비전에 부합.
- 탭 라벨 언어 혼재: Home / Knowledge / Wiki Gen (영) + 전체 (한).

### 🟢 D8. 소소한 것들

- 단축키(Ctrl+1..9 프로젝트, Shift+1-3 에이전트, Ctrl+K 검색, Ctrl+Shift+N 이어서)가 강력한데 tooltip 외 발견 불가 — `?` 도움말 오버레이 하나면 해결.
- `app.css`에 디자인 토큰 19개가 잘 정의돼 있으나, `App.tsx` dock 쪽은 `#333`, `#4a8a4a` 등 하드코딩 인라인 스타일 혼재.
- Wiki Gen 헤더 h2가 원시 runId — 사람이 읽을 이름/날짜로.
- dock·사이드바 리사이즈가 마우스 전용(키보드 접근 불가).

---

## 3. 잘 되어 있는 것 (유지)

- **ResumeBanner** (지난 요약 + 마지막 질문 + 📌노트 + 이어서 대화) — 비전 2를 정확히 겨냥한 패턴. 현 브랜치(feat/resume-recall-surface)에서 다듬는 방향 유지.
- 멀티프로젝트 전환 경험: 사이드바 뱃지(실행중/리뷰), dock 유지(MAX_KEPT_DOCKS), attention blink.
- 일관된 panel 관용구, 다크 테마 토큰, 대부분의 인터랙티브 요소에 aria-label.
- 터미널 주입 시 trailing newline 없이 사용자 검토 후 Enter — 안전한 설계.

---

## 4. 개선 우선순위

| # | 개선 | 대응 진단 | 효과 | 난이도 |
|---|---|---|---|---|
| 1 | **IA 반전**: PmHome을 footer 토글에서 꺼내 Home 탭 본문으로 승격. current.md/변경분은 보조 pane 또는 별도 탭으로 | D1 | 핵심 루프가 첫 화면에 | 중 |
| 2 | **TaskBoard 카드 → 원클릭 핸드오프**: 카드에 "▶ 조립" 버튼 → 해당 task로 composer 열림 | D2 | 6단계 → 2단계 | 하 |
| 3 | **Run 리스트 인간화**: task 제목·상대시간·상태 뱃지·클릭 시 transcript | D3 | 실행 관찰 가능 | 하 |
| 4 | **상태 색상 교정** (done ≠ 빨강) | D4 | 오독 제거 | 최하 |
| 5 | **수동 task 추가** (보드 컬럼 상단 + 입력; 📌 next-note → task 승격 경로 포함 검토) | D5 | PM 툴 완성 | 중 |
| 6 | 의존성 편집을 검색 가능한 체크리스트 팝오버로 | D6 | P1 가치 회수 | 하 |
| 7 | 전체 뷰를 첫 탭/시작 화면으로 + 탭 라벨 언어 통일 | D7 | 멀티프로젝트 진입점 | 하 |
| 8 | 단축키 도움말 오버레이, dock 인라인 스타일 토큰화, runId 인간화 | D8 | 마감 품질 | 하 |

**추천 순서: 1 → 2 → 3 → 4** (4는 5분짜리이므로 아무 PR에나 동승 가능).
5~8은 각각 독립 작업으로 진행 가능.
