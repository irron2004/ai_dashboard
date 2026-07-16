---
title: Agent Project Console — Knowledge Retrieval Core Implementation Plan
slug: docs-superpowers-plans-2026-06-01-agent-project-console-knowledge-retrieval-core
sources: [docs/superpowers/plans/2026-06-01-agent-project-console-knowledge-retrieval-core.md]
status: open
created: 2026-06-01
topic: [knowledge-and-search]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Build a qmd-inspired local retrieval engine that indexes Obsidian-compatible project Markdown, attaches PM context semantics, and produces agent-friendly context packages for tasks. Architecture: Add a new pure-Node engine package, @apc/knowledge , instead of overloading @apc/search (which currently indexes normalized agent-session turns). @apc/knowledge owns collection/context config, Markdown document indexing, heading-aw

## Progress log

- Source checklist: 0 completed, 51 remaining.
- **File Structure**
- **MVP / Deferred Cut**
- **MVP in this plan**
- **Deferred**
- **Task 1: Knowledge contracts in @apc/shared** — Run: pnpm test -- packages/shared/src/knowledge-schema.test.ts Expected: FAIL — cannot resolve ./knowledge-schema.js . Modify packages/shared/src/index.ts Run: pnpm test -- packages/shared/src/knowledge-schema.test.ts Expected: PASS — 3 tests pass.
- **Task 2: @apc/knowledge scaffold and migrations** — Run: pnpm test -- packages/knowledge/src/migrate.test.ts Expected: FAIL — package alias or migrateKnowledge does not exist. packages/knowledge/package.json packages/knowledge/src/index.ts Modify vitest.config.ts alias block Run: pnpm test -- packages/knowledge/src/migrate.test.ts Expected: PASS — 2 tests pass.
- **Task 3: pmw:// URI helpers and local config discovery** — packages/knowledge/src/uri.test.ts packages/knowledge/src/local-config.test.ts Run: pnpm test -- packages/knowledge/src/uri.test.ts packages/knowledge/src/local-config.test.ts Expected: FAIL — modules do not exist. packages/knowledge/src/uri.ts packages/knowledge/src/local-config.ts Modify packages/knowledge/src/index.
- **Task 4: Markdown chunker** — Run: pnpm test -- packages/knowledge/src/chunker.test.ts Expected: FAIL — module does not exist. Modify packages/knowledge/src/index.ts Run: pnpm test -- packages/knowledge/src/chunker.test.ts Expected: PASS — 2 tests pass.

## Related

- Source: `docs/superpowers/plans/2026-06-01-agent-project-console-knowledge-retrieval-core.md`
