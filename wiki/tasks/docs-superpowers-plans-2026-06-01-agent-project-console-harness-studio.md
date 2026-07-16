---
title: Agent Project Console — Harness Studio (read + select) Implementation Plan (Plan 5 of 6)
slug: docs-superpowers-plans-2026-06-01-agent-project-console-harness-studio
sources: [docs/superpowers/plans/2026-06-01-agent-project-console-harness-studio.md]
status: open
created: 2026-06-01
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox ( - [ ] ) syntax. Goal: Read OpenCode agent configuration into a normalized, read-only AgentProfile model the PM can browse, and persist which profile the PM selects to run a given task. No editing, no writes to any tool's config, and credential files are never read. Architecture: @apc/harness defines AgentConfigAdapter (read-only). OpenCodeConfigAdapter reads OpenCode's documented agent sources — the agent map in opencode.json / opencode.jsonc and markdown agent files (YAML frontmatter + prompt

## Progress log

- Source checklist: 0 completed, 25 remaining.
- **File Structure** — Add @apc/harness alias to vitest.config.ts .
- **Task 1: AgentProfile contract in @apc/shared**
- **Task 2: @apc/harness scaffold + adapter interface + JSONC parser** — packages/harness/package.json packages/harness/src/types.ts packages/harness/src/index.ts (Export only ./types.js + ./jsonc.js now; add the rest per task.)
- **Task 3: OpenCodeConfigAdapter — read profiles (json map + markdown agents)** — 1. /.opencode/opencode.json or .jsonc → top-level agent object (each key = an agent; value may have model / mode / description / permission / tools / temperature / prompt ) → AgentProfile (scope project , rawFormat json ). 2. markdown agent files in /.opencode/agent/ .md (and agents/ .md ) → YAML frontmatter ( descript
- **Task 4: migrateHarness + TaskProfileStore (persist PM's selection)** — src/migrate.ts src/task-profile-store.ts
- **Definition of Done (Plan 5)**
- **Deferred (P1+, per spec §9.5)**

## Related

- Source: `docs/superpowers/plans/2026-06-01-agent-project-console-harness-studio.md`
