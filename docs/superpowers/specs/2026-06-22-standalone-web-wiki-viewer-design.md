# Standalone Web Wiki Viewer (+ shared graph-view package) — Design

Date: 2026-06-22
Status: Approved (brainstorming) — pending implementation plan
Depends on: the `graph/` module created on branch `feat/cytoscape-graph-viz` (not yet on main). This work
must build on top of that branch (or its merge to main).

## Goal

Visualize an LLM wiki in the browser WITHOUT the Electron app — a standalone web page for previewing a
wiki before opening the desktop app, or just for testing. Achieved by (1) extracting the existing graph
visualization into a shared `@apc/graph-view` package, and (2) a small `apps/graph-web` Vite+React app that
serves a wiki's graph over a tiny `/api/graph` endpoint, reusing the package + the existing wiki reader.

## Decisions (from brainstorming)

- **Approach A:** a Node-backed web app (tiny server + web UI), NOT a static single-HTML export. (Static
  export is a documented follow-up.)
- **Shared via a package:** extract `graph/` (+ the host-agnostic `buildWikiGraphData` + the Node
  `readProjectWiki` reader) into `@apc/graph-view`, consumed by both desktop and the new web app. (Not a
  Vite path-alias hack.)
- v1: a single wiki path argument, dev-mode browser preview.

## Non-Goals

- Static single-HTML export (follow-up).
- Switching wikis from the web UI, production build/deploy (follow-up).
- Putting any of this in `autosci-core` (it is a Python kernel — wrong stack).
- Changing the graph component's contract (still `GraphData` + `onNodeClick`).

## Architecture

Two phases. One cohesive goal; Phase 1 is the enabling refactor for Phase 2.

### Phase 1 — `packages/graph-view` (shared package)

Move, don't rewrite. The `graph/` folder is already self-contained (no host imports), so this is
relocation + packaging + import updates.

| What | From → To |
|------|-----------|
| graph-types, graph-layout, graph-algorithms, graph-style, GraphVisualization, index, README | `apps/desktop/src/renderer/graph/*` → `packages/graph-view/src/*` |
| `buildWikiGraphData` + the GraphData-shaping helpers it needs (`addNode`, `addLink`, `colorForNode`) | `apps/desktop/src/renderer/harness-utils.ts` → `packages/graph-view/src/build-graph.ts` |
| `readProjectWiki` (pure Node fs reader) | `apps/desktop/src/main/project-wiki.ts` → `packages/graph-view/src/node/read-wiki.ts`, exported via the `@apc/graph-view/node` subpath |

- **Package:** `@apc/graph-view`. `cytoscape` = dependency; `react`/`react-dom` = peerDependencies. Two
  entry points: `.` (browser: component + builders + types + pure modules) and `./node` (Node:
  `readProjectWiki`). Consumed as TS source like the other `@apc/*` workspace packages.
- **Desktop keeps** the harness-data-specific builders (`buildHarnessGraphData`, `buildPaperGraphData`) in
  `harness-utils.ts`; they import types + helpers from `@apc/graph-view`. Desktop's
  `components/GraphVisualization.tsx` shim, `KnowledgeView.tsx`, and `main/project-wiki.ts` consumers
  re-point to `@apc/graph-view` / `@apc/graph-view/node`.
- **Tests move with their code** (graph-view's pure-module/component/buildWikiGraphData tests; readProjectWiki
  test). Desktop's remaining tests must stay green after the import updates.
- **Invariant:** the desktop app behaves identically after Phase 1 (pure refactor); full desktop suite green.

### Phase 2 — `apps/graph-web` (standalone viewer)

- **Vite + React app** importing `@apc/graph-view` (`GraphVisualization`, `buildWikiGraphData`, types) and,
  in its Vite config, `@apc/graph-view/node` (`readProjectWiki`).
- **Data endpoint:** a small Vite **middleware plugin** serves `GET /api/graph` → `readProjectWiki(wikiDir)`
  → `{available, nodes, edges}` JSON. The wiki dir comes from `process.env.WIKI_DIR` (set by the run
  wrapper). No separate server process, no proxy — one Vite dev server.
- **Page:** on mount, `fetch('/api/graph')` → if `available`, `buildWikiGraphData(nodes, edges)` →
  `<GraphVisualization data={graph} onNodeClick={…}/>`; else show an "no wiki / empty graph" message.
  `onNodeClick` opens the node's `relPath` (e.g. a `fetch('/api/doc?relPath=…')` follow-up, or v1: just
  surface the ref — keep node-open minimal in v1).
- **Run:** `pnpm graph-web <wikiPath>` — a root `package.json` script (or a tiny wrapper) sets
  `WIKI_DIR=<wikiPath>` and runs `vite` for `apps/graph-web`, opening the browser.

### Data flow

```
pnpm graph-web <wikiPath>
  → WIKI_DIR set → vite dev (apps/graph-web) with /api/graph middleware
  → browser: GET /api/graph → readProjectWiki(WIKI_DIR) → { available, nodes, edges }
  → buildWikiGraphData(nodes, edges) → GraphData → <GraphVisualization/> (Cytoscape)
```

## Error handling

- No wiki / no `graph/edges.jsonl` → `readProjectWiki` returns `{available:false}` → `/api/graph` returns it
  → page shows a friendly empty state. (`readProjectWiki` already never-throws.)
- Bad `WIKI_DIR` (unset/nonexistent) → treated as not-available; page shows guidance to pass a wiki path.

## Testing

- **Phase 1:** the moved tests run in the new package (`pnpm --filter @apc/graph-view test`) and stay green;
  the full desktop suite stays green after import updates (proves the refactor didn't change behavior).
- **Phase 2:** unit-test the `/api/graph` middleware handler against a temp wiki dir (reusing the reader);
  a mount/smoke test of the page (mock `fetch('/api/graph')`, assert it builds + renders without error —
  cytoscape mocked, mirroring the existing component test).

## Risks / notes

- Workspace TS package consumption: `@apc/graph-view` is consumed as TS source like existing `@apc/*`
  packages; electron-vite (desktop) and vite (graph-web) transpile it. The `./node` subpath must be
  Node-only (never imported by browser code) — enforced by keeping `read-wiki.ts` out of the `.` entry.
- Branch strategy: this builds on `feat/cytoscape-graph-viz`. Decide at execution time whether to continue
  on that branch or stack a new branch on it (the graph module isn't on main yet).
- React peer version must match desktop (^18) and graph-web (^18).

## Out-of-scope follow-ups

- Static single-HTML export (approach B) for serverless sharing.
- Web UI wiki switching / folder picker; production build + hosting.
- Publishing `@apc/graph-view` outside the monorepo; injectable style config for arbitrary vocabularies.
