---
title: PM Home Integration Implementation Plan
slug: docs-superpowers-plans-2026-06-07-pm-home-integration
sources: [docs/superpowers/plans/2026-06-07-pm-home-integration.md]
status: open
created: 2026-06-07
topic: [project-management]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Wire PmHome into the desktop app as the default landing tab and fill its missing sections (current focus, lightweight timeline, read-only kanban) so PRD acceptance criterion 2 is met. Architecture: Additive contract change — getProjectDashboard returns the already-computed full task list as allTasks ; no new IPC channel, no DB migration. The renderer gains two new pure presentational components ( TimelineStrip , TaskBoard )

## Progress log

- Source checklist: 0 completed, 37 remaining.
- **File Structure**
- **Task 1: Extend dashboard contract with allTasks** — In packages/dashboard-api/src/project-dashboard.test.ts , add inside the describe('getProjectDashboard', …) block (the beforeEach already creates T1=in progress, T2=review, T3=done) Run: pnpm --filter @apc/dashboard-api test Expected: FAIL — dash.allTasks is undefined (TS error or Cannot read properties of undefined ).
- **Task 2: TaskBoard read-only kanban component** — Create apps/desktop/src/renderer/components/TaskBoard.test.tsx Run: cd apps/desktop && npx vitest run src/renderer/components/TaskBoard.test.tsx Expected: FAIL — Cannot find module './TaskBoard.js' . Create apps/desktop/src/renderer/components/TaskBoard.tsx Run: cd apps/desktop && npx vitest run src/renderer/components
- **Task 3: TimelineStrip component + axis helpers** — Create apps/desktop/src/renderer/components/TimelineStrip.test.tsx Run: cd apps/desktop && npx vitest run src/renderer/components/TimelineStrip.test.tsx Expected: FAIL — Cannot find module './TimelineStrip.js' . Create apps/desktop/src/renderer/components/TimelineStrip.tsx Run: cd apps/desktop && npx vitest run src/ren
- **Task 4: Rewrite PmHome to compose all five sections** — Replace the whole body of apps/desktop/src/renderer/components/PmHome.test.tsx with Run: cd apps/desktop && npx vitest run src/renderer/components/PmHome.test.tsx Expected: FAIL — current PmHome has no board/timeline/focus; col-in progress testid and getByTitle('do work') are missing. Replace the whole body of apps/des
- **Task 5: MainPanel tab container + wire into App** — Create apps/desktop/src/renderer/components/MainPanel.test.tsx (the heavy HarnessDashboard is stubbed so the test stays isolated) Run: cd apps/desktop && npx vitest run src/renderer/components/MainPanel.test.tsx Expected: FAIL — Cannot find module './MainPanel.js' . Create apps/desktop/src/renderer/components/MainPanel
- **Task 6: Styles for PM Home** — Append to apps/desktop/src/renderer/app.css (CSS-class based — no inline grid, per spec §5) Run: pnpm typecheck Expected: PASS (no change to TS; CSS is imported via import './app.css' already present in App.tsx ).
- **Task 7: Full-suite verification** — Run: cd apps/desktop && npx vitest run Expected: PASS — all suites including new TaskBoard , TimelineStrip , MainPanel , and rewritten PmHome . Run: pnpm --filter @apc/dashboard-api test Expected: PASS — including the allTasks test. Run: pnpm typecheck Expected: PASS — root + desktop typecheck clean. Manually confirm a

## Related

- Source: `docs/superpowers/plans/2026-06-07-pm-home-integration.md`
