---
title: Implementation Handoff — UI 3-Tab Restructure (COMPLETE)
slug: docs-handoffs-2026-06-12-ui-three-tab-restructure-impl
sources: [docs/handoffs/2026-06-12-ui-three-tab-restructure-impl.md]
topic: [desktop-experience]
---

## Summary

Branch: feat/ui-three-tab-restructure Status: ✅ All 19 tasks complete. 36 commits, 43 files (+2808 / −1660). 155 tests pass (27 files), typecheck clean. Spec: docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md Plan: docs/superpowers/plans/2026-06-12-ui-three-tab-restructure.md (source of truth, 19 tasks) Mid-progress handoff (superseded by this doc): docs/superpowers/handoffs/2026-06-12-ui-three-tab-restructure-handoff.md The cluttered single "Knowledge Harness" screen (Runs / MarkdownViewer / Agent Configuration stacked) is replaced by a 3-tab IA Plus shell changes: collapsible agent terminal dock (status dots, Shift+N auto

## Content map

- **What shipped** — The cluttered single "Knowledge Harness" screen (Runs / MarkdownViewer / Agent Configuration stacked) is replaced by a 3-tab IA Plus shell changes: collapsible agent terminal dock (status dots, Shift+N auto-expand), global ⋯ overflow menu (Update moved in), toolbar trimmed to 🔎 + ⋯ .
- **Live verification (Electron via CDP, 2026-06-12)** — Launched pnpm --filter @apc/desktop dev -- --remote-debugging-port=9222 (native modules already Electron-ABI-125; no rebuild needed). Drove the renderer over CDP ( Page.captureScreenshot + Runtime.evaluate ). App booted clean — only benign dbus/GPU warnings (no dbus socket, GPU→swiftshader; expected under WSLg). No cra
- **Static verification** — New/changed test coverage of note: KnowledgeView (4), HomeView (4), WikiGenDashboard (5), HarnessStructurePanel (7), HarnessRunList (6), project-files / project-changes / ipc (real-git + real-handler integration), harness-utils helpers (13), MarkdownContent , GeneratePreflightModal . Every task went through the team-mo
- **Known limitations / deferred follow-ups** — 1. Changes-feed "ingest cutoff" is global, not per-project. changes:list uses SELECT MAX(updated at) FROM ingest cursors (documented in ipc.ts ). ingest cursors.source id is an opaque adapter string with no clean FK to a project, and ingestion runs globally — so per-project scoping needs a schema/semantic change. In mu
- **Next steps** — 1. Final whole-branch code review (optional — each task already reviewed). 2. superpowers:finishing-a-development-branch to merge / PR. 3. When ready, brainstorm the wiki-policy advisor ( 4 above).

## Related

- Source: `docs/handoffs/2026-06-12-ui-three-tab-restructure-impl.md`
