---
title: "Paper Domain — Plan 4: wire the paper pipeline + route papers (e2e)"
slug: docs-superpowers-plans-2026-06-20-paper-domain-plan4-wire-and-route
sources: [docs/superpowers/plans/2026-06-20-paper-domain-plan4-wire-and-route.md]
status: open
created: 2026-06-20
topic: [paper-domain]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Make a domain:'paper' run actually generate a paper wiki: route the harness through a paper-drivers overlay that runs the extractor (3b) → renders typed nodes (3) → gates with kernel lint (2), reusing the existing run/staging/promote/UI machinery. Prove it end-to-end on a source fixture; keep project-docs byte-identical. Architecture: makeDrivers returns the existing project-docs drivers, overlaid with paper-specific driver

## Progress log

- Source checklist: 0 completed, 15 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: Thread domainPack + substrate into DriverDeps (no behavior change)** — Run: pnpm exec vitest run packages/app-services/src/harness-service.domain.test.ts Expected: FAIL — buildVenvSubstrate not exported. In make-drivers.ts DriverDeps (around line 31), add In harness-service.ts Run: pnpm exec vitest run packages/app-services/src/harness-service.domain.test.ts Then: pnpm exec vitest run pac
- **Task 2: makePaperDrivers overlay (extract → render → validate)** — Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/paper-drivers.test.ts Expected: FAIL — makePaperDrivers not defined. At the END of makeDrivers (before return { ... } of the project-docs drivers), capture the project-docs object and overlay (Refactor the existing return { PROJECT SCANNED: ..., ... } to
- **Task 3: e2e (paper source fixture → HUMAN REVIEW, lint green) + project-docs regression** — Build a run whose raw/ holds a tiny source doc, whose engine runner is FAKE and returns a canned { nodes: [...] } of valid paper nodes (reuse the golden papers/modules node fields so lint passes), with domainPack: paperPack and a REAL PythonKernelAdapter substrate (gated on core.lock venv + winRunnable , skipping on na
- **Self-Review**
- **Follow-on (Plan 5)** — PDF ingest via autosci-read ( WikiSubstrate.checkSources → parsed text feeding the extractor); typed-edge construction ( uses module /etc → wiki/graph/edges.jsonl ); package wiki-domains/ into the Electron build (electron-builder extraResources + verify APC PAPER CONTRACT DIR / resolvePaperContractDir in the packaged a
- **Execution Handoff** — (see skill — offered after save)

## Related

- Source: `docs/superpowers/plans/2026-06-20-paper-domain-plan4-wire-and-route.md`
