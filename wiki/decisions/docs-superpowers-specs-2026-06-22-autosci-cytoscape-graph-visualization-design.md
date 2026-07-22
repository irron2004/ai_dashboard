---
title: AutoSci Cytoscape Graph Visualization — Design
slug: docs-superpowers-specs-2026-06-22-autosci-cytoscape-graph-visualization-design
sources: [docs/superpowers/specs/2026-06-22-autosci-cytoscape-graph-visualization-design.md]
status: accepted
date: 2026-06-22
topic: [graph-and-visualization]
---

## Context

Status: Approved (brainstorming) — pending implementation plan Replace the dashboard's hand-rolled SVG graph renderer ( apps/desktop/src/renderer/components/GraphVisualization.tsx ) with a port of the upstream AutoSci / ΩmegaWiki visualization ( AutoSci/app/modules/graph.js ) Cytoscape.js canvas + the obsidianForceLayout force-directed layout + the full interaction set (entity/edge styling, zoom-aware labels, search, entity filters, grouped/collapsible edge filters, preset views, BFS highlight, two-node path query, low-confidence toggle, edge hover tooltips). The new renderer is shared : it draws every graph the dashboard produces, including

## Decision

- **Goal** — Replace the dashboard's hand-rolled SVG graph renderer ( apps/desktop/src/renderer/components/GraphVisualization.tsx ) with a port of the upstream AutoSci / ΩmegaWiki visualization ( AutoSci/app/modules/graph.js ) Cytoscape.js canvas + the obsidianForceLayout force-directed layout + the full interaction set (entity/edg
- **Decisions (from brainstorming)** — the app is offline Electron with a CSP; a bundled dep is required). layoutGraph + SVG rendering are removed. buildPaperGraphData (paper) and buildHarnessGraphData (project-docs) → HarnessGraphData . We do NOT depend on AutoSci's tools/serve.py /api/graph server.
- **Non-Goals** — people/ideas/experiments/methods/foundations). Our vendored paper pack uses papers/modules/pipelines/ pipeline trials; that divergence stays. The renderer is vocabulary-agnostic. them). Styling that depends on those fields degrades gracefully when absent.
- **Architecture**
- **Components and modules** — Cytoscape and DOM-bound interaction code live in the component; the testable graph math/style/algorithm logic lives in the three pure modules.
- **Data enrichment** — HarnessGraphLink gains optional fields so AutoSci-style edge rendering has something to key on label string type · conf — that string concat is removed); map each paper edge type to a workflow group + direction via graph-style . edges are directional). No behavior change to which nodes/edges are produced.
- **Styling config ( graph-style.ts )** — entities ( papers/modules/pipelines/pipeline trials ). Unknown types fall back to a neutral gray. unknown types collect under "Other" (mirrors graph.js leftover handling, no silent drops). conf-high medium low weighting.
- **Interactions (component, mirrors graph.js)** — Left-click node = BFS highlight (depth from sidebar); right-click = set path start/end → highlight paths; double-click = onNodeClick(node) (opens the existing peek drawer); edge hover = tooltip (source/field/confidence/evidence when present); zoom = re-evaluate label visibility (hidden below a zoom threshold unless "al

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-22-autosci-cytoscape-graph-visualization-design.md`
