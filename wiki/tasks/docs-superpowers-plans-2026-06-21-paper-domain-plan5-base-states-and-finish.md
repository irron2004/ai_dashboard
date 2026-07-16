---
title: "Paper Domain — Plan 5: base-states overlay + finish (real generation)"
slug: docs-superpowers-plans-2026-06-21-paper-domain-plan5-base-states-and-finish
sources: [docs/superpowers/plans/2026-06-21-paper-domain-plan5-base-states-and-finish.md]
status: open
created: 2026-06-21
topic: [paper-domain]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox ( - [ ] ) syntax. NOTE: subagent monthly spend limit was hit in the prior session — these may need controller-direct execution until the limit is raised. Goal: Make a real domain:'paper' run clean and complete: (1) overlay the BASE states so paper runs never call project-docs LLM agents (the Plan 4 gap), then the finishing pieces — (2) PDF ingest via autosci-read, (3) typed edges → edges.jsonl , (4) package wiki-domains/ , (5) a real end-to-end LLM run. Architecture: makePaperDrivers already ove

## Progress log

- Source checklist: 0 completed, 5 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: base-states overlay (paper runs never call project-docs agents) — THIS PLAN'S CORE** — In paper-pipeline-routing.test.ts , change the third test ("paper overlay keeps the project-docs base states...") to assert the base states are now the PAPER-minimal ones, proving no project-docs agent runs Run: pnpm exec vitest run packages/knowledge-harness/src/runtime/paper-pipeline-routing.test.ts In paper-drivers.
- **Task 2 (follow-on): PDF ingest via autosci-read** — Extend WikiSubstrate.checkSources (or add ingest ) to return parsed text for raw/papers/ .pdf ; feed it into the extractor's sources alongside the SourceReader markdown/text. Currently only markdown/text in raw/ reaches the extractor.
- **Task 3 (follow-on): typed edges → wiki/graph/edges.jsonl** — Have the extractor (or a LEAD MERGED paper step) emit typed edges ( uses module / pipeline from paper / alternative to ); render them to /wiki/graph/edges.jsonl in STAGING WRITTEN so the kernel lints the graph and the UI shows edges.
- **Task 4 (follow-on): package wiki-domains/** — electron-builder extraResources for wiki-domains/ ; set/resolve APC PAPER CONTRACT DIR in the packaged app so resolvePaperContractDir() finds the contract (verify in a packaged build). The Windows-packaging clone ( win-packaging-clone ) is where this is built.
- **Task 5 (follow-on): real end-to-end LLM run** — On a machine with the venv (WSL/Linux): set the papers project domain=paper , run "생성", confirm it ingests the workspace docs, the LLM emits typed nodes, kernel lint gates, and the wiki promotes. This is the empirical proof the whole feature works.
- **Self-Review**

## Related

- Source: `docs/superpowers/plans/2026-06-21-paper-domain-plan5-base-states-and-finish.md`
