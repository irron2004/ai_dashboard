---
title: PM Home 통합 설계
slug: docs-superpowers-specs-2026-06-07-pm-home-integration-design
sources: [docs/superpowers/specs/2026-06-07-pm-home-integration-design.md]
status: accepted
date: 2026-06-07
topic: [project-management]
---

## Context

title: PM Home 통합 설계 (AC 2 격차 해소) branch: docs/knowledge-harness-pipeline-spec PRD 수용기준 2 — "프로젝트가 goal/current focus/timeline-milestones/task board/review queue/recent agent runs를 한 화면에 표시" — 가 부분 미달이다. 진단( 2026-06-07-product-requirements-coverage-diagnosis.md §2)에서 확인된 사실 목표: PmHome 을 메인 랜딩 뷰로 연결하고, 누락된 섹션(current focus·timeline·task board)을 채워 AC 2를 충족한다. 기존 Knowledge Harness UI는 잃지 않고 같은 영역의 탭으로 보존한다. 계약 변경은 최소·additive . getProjectDashboard 는 이미 내부에서 전체 task( all )를 계산하므로 이를 allTasks 로 추가 반환만 한다. 기존 필드는 유지 → 하위 호환(다른 소비자·테스트 무손상). // packages/dashboard-api/src/project-dashboard.ts export type ProjectDashboard = { activeTasks: Task[] // (

## Decision

- **1. 배경 / 문제** — PRD 수용기준 2 — "프로젝트가 goal/current focus/timeline-milestones/task board/review queue/recent agent runs를 한 화면에 표시" — 가 부분 미달이다. 진단( 2026-06-07-product-requirements-coverage-diagnosis.md §2)에서 확인된 사실
- **2. 설계 결정 (확정)**
- **3. 아키텍처 / 데이터 흐름** — 계약 변경은 최소·additive . getProjectDashboard 는 이미 내부에서 전체 task( all )를 계산하므로 이를 allTasks 로 추가 반환만 한다. 기존 필드는 유지 → 하위 호환(다른 소비자·테스트 무손상).
- **4. 컴포넌트 (작은 단위로 분해)**
- **4.1 App.tsx — 탭 컨테이너**
- **4.2 PmHome.tsx — 조합(얇게)** — 순수 표현 컴포넌트. props는 { dashboard: ProjectDashboardRes } . 5개 섹션 배치 1. Header strip — project.goal (없으면 placeholder) + Current Focus ( project.currentFocus ) + 기간 라벨( startDate → targetDate , 둘 다 없으면 생략). 2. TimelineStrip (신규 자식) 3. TaskBoard (신규 자식) 4. Review queue — 기존 dashboard.reviewQueue 사용(재파생 안 함) + reviewStatus 뱃지
- **4.3 TimelineStrip.tsx (신규)**
- **4.4 TaskBoard.tsx (신규)**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-07-pm-home-integration-design.md`
