---
title: Agent Project Console — Electron Shell + UI + Integration Implementation Plan (Plan 6 of 6)
slug: docs-superpowers-plans-2026-06-01-agent-project-console-electron-ui
sources: [docs/superpowers/plans/2026-06-01-agent-project-console-electron-ui.md]
status: open
created: 2026-06-01
topic: [desktop-experience]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox ( - [ ] ) syntax. Goal: Compose the engine packages (Plans 1–5) into the running product: integration services that drive the PM loop end-to-end, an Electron shell with a typed IPC surface, the PM Control Tower React UI (project sidebar, PM Home, Harness panel, model picker, review actions), and the Agent Work Execution Panel (terminal via node-pty / xterm.js ). Architecture: @apc/app-services holds the end-to-end orchestrations ( IngestService , RunService , CurrentPromotionService ) that wire

## Progress log

- Source checklist: 0 completed, 49 remaining.
- **File Structure** — Add @apc/app-services to the root vitest.config.ts alias map.
- **Part A — Integration services ( @apc/app-services ) — TDD here**
- **Task A1: scaffold + IngestService** — packages/app-services/package.json src/index.ts (Export incrementally as files are added.)
- **Task A2: RunService** — 1. WikiEngine.generate(session, { engine, currentCanonical }) → WikiGeneration . 2. VaultWriter.writeRunSummary(projectId, { runId, taskId, agent, summary, filesTouched, openProblems }) → summaryPath. 3. VaultWriter.writeCurrentProposal(projectId, generation.currentProposalMarkdown) → proposalPath (only if non-empty).
- **Task A3: CurrentPromotionService (proposal → canonical, conflict-gated)**
- **Part B — Electron app scaffold + typed IPC contract**
- **Task B1: apps/desktop scaffold (electron-vite + React)** — apps/desktop/package.json electron.vite.config.ts src/main/index.ts (minimal, wired further in Part D) src/preload/index.ts src/renderer/index.html src/renderer/main.tsx (Create a stub src/renderer/App.tsx exporting export function App() { return Agent Project Console } ; replaced in Part C.)
- **Task B2: Typed IPC contract + container + handlers** — src/shared/ipc-contract.ts handlers(container) returns Record Promise , e.g. [CH.projectDashboard]: async (p: ProjectDashboardReq) = getProjectDashboard(container, p.projectId) .

## Related

- Source: `docs/superpowers/plans/2026-06-01-agent-project-console-electron-ui.md`
