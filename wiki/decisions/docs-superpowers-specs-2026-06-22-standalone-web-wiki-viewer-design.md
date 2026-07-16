---
title: Standalone Web Wiki Viewer (+ shared graph-view package) — Design
slug: docs-superpowers-specs-2026-06-22-standalone-web-wiki-viewer-design
sources: [docs/superpowers/specs/2026-06-22-standalone-web-wiki-viewer-design.md]
status: accepted
date: 2026-06-22
topic: [graph-and-visualization]
---

## Context

Status: Approved (brainstorming) — pending implementation plan Depends on: the graph/ module created on branch feat/cytoscape-graph-viz (not yet on main). This work must build on top of that branch (or its merge to main). Visualize an LLM wiki in the browser WITHOUT the Electron app — a standalone web page for previewing a wiki before opening the desktop app, or just for testing. Achieved by (1) extracting the existing graph visualization into a shared @apc/graph-view package, and (2) a small apps/graph-web Vite+React app that serves a wiki's graph over a tiny /api/graph endpoint, reusing the package + the existing wiki reader. export is a do

## Decision

- **Goal** — Visualize an LLM wiki in the browser WITHOUT the Electron app — a standalone web page for previewing a wiki before opening the desktop app, or just for testing. Achieved by (1) extracting the existing graph visualization into a shared @apc/graph-view package, and (2) a small apps/graph-web Vite+React app that serves a
- **Decisions (from brainstorming)** — export is a documented follow-up.) readProjectWiki reader) into @apc/graph-view , consumed by both desktop and the new web app. (Not a Vite path-alias hack.)
- **Non-Goals**
- **Architecture** — Two phases. One cohesive goal; Phase 1 is the enabling refactor for Phase 2.
- **Phase 1 — packages/graph-view (shared package)** — Move, don't rewrite. The graph/ folder is already self-contained (no host imports), so this is relocation + packaging + import updates. entry points: . (browser: component + builders + types + pure modules) and ./node (Node readProjectWiki ). Consumed as TS source like the other @apc/ workspace packages. harness-utils.
- **Phase 2 — apps/graph-web (standalone viewer)** — in its Vite config, @apc/graph-view/node ( readProjectWiki ). → {available, nodes, edges} JSON. The wiki dir comes from process.env.WIKI DIR (set by the run wrapper). No separate server process, no proxy — one Vite dev server. ; else show an "no wiki / empty graph" message. onNodeClick opens the node's relPath (e.g. a
- **Data flow**
- **Error handling** — → page shows a friendly empty state. ( readProjectWiki already never-throws.)

## Consequences

- **Risks / notes** — packages; electron-vite (desktop) and vite (graph-web) transpile it. The ./node subpath must be Node-only (never imported by browser code) — enforced by keeping read-wiki.ts out of the . entry. on that branch or stack a new branch on it (the graph module isn't on main yet).

## Related

- Source: `docs/superpowers/specs/2026-06-22-standalone-web-wiki-viewer-design.md`
