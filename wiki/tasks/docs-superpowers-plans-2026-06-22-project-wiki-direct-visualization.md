---
title: Project Wiki Direct Visualization Implementation Plan
slug: docs-superpowers-plans-2026-06-22-project-wiki-direct-visualization
sources: [docs/superpowers/plans/2026-06-22-project-wiki-direct-visualization.md]
status: open
created: 2026-06-22
topic: [graph-and-visualization]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Visualize the selected project's existing /wiki/ (AutoSci layout: graph/edges.jsonl + / .md ) directly in the Cytoscape graph, toggled against the existing latest-run graph. Architecture: A pure main-process reader parses the wiki off disk; a new readProjectWiki IPC resolves the project's repo→wiki and returns {nodes, edges} ; a renderer buildWikiGraphData maps that to GraphData ; KnowledgeView adds a run↔wiki toggle and fe

## Progress log

- Source checklist: 0 completed, 25 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: Extend graph entity vocabulary (AutoSci entity colors)** — Run: pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-style.test.ts -t "AutoSci entity" Expected: FAIL — entityColor('concepts') returns the gray fallback 95A5A6 (not matched by the order assertion, and order excludes concepts/methods). In graph-style.ts , extend ENTITY COLORS (add the AutoSci entity
- **Task 2: Main-process wiki reader** — Run: pnpm --filter @apc/desktop exec vitest run src/main/project-wiki.test.ts Expected: FAIL — module not found. Run: pnpm --filter @apc/desktop exec vitest run src/main/project-wiki.test.ts Expected: PASS (2 tests).
- **Task 3: IPC plumbing for readProjectWiki** — This task is plumbing mirroring the existing harnessReadGraphEdges channel (already in the codebase — read it for the exact shape). No new test file; verified by typecheck + the existing ipc.test.ts still passing. and add the types (after the HarnessReadGraphEdges block) ( GraphEdgeDto already exists in this file — reu
- **Task 4: buildWikiGraphData (renderer builder)** — Add buildWikiGraphData to the import line at the top of the test file. Run: pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts -t "buildWikiGraphData" Expected: FAIL — buildWikiGraphData is not a function . Note on colorForNode : it is the existing local helper in harness-utils. If it does no
- **Task 5: KnowledgeView — run↔wiki toggle + wiring** — (Match the file's existing mocking style for api / useStore ; the existing KnowledgeView tests show the pattern.) Run: pnpm --filter @apc/desktop exec vitest run src/renderer/components/KnowledgeView.test.tsx -t "toggle" Expected: FAIL — no such buttons. In KnowledgeView.tsx (Replace the existing effectiveGraph assignm
- **Self-Review notes**

## Related

- Source: `docs/superpowers/plans/2026-06-22-project-wiki-direct-visualization.md`
