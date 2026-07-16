---
title: Harness Run UX + Engine cwd Implementation Plan
slug: docs-superpowers-plans-2026-06-08-harness-run-ux-and-cwd
sources: [docs/superpowers/plans/2026-06-08-harness-run-ux-and-cwd.md]
status: open
created: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Make harness-run failures actionable (surface the real CLI error), run the engine CLI in the user's project folder, and show run status (loading/failure) on the Coverage tab while guarding promote so a FAILED run can't be promoted with a confusing error. Architecture: (d) LlmAgent includes the captured res.raw in its thrown error; (e) thread a cwd (the project's repoPath) through RunInput → CliAgentRunner spawn and through

## Progress log

- Source checklist: 0 completed, 28 remaining.
- **File Structure**
- **Task 1: (d) Surface real CLI error + (e) forward cwd in LlmAgent** — In packages/knowledge-harness/src/agents/llm-agent.test.ts , add these tests (import z from zod and the AgentRunner / RunInput types from @apc/llm-wiki if not already imported; construct a minimal agent — adapt to any existing helper in the file) Run: npx vitest run packages/knowledge-harness/src/agents/llm-agent.test.
- **Task 2: (e) CliAgentRunner spawns in the given cwd** — In packages/llm-wiki/src/cli-agent-runner.test.ts , add (uses a real node child that prints its cwd — deterministic, no network/engine needed) (If the file uses a different import name than CliAgentRunner , adapt. process.execPath is the node binary, guaranteed present.) Run: npx vitest run packages/llm-wiki/src/cli-ag
- **Task 3: (e) Thread projectCwd (repoPath) through make-drivers + harness-service** — In packages/app-services/src/harness-service.test.ts , add a test that runs with repoPaths and asserts the injected runner received that cwd. Build the service with a FakeAgentRunner you hold a reference to (mirror the file's existing service() setup — same ws / cannedOutputs() / gatesPath / now ) ( FakeAgentRunner is
- **Task 4: (b) Coverage tab shows loading / failure / coverage** — In apps/desktop/src/renderer/components/HarnessDashboard.tsx , replace the coverage tab block (currently lines ~121-125) with Append to apps/desktop/src/renderer/app.css (If .harness-dashboard placeholder is not defined in app.css, that's fine — the base div still renders; this rule only adds the error color.) Run: cd
- **Task 5: (c) Guard promote unless the run is HUMAN REVIEW REQUIRED** — In apps/desktop/src/renderer/components/HarnessDashboard.tsx , after currentRun is computed (near the coverageData line), add Then change the canonical proposal button (currently disabled={harnessLoading} at line ~137) to And pass canPromote to the config panel — change the props (around line 149-161) to add In apps/de
- **Task 6: Full-suite verification** — Expected: all green, typecheck clean. 1. CLI failure reason includes engine + real error. ✔ (Task 1) 2. Harness runs CLI with repoPath as cwd. ✔ (Task 2/3) 3. Coverage tab shows loading/failure/coverage by state. ✔ (Task 4) 4. Promote disabled unless HUMAN REVIEW REQUIRED. ✔ (Task 5) 5. New + existing tests + typecheck
- **Notes for the implementer**

## Related

- Source: `docs/superpowers/plans/2026-06-08-harness-run-ux-and-cwd.md`
