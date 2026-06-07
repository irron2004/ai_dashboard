---
title: PM Home 통합 설계 (AC#2 격차 해소)
date: 2026-06-07
status: design-approved
author: PM (Claude)
relates-to:
  - docs/superpowers/specs/2026-06-07-product-requirements-coverage-diagnosis.md (격차 #2)
  - docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md (수용기준 #2)
branch: docs/knowledge-harness-pipeline-spec
---

# PM Home 통합 설계

## 1. 배경 / 문제

PRD 수용기준 **#2** — "프로젝트가 goal/current focus/timeline-milestones/task board/review queue/recent agent runs를 한 화면에 표시" — 가 부분 미달이다. 진단(`2026-06-07-product-requirements-coverage-diagnosis.md` §2)에서 확인된 사실:

- `apps/desktop/src/renderer/components/PmHome.tsx`는 존재하지만 **`App.tsx`에 연결되지 않음** — `main` 영역은 `HarnessDashboard`를 렌더하고 `PmHome`은 import조차 안 됨.
- `PmHome`이 렌더하는 것은 goal / activeTasks / reviewQueue / recentRuns뿐 — **current focus·timeline·task board 없음**.
- PRD 1순위 성공지표인 "프로젝트 상태 가시성"이 사실상 미노출.

**목표:** `PmHome`을 메인 랜딩 뷰로 연결하고, 누락된 섹션(current focus·timeline·task board)을 채워 AC#2를 충족한다. 기존 Knowledge Harness UI는 잃지 않고 같은 영역의 탭으로 보존한다.

## 2. 설계 결정 (확정)

| 갈림길 | 결정 | 근거 |
|---|---|---|
| 레이아웃 | **main 상단 탭바** `[PM Home][Knowledge Harness]`, PM Home 기본 랜딩 | 최소 변경, `HarnessDashboard` 그대로 재사용, AC#2 즉시 충족 |
| timeline/milestone | **기존 필드에서 파생(경량)** | `Milestone` 엔티티 부재. `project.startDate/targetDate` + `task.dueDate`로 충분. YAGNI |
| task board | **읽기전용 칸반** | task status 변경 mutation IPC 부재. 조회만으로 가시성 격차 해소 |

## 3. 아키텍처 / 데이터 흐름

계약 변경은 **최소·additive**. `getProjectDashboard`는 이미 내부에서 전체 task(`all`)를 계산하므로 이를 `allTasks`로 추가 반환만 한다. 기존 필드는 유지 → 하위 호환(다른 소비자·테스트 무손상).

```ts
// packages/dashboard-api/src/project-dashboard.ts
export type ProjectDashboard = {
  project: Project
  activeTasks: Task[]      // (유지) todo | in_progress
  reviewQueue: Task[]      // (유지) review
  recentRuns: AgentRun[]   // (유지) 최근 10
  allTasks: Task[]         // (신규) board/timeline 파생용 — 이미 계산된 `all` 그대로
}
```
```ts
// apps/desktop/src/shared/ipc-contract.ts  — 대응 추가
export type ProjectDashboardRes = {
  project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[]; allTasks: Task[]
}
```

- board 컬럼 그룹핑·timeline 마커 계산은 **서버가 아니라 `PmHome`(렌더러)에서 파생** → 서버 로직 얇게 유지.
- **새 IPC 채널 없음. DB migration 없음.**

## 4. 컴포넌트 (작은 단위로 분해)

### 4.1 `App.tsx` — 탭 컨테이너
- `main` 안에 탭 상태 `const [mainTab, setMainTab] = useState<'pm' | 'harness'>('pm')`.
- 툴바(`Ingest now` / `✨ Generate`) **위치 유지**, 그 아래 탭바 추가.
- 콘텐츠 조건 렌더:
  - `dashboard` 없으면 기존 placeholder(`Loading...` / `Select a project`) 유지.
  - `mainTab === 'pm'` → `<PmHome dashboard={dashboard} />`
  - `mainTab === 'harness'` → `<HarnessDashboard profiles={profiles} onSelectProfile={handleSelectProfile} />`
- 탭바는 `selectedProjectId && dashboard`일 때만 렌더(프로젝트 미선택 시 불필요).

### 4.2 `PmHome.tsx` — 조합(얇게)
순수 표현 컴포넌트. props는 `{ dashboard: ProjectDashboardRes }`. 5개 섹션 배치:

1. **Header strip** — `project.goal`(없으면 placeholder) + **Current Focus**(`project.currentFocus`) + 기간 라벨(`startDate → targetDate`, 둘 다 없으면 생략).
2. **`TimelineStrip`** (신규 자식)
3. **`TaskBoard`** (신규 자식)
4. **Review queue** — 기존 `dashboard.reviewQueue` 사용(재파생 안 함) + `reviewStatus` 뱃지.
5. **Recent runs** — `recentRuns` (id · agent · status · startedAt).

### 4.3 `TimelineStrip.tsx` (신규)
- props: `{ start?: string; target?: string; tasks: Task[] }`.
- `start`~`target`을 축(0~100%)으로, 각 task의 `dueDate`를 축 위 마커로 배치 + "오늘" 마커.
- 축 범위가 없으면(둘 다 없음) `dueDate` min/max로 fallback; 그것도 없으면 **empty state**("일정 정보 없음").
- 마커 hover 시 task title 표시. 읽기전용.

### 4.4 `TaskBoard.tsx` (신규)
- props: `{ tasks: Task[] }`.
- 읽기전용 칸반, CSS grid 컬럼: **todo / in_progress / review / done**. `rejected`는 muted 컬럼으로 접거나 숨김(MVP: 숨김).
- 카드 = `title` · `priority` · `dueDate`(있으면). 빈 컬럼은 "—" 표시.

> 분해 이유(설계 원칙): `TimelineStrip`·`TaskBoard`는 props만 받는 순수 컴포넌트라 단위 테스트가 쉽고, `PmHome`은 조합만 담당해 각 파일이 한 가지 책임만 갖는다.

## 5. 스타일

- `apps/desktop/src/renderer/app.css`에 `.pm-home` / `.pm-board` / `.pm-timeline` 네임스페이스 추가.
- 칸반 컬럼은 **CSS grid**(인라인 grid 금지 — 진단 §2의 #2 회귀 방지).
- 기존 다크 테마 토큰 재사용(예: `#161616`, `#23311f`, `#2c2c2c`). 신규 색 토큰 도입 없음.

## 6. 에러 / 빈 상태

| 상황 | 처리 |
|---|---|
| goal 없음 | "(no goal set)" placeholder |
| currentFocus 없음 | Focus 라벨 자체 생략 |
| start/target/dueDate 전무 | TimelineStrip "일정 정보 없음" empty state |
| 컬럼에 task 없음 | 컬럼 본문 "—" |
| recentRuns 없음 | "최근 실행 없음" |
| dashboard 로딩 중 | 탭바는 노출, 콘텐츠만 "Loading…" |

## 7. 테스트

도구: desktop vitest 스위트(`apps/desktop`에서 `npx vitest run`).

- **`dashboard-api`**: `getProjectDashboard`가 `allTasks`를 전체 task로 반환(기존 `activeTasks/reviewQueue/recentRuns` 불변) — 단위.
- **`TaskBoard`**: status별 컬럼 그룹핑 정확성, 카드 필드(title/priority/dueDate) 렌더, 빈 컬럼 "—", `rejected` 미표시.
- **`TimelineStrip`**: `dueDate` 마커 위치 계산, "오늘" 마커, 날짜 전무 시 empty state.
- **`App`/`PmHome`**: 기본 탭이 PM Home, "Knowledge Harness" 탭 클릭 시 `HarnessDashboard` 노출 / 복귀.

## 8. 범위 밖 (YAGNI)

- task status **변경·생성 mutation**(읽기전용 board 유지) → 후속 Plan.
- **Milestone 엔티티**(경량 파생으로 대체).
- 별도 "ingested sessions" 패널(`recentRuns`로 충분).
- `HarnessDashboard` 내부 로직 변경 — 탭 아래로 **이동만**.
- 통합 검색(#6)·하네스 apply(#8)는 별도 격차 — 본 spec 무관.

## 9. 수용 기준 (이 작업의 Done 정의)

1. 프로젝트 선택 시 main이 PM Home을 기본으로 보여준다.
2. PM Home에 goal · current focus · timeline · task board(칸반) · review queue · recent runs가 모두 렌더된다.
3. "Knowledge Harness" 탭으로 기존 HarnessDashboard에 접근 가능하고 복귀된다.
4. `getProjectDashboard`가 `allTasks`를 반환하고 기존 필드는 불변(테스트 green).
5. 신규/기존 desktop 테스트·`pnpm typecheck` 통과.
6. 인라인 grid 미사용(CSS 클래스 기반).
