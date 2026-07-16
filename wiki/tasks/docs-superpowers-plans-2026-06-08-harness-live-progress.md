---
title: Harness Live Progress Implementation Plan
slug: docs-superpowers-plans-2026-06-08-harness-live-progress
sources: [docs/superpowers/plans/2026-06-08-harness-live-progress.md]
status: open
created: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox ( - [ ] ) syntax. Goal: Stream per-stage progress from the harness run to the renderer so the user sees the current stage live during the multi-minute run. Architecture: Additive onProgress callback through HarnessRunner.advance → HarnessService.run → container emitHarnessProgress → harness:progress IPC event → preload onHarnessProgress → store → UI. Everything optional/fire-and-forget; the core run is unchanged when unwired. Tech Stack: TypeScript, Electron IPC events, React, Zustand, Vitest. Spec: docs/superpowers/specs/2026-06-08-harnes

## Progress log

- Source checklist: 0 completed, 24 remaining.
- **Task 1: HarnessRunner.advance(store, onProgress?)** — (Adapt identifiers — runner / store — to the file's existing setup. If the test file's run reaches a single terminal with few stages, assert seen contains the expected stage names that file's drivers produce.) In the success branch, AFTER store.saveRunState(runState) and ctx.runState = runState , add In the FAILED catc
- **Task 2: HarnessService.run(input, onProgress?) passthrough** — (Use the file's exact service constructor/ cannedOutputs() .) (a) advanceSafely gains the param and forwards it (b) run gains the param and passes it and change the advanceSafely call to return this.advanceSafely(runId, runner, store, onProgress) . Import RunState type from @apc/shared if not already imported.
- **Task 3: IPC channel + container emit + main + preload wiring** — and change harnessRun to pass an onProgress that emits (The onProgress param is (rs: RunState) = void ; rs.runId / rs.state are valid.) (Ensure win is in scope at the createContainer call — if the container is built before win , move the emit to use a late-bound ref, or construct the container after win . Read index.ts
- **Task 4: renderer store subscription + live stage UI** — ( api.onHarnessProgress returns the cleanup fn; returning it from the effect unsubscribes. Import useStore if not already; api is already imported.) with
- **Task 5: full verification**
- **Notes**

## Related

- Source: `docs/superpowers/plans/2026-06-08-harness-live-progress.md`
