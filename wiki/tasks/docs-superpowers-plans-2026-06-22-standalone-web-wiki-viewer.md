---
title: Standalone Web Wiki Viewer Implementation Plan
slug: docs-superpowers-plans-2026-06-22-standalone-web-wiki-viewer
sources: [docs/superpowers/plans/2026-06-22-standalone-web-wiki-viewer.md]
status: open
created: 2026-06-22
topic: [graph-and-visualization]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Visualize an LLM wiki in the browser with no Electron — extract the graph viz into @apc/graph-view , then a tiny apps/graph-web Vite app serves a wiki's graph via /api/graph . Architecture: Phase 1 relocates the already-self-contained graph/ module (+ buildWikiGraphData + the Node readProjectWiki ) into a shared workspace package consumed by desktop and the new web app. Phase 2 is a Vite+React app whose Vite middleware expo

## Progress log

- Source checklist: 0 completed, 37 remaining.
- **Global Constraints**
- **File Structure** — After this plan
- **Task 1: Scaffold the @apc/graph-view package** — Read packages/wiki-substrate/package.json and packages/wiki-substrate/tsconfig.json (or another small @apc/ package) to copy the exact type , exports / main , scripts (test = vitest), and tsconfig extends conventions this monorepo uses. Match them. Mirror the sibling package, with (If sibling packages point exports at
- **Task 2: Move the graph module + builders + reader into @apc/graph-view ; repoint desktop** — This is the extraction — atomic by nature (desktop breaks mid-move, so move + repoint in one task; the gate is "desktop suite + typecheck green"). (Internal imports among these are relative ./ — they stay valid after the move. The placeholder index.ts is replaced in Step 4.) The reader imports only node:fs / node:path
- **Task 3: Scaffold the apps/graph-web Vite app** — Run: pnpm install --config.minimumReleaseAge=0 --config.block-exotic-subdeps=false Run: pnpm --filter @apc/graph-web build Expected: a clean production build (placeholder).
- **Task 4: /api/graph Vite middleware (reads the wiki via @apc/graph-view/node)** — Run: npx tsc -p apps/graph-web/tsconfig.json --noEmit → 0 errors (add this tsconfig if missing; include vite.config via a node tsconfig or // @ts-check -free is fine — ensure the app typechecks).
- **Task 5: The viewer page (fetch → buildWikiGraphData → GraphVisualization)**
- **Task 6: Run wrapper + final verification** — (Or a tiny scripts/graph-web.mjs that sets WIKI DIR from process.argv[2] and runs vite — whichever is cleaner on Windows. The contract: pnpm graph-web sets WIKI DIR and starts the app with the browser open.) Run: npx tsc -p tsconfig.typecheck.json → 0 errors. Run: npx tsc -p apps/desktop/tsconfig.json --noEmit → 0 erro

## Related

- Source: `docs/superpowers/plans/2026-06-22-standalone-web-wiki-viewer.md`
