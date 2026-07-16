---
title: AutoSci Cytoscape Graph Visualization Implementation Plan
slug: docs-superpowers-plans-2026-06-22-autosci-cytoscape-graph-visualization
sources: [docs/superpowers/plans/2026-06-22-autosci-cytoscape-graph-visualization.md]
status: open
created: 2026-06-22
topic: [graph-and-visualization]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Replace the dashboard's hand-rolled SVG graph renderer with a port of AutoSci's graph.js (Cytoscape.js + obsidianForceLayout + the full interaction set), shared across paper and project-docs graphs. Architecture: The React component owns Cytoscape lifecycle and the sidebar; testable graph math lives in three pure modules ( graph-layout , graph-algorithms , graph-style ). Data still flows from the existing IPC builders ( bui

## Progress log

- Source checklist: 0 completed, 38 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: Add the cytoscape dependency** — Run: pnpm --filter @apc/desktop add cytoscape@^3.28.1 && pnpm --filter @apc/desktop add -D @types/cytoscape Expected: package.json gains cytoscape (dependencies) and @types/cytoscape (devDependencies); lockfile updates. cytoscape is pure JS — no electron-rebuild needed. Create a throwaway check, then delete it Run: nod
- **Task 2: graph-style module** — Run: pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-style.test.ts Expected: FAIL — graph-style.js cannot be resolved. Run: pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-style.test.ts Expected: PASS (6 tests).
- **Task 3: graph-layout module (obsidianForceLayout)** — Run: pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-layout.test.ts Expected: FAIL — graph-layout.js not found. Port obsidianForceLayout from AutoSci/app/modules/graph.js:242-341 , with the determinism deviation: replace the random initial scatter (L247, L250-251) and the degenerate-overlap random n
- **Task 4: graph-algorithms module (BFS + path query)** — Run: pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-algorithms.test.ts Expected: FAIL — module not found. Port highlightBFS (graph.js:524-548) as a pure set computation and computeAndHighlightPaths (graph.js:872-932) as a pure path enumerator. Run: pnpm --filter @apc/desktop exec vitest run src/ren
- **Task 5: Relocate graph types to graph-types.ts + enrich links** — Run: pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts -t "structured fields" Expected: FAIL — link.confidence is undefined and label is "pipeline from paper · high" . First create graph/graph-types.ts (canonical, host-agnostic home for the graph data shape — moved out of harness-utils so th
- **Task 6: Cytoscape component — canvas, mapping, core interactions** — This task delivers: cy element mapping from HarnessGraphData , the layout-seeded preset Cytoscape init, the entity/edge stylesheet (entity color by entityColor , edge color by edgeColor , dir-directed arrowheads, conf- weighting), node tap = BFS highlight, double-tap = onNodeClick , zoom-aware label visibility, and tea

## Related

- Source: `docs/superpowers/plans/2026-06-22-autosci-cytoscape-graph-visualization.md`
