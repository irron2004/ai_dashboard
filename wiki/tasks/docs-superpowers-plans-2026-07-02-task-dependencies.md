---
title: "Implementation Plan — P1: Task 의존성(전후관계) 모델"
slug: docs-superpowers-plans-2026-07-02-task-dependencies
sources: [docs/superpowers/plans/2026-07-02-task-dependencies.md]
status: open
created: 2026-07-02
topic: [project-management]
---

## Summary

Give Tasks a first-class dependency edge ( blockedBy: string[] ) and surface it end-to-end 1. Schema + persistence : blockedBy on TaskSchema , a blocked by JSON column in the tasks table (idempotent migration), round-tripped by TaskStore . 2. Write path : a taskSetBlockedBy IPC command (contract → handler → container → renderer api) with a self-reference + direct-cycle guard. 3. TaskBoard 차단 표시 : a 🚫 차단 badge on any card with unresolved blockers, plus a minimal ⛓ dependency editor. 4. Work graph : task→task edges ( kind: 'blocks' ) in buildWorkGraphData , wired through KnowledgeView . 5. "다음 할 일" (Next Up) widget : unblocked todo / in progres

## Progress log

- Source checklist: 0 completed, 0 remaining.
- **Goal** — Give Tasks a first-class dependency edge ( blockedBy: string[] ) and surface it end-to-end 1. Schema + persistence : blockedBy on TaskSchema , a blocked by JSON column in the tasks table (idempotent migration), round-tripped by TaskStore . 2. Write path : a taskSetBlockedBy IPC command (contract → handler → container →
- **Architecture (data flow this plan touches)**
- **Tech stack**
- **Global constraints (read before every task)** — scopes in use: shared , pm , desktop , knowledge , graph-view , app-services .
- **Task 1 — blockedBy on the schema + green the whole tree**
- **Files**
- **Interface**
- **Steps** — 1. Failing test — add to the describe('TaskSchema', ...) block in packages/shared/src/schema.test.ts Run: npx vitest run packages/shared/src/schema.test.ts → fails ( blockedBy is undefined — property does not exist yet). 2. Implement — in packages/shared/src/schema.ts , add the field to TaskSchema immediately after lin

## Related

- Source: `docs/superpowers/plans/2026-07-02-task-dependencies.md`
