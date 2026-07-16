---
title: Agent Project Console — PM Domain Implementation Plan (Plan 4 of 6)
slug: docs-superpowers-plans-2026-06-01-agent-project-console-pm-domain
sources: [docs/superpowers/plans/2026-06-01-agent-project-console-pm-domain.md]
status: open
created: 2026-06-01
topic: [project-management]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox ( - [ ] ) syntax. Goal: Implement the PM core loop as testable services: persist Tasks / AgentRuns / Reviews in SQLite, drive the review lifecycle state machine (approve / needs-changes / reject → next-task creation), write PM artifacts into the Obsidian vault, and expose a single getProjectDashboard aggregate for the UI. Architecture: @apc/pm owns the domain: migratePm creates tasks / agent runs / reviews tables; TaskStore / AgentRunStore / ReviewStore are thin SQLite repositories over @apc/sha

## Progress log

- Source checklist: 0 completed, 35 remaining.
- **File Structure** — Add @apc/pm and @apc/dashboard-api aliases to vitest.config.ts .
- **Task 1: @apc/pm scaffold + migratePm** — packages/pm/package.json packages/pm/src/index.ts (Export only ./migrate.js now; add the rest per task.)
- **Task 2: TaskStore**
- **Task 3: AgentRunStore**
- **Task 4: ReviewService — persist + lifecycle state machine**
- **Task 5: VaultWriter — PM artifacts (canonical-safe)**
- **Task 6: @apc/dashboard-api — getProjectDashboard aggregate** — packages/dashboard-api/package.json
- **Definition of Done (Plan 4)**

## Related

- Source: `docs/superpowers/plans/2026-06-01-agent-project-console-pm-domain.md`
