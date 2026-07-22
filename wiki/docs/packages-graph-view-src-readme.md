---
title: graph — portable Cytoscape graph-viz module
slug: packages-graph-view-src-readme
sources: [packages/graph-view/src/README.md]
topic: [graph-and-visualization]
---

## Summary

A self-contained, extractable React + Cytoscape graph-visualization module. No imports from host-app internals (no IPC, no store, no harness-utils). Drop the folder into any React project, wire one callback, and the graph works. export { GraphVisualization } from './GraphVisualization.js' export type { GraphData, GraphNode, GraphLink, GraphNodeType, GraphShape } from './graph-types.js' export { obsidianForceLayout } from './graph-layout.js' export { buildAdjacency, bfsNeighborhood, findPaths } from './graph-algorithms.js' nodes: GraphNode[] // { id, label, type, ... } links: GraphLink[] // { id, source, target, kind, label?, confidence?, dire

## Content map

- **Public API ( graph/index.ts )**
- **Data contract — GraphData** — GraphNode.type and GraphLink.kind are free-form strings. The styling module ( graph-style.ts ) maps unknown values to sensible fallback colors, so any schema (paper domain, project-docs, custom) renders without modification.
- **Host coupling (single callback)** — That is the entire host coupling. All other interactions (BFS highlight, search, edge/entity filters, preset views, path query, edge tooltips, node info panel) are self-contained inside the component.
- **Runtime dependencies** — No other runtime deps beyond sibling ./ module imports.
- **Styling — CSS classes the consumer must include** — The component renders into CSS classes defined in app.css (or an equivalent stylesheet). An extractor needs to carry these class names
- **Styling is data-driven** — graph-style.ts maps entity types and edge labels to colors/shapes via lookup tables with fallback defaults. An unknown entity type gets a neutral grey; an unknown edge label gets a default workflow bucket. The consumer feeds its own schema via GraphData — no style configuration required.
- **Interaction summary**

## Related

- Source: `packages/graph-view/src/README.md`
