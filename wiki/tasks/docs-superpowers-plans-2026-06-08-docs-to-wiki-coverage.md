---
title: Docs → Wiki One-Click + Coverage Verification Implementation Plan
slug: docs-superpowers-plans-2026-06-08-docs-to-wiki-coverage
sources: [docs/superpowers/plans/2026-06-08-docs-to-wiki-coverage.md]
status: open
created: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Add a one-click "generate wiki from all project docs" flow that first materializes every project document into the harness source area, then surfaces a coverage matrix (which source docs were reflected into wiki nodes, which were omitted) so the user can verify completeness. Architecture: Approach A — a trusted SourceMaterializer copies project docs into vault/raw/project-docs/ ; the existing 9-state Knowledge Harness pipel

## Progress log

- Source checklist: 0 completed, 45 remaining.
- **File Structure**
- **Task 1: Coverage schema + pure builder** — Create packages/knowledge-harness/src/eval/coverage-report.test.ts Run: npx vitest run packages/knowledge-harness/src/eval/coverage-report.test.ts Expected: FAIL — Cannot find module './coverage-report.js' (and buildCoverageReport / KhCoverageReport undefined). In packages/shared/src/kh-schema.ts , add (place it alongs
- **Task 2: Emit coverage-report artifact in the pipeline** — Open packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts . It already drives a full run with fake agents and inspects the finished run's artifacts. Locate the point where the run has reached HUMAN REVIEW REQUIRED and the artifacts are available (a show() result or the run state's artifacts). Add this as
- **Task 3: SourceMaterializer — copy project docs into the source area** — Create packages/app-services/src/source-materializer.test.ts Run: npx vitest run packages/app-services/src/source-materializer.test.ts Expected: FAIL — Cannot find module './source-materializer.js' . Create packages/app-services/src/source-materializer.ts In packages/app-services/src/index.ts , add an export line along
- **Task 4: Thread materialize through the service + IPC contract** — Open packages/app-services/src/harness-service.test.ts , reuse its existing HarnessService construction setup (temp vaultRoot / runsRoot /fake runner ). Add a test that materialize populates raw/project-docs/ before the run. Mirror the existing setup for building the service; add (Use the same tmp / vaultRoot / harness
- **Task 5: Store action — startHarnessRun(materialize?)** — Open apps/desktop/src/renderer/harness-store.test.tsx and reuse its existing api-mock setup. Add a test asserting the flag is forwarded (Use the same useStore / api import + project-selection arrangement the surrounding tests already use. If the existing tests assert api.harnessRun via a vi.mock('../api.js', ...) , rel
- **Task 6: CoverageMatrix component (pure)** — Create apps/desktop/src/renderer/components/CoverageMatrix.test.tsx Run: cd apps/desktop && npx vitest run src/renderer/components/CoverageMatrix.test.tsx Expected: FAIL — Cannot find module './CoverageMatrix.js' . Create apps/desktop/src/renderer/components/CoverageMatrix.tsx Run: cd apps/desktop && npx vitest run src
- **Task 7: Wire Coverage tab + "전 문서로 위키 생성" button into HarnessDashboard** — In apps/desktop/src/renderer/components/HarnessDashboard.tsx (a) Add the imports (near the other component + shared imports) (b) Change the Tab type (line 17) In HarnessDashboard.tsx , after currentRun is computed (the useMemo that finds the selected run bundle), add (a) Next to the existing Run harness button (around

## Related

- Source: `docs/superpowers/plans/2026-06-08-docs-to-wiki-coverage.md`
