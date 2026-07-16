---
title: "Agent Project Console — Foundation & Common Core Implementation Plan (Plan 1 of 6)"
slug: docs-superpowers-plans-2026-06-01-agent-project-console-foundation
sources: [docs/superpowers/plans/2026-06-01-agent-project-console-foundation.md]
status: open
created: 2026-06-01
topic: [agent-runtime-and-sessions]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Stand up the monorepo and the Common Core packages (shared contracts, SQLite-backed ProjectRegistry, Obsidian vault adapter, conflict manager, local job runner) with full test coverage, so later plans (terminal/ingest, LLM Wiki, PM dashboard) build on a stable foundation. Architecture: A pnpm monorepo. @apc/shared holds Zod schemas (the single source of truth for contracts). @apc/core owns the SQLite database layer + Projec

## Progress log

- Source checklist: 0 completed, 50 remaining.
- **File Structure**
- **Prerequisite: tooling** — This plan needs Node ≥ 22.5 (for the built-in node:sqlite ; this box runs v24) and pnpm . Verify before Task 1
- **Task 1: Monorepo scaffold + toolchain smoke test** — package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts packages/shared/package.json packages/shared/src/index.ts packages/shared/src/smoke.test.ts Run Expected: 1 passed ( packages/shared/src/smoke.test.ts ).
- **Task 2: @apc/shared — Zod contracts** — packages/shared/src/schema.test.ts Run: pnpm test -- packages/shared/src/schema.test.ts Expected: FAIL — cannot resolve ./schema.js (module does not exist). packages/shared/src/schema.ts Replace packages/shared/src/index.ts with Run: pnpm test -- packages/shared/src/schema.test.ts Expected: PASS (4 describe blocks, all
- **Task 3: @apc/core — SQLite database + migrations** — packages/core/package.json (no native deps — DB is the built-in node:sqlite ) Run Expected: install completes with no native build step. packages/core/src/db.test.ts Run: pnpm test -- packages/core/src/db.test.ts Expected: FAIL — cannot resolve ./db.js . packages/core/src/db.ts packages/core/src/index.ts Run: pnpm test
- **Task 4: @apc/core — ProjectRegistry** — packages/core/src/project-registry.test.ts Run: pnpm test -- packages/core/src/project-registry.test.ts Expected: FAIL — cannot resolve ./project-registry.js . packages/core/src/project-registry.ts Replace packages/core/src/index.ts with Run: pnpm test -- packages/core/src/project-registry.test.ts Expected: PASS (4 tes
- **Task 5: @apc/vault — ObsidianVaultAdapter** — packages/vault/package.json Run: pnpm install packages/vault/src/vault-adapter.test.ts Run: pnpm test -- packages/vault/src/vault-adapter.test.ts Expected: FAIL — cannot resolve ./vault-adapter.js . packages/vault/src/vault-adapter.ts packages/vault/src/index.ts Run: pnpm test -- packages/vault/src/vault-adapter.test.t
- **Task 6: @apc/core — ConflictManager** — packages/core/src/conflict-manager.test.ts Run: pnpm test -- packages/core/src/conflict-manager.test.ts Expected: FAIL — cannot resolve ./conflict-manager.js . packages/core/src/conflict-manager.ts Replace packages/core/src/index.ts with Run: pnpm test -- packages/core/src/conflict-manager.test.ts Expected: PASS (4 tes

## Related

- Source: `docs/superpowers/plans/2026-06-01-agent-project-console-foundation.md`
