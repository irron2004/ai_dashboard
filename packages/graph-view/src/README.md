# graph — portable Cytoscape graph-viz module

A self-contained, extractable React + Cytoscape graph-visualization module.
No imports from host-app internals (no IPC, no store, no harness-utils).
Drop the folder into any React project, wire one callback, and the graph works.

---

## Public API (`graph/index.ts`)

```ts
// Component
export { GraphVisualization } from './GraphVisualization.js'

// Types
export type { GraphData, GraphNode, GraphLink, GraphNodeType, GraphShape } from './graph-types.js'

// Pure layout
export { obsidianForceLayout } from './graph-layout.js'

// Pure graph algorithms
export { buildAdjacency, bfsNeighborhood, findPaths } from './graph-algorithms.js'
```

---

## Data contract — `GraphData`

```ts
interface GraphData {
  nodes: GraphNode[]   // { id, label, type, ... }
  links: GraphLink[]   // { id, source, target, kind, label?, confidence?, direction?, workflow? }
}
```

`GraphNode.type` and `GraphLink.kind` are free-form strings. The styling module
(`graph-style.ts`) maps unknown values to sensible fallback colors, so any schema
(paper domain, project-docs, custom) renders without modification.

---

## Host coupling (single callback)

```tsx
<GraphVisualization
  data={graphData}          // GraphData — the full graph to render
  onNodeClick={handleClick} // (node: GraphNode) => void — called on double-tap
/>
```

That is the entire host coupling. All other interactions (BFS highlight, search,
edge/entity filters, preset views, path query, edge tooltips, node info panel) are
self-contained inside the component.

---

## Runtime dependencies

| Dependency | Version constraint | Notes |
|---|---|---|
| `react` | ≥18 | Peer dep |
| `cytoscape` | ≥3.28 | Direct dep — installed in the graph folder's package or host |

No other runtime deps beyond sibling `./` module imports.

---

## Styling — CSS classes the consumer must include

The component renders into CSS classes defined in `app.css` (or an equivalent
stylesheet). An extractor needs to carry these class names:

| Class | Purpose |
|---|---|
| `.graph-visualization` | Root `<section>` — applies `.panel` chrome |
| `.graph-visualization__header` | `<header>` — `align-items: center` |
| `.graph-visualization__body` | Flex row: canvas + sidebar |
| `.graph-visualization__sidebar` | Right-hand controls pane |
| `.cy-canvas` | **Cytoscape mount div — MUST have an explicit height** (`min-height: 540px`). Without it Cytoscape renders blank. |
| `.sidebar-section` | Each control group in the sidebar |
| `.sidebar-section__title` | Section heading (uppercase label) |
| `.graph-search` | Search `<input>` |
| `.search-results` / `.search-item` | Search result dropdown |
| `.entity-filter-row` | Per-entity-type checkbox row |
| `.edge-group` | Collapsible `<details>` for an edge workflow group |
| `.edge-type-row` | Per-edge-type checkbox row inside a group |
| `.preset-btn` / `.preset-btn--active` | Preset-view toggle buttons |
| `.preset-reset` | "All on" reset button |
| `.edge-tooltip` | Floating DOM tooltip (appended to `document.body`) |
| `.node-info-panel` | Node info section in sidebar |
| `.path-status` | Path-query status text |
| `.dot` | Inline color dot (entity/edge legend) |

### Styling is data-driven

`graph-style.ts` maps entity types and edge labels to colors/shapes via lookup
tables with fallback defaults. An unknown entity type gets a neutral grey; an
unknown edge label gets a default workflow bucket. The consumer feeds its own
schema via `GraphData` — no style configuration required.

---

## Interaction summary

| Gesture | Behavior |
|---|---|
| Single tap (node) | BFS highlight (depth 2) + show node info panel |
| Single tap (background) | Clear highlight |
| Double-tap (node) | Call `onNodeClick(node)` — host opens peek/reader |
| Right-click (node) | Path query: pick start then end node |
| Hover (edge) | Floating edge tooltip (label, confidence, workflow) |
| Zoom ≥ 1.4× | Node labels auto-show |
| Sidebar search | Fuzzy match by label/id, center + BFS on select |
| Entity filters | Toggle entity-type visibility |
| Edge filters | Toggle per-type and per-workflow-group visibility |
| Preset views | One-click filter to a workflow bucket (Provenance / Composition / Evidence / Relations) |
| "Hide low-confidence" | Suppress `conf-low` edges |
| "Always show labels" | Force labels at all zoom levels |
| Clear path | Reset path-query state |
