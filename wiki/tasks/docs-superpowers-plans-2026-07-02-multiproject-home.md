---
title: "Implementation Plan — P3: 멀티프로젝트 홈 (cross-project overview)"
slug: docs-superpowers-plans-2026-07-02-multiproject-home
sources: [docs/superpowers/plans/2026-07-02-multiproject-home.md]
status: open
created: 2026-07-02
topic: [project-management]
---

## Summary

Give the console one screen that answers "across all projects, what is in progress, what is running, and what is waiting for review?" — today every view is scoped to the single selected project (handoff docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md §4 P3). 1. Aggregate API — packages/dashboard-api gains buildWorkspaceOverview() returning per-project {activeTaskCount, runningRuns, reviewQueueCount, nextUp} (the FIXED SEAM below). 2. Store plumbing — AgentRunStore.listRunning() (all in-flight runs, one query) so the aggregate can attribute running runs to projects. 3. Altitude fix — the pure task-dependency helpers ( isBlocked / unr

## Progress log

- Source checklist: 0 completed, 0 remaining.
- **Goal** — Give the console one screen that answers "across all projects, what is in progress, what is running, and what is waiting for review?" — today every view is scoped to the single selected project (handoff docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md §4 P3). Concretely 1. Aggregate API — packages/dashboard-ap
- **FIXED SEAM (a parallel P4 planner is given the identical contract — do NOT rename buildWorkspaceOverview , WorkspaceOverview , ProjectOverview )** — { registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore } is structurally identical to the existing DashboardDeps in project-dashboard.ts , so the implementation reuses DashboardDeps as the param type (the seam only fixes the three exported names , not the deps type name).
- **Architecture (data flow this plan touches)**
- **Tech stack**
- **Global constraints (read before every task)** — scopes in use: shared , pm , desktop , dashboard-api .
- **Task 1 — Move the pure task-deps helpers into @apc/dashboard-api (altitude fix)**
- **Files**
- **Steps** — 1. Confirm the only importers (must print exactly the two components + the test being deleted) Expected: task-deps.test.ts , components/PmHome.tsx , components/TaskBoard.tsx . If anything else appears, re-point it in step 5 too. 2. Failing test — create packages/dashboard-api/src/task-deps.test.ts (moved verbatim from

## Related

- Source: `docs/superpowers/plans/2026-07-02-multiproject-home.md`
