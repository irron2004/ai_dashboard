---
title: Agent Project Console — Ingest Engine Implementation Plan (Plan 2 of 6)
slug: docs-superpowers-plans-2026-06-01-agent-project-console-ingest-engine
sources: [docs/superpowers/plans/2026-06-01-agent-project-console-ingest-engine.md]
status: open
created: 2026-06-01
topic: [agent-runtime-and-sessions]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Read real Claude Code / Codex / OpenCode session logs, normalize them into a common NormalizedSession shape, store an incremental watermark per source so re-ingest only reads new data, redact secrets, and index turns for full-text search — all pure Node + node:sqlite , no Electron. Architecture: @apc/agents holds one AgentIngestAdapter per provider that turns provider-specific storage (JSONL files for Claude/Codex, the open

## Progress log

- Source checklist: 0 completed, 42 remaining.
- **File Structure** — Add aliases for @apc/agents and @apc/search to vitest.config.ts (mirroring the existing @apc/ entries).
- **Task 1: Ingest contracts in @apc/shared** — Run: pnpm test -- packages/shared/src/ingest-schema.test.ts Expected: FAIL — cannot resolve ./ingest-schema.js . Add to packages/shared/src/index.ts : export from './ingest-schema.js' Run: pnpm test -- packages/shared/src/ingest-schema.test.ts → PASS (4 tests).
- **Task 2: IngestCursorStore in @apc/core** — Run: pnpm test -- packages/core/src/ingest-cursor-store.test.ts → FAIL (no module).
- **Task 3: @apc/agents scaffold + adapter interface + redaction** — packages/agents/package.json packages/agents/src/types.ts In vitest.config.ts resolve.alias , add packages/agents/src/index.ts (The adapter exports will resolve once Tasks 4–6 create those files; for this task, temporarily export only ./types.js and ./redact.js , then add the others in their tasks.) packages/agents/src
- **Task 4: ClaudeAdapter**
- **Task 5: CodexAdapter**
- **Task 6: OpenCodeAdapter (SQLite, incremental by time updated )**
- **Task 7: @apc/search — FTS5 index over turns** — packages/search/package.json packages/search/src/index.ts

## Related

- Source: `docs/superpowers/plans/2026-06-01-agent-project-console-ingest-engine.md`
