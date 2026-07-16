---
title: Handoff — UI 3-Tab Restructure (Home / Knowledge / Wiki Gen)
slug: docs-superpowers-handoffs-2026-06-12-ui-three-tab-restructure-handoff
sources: [docs/superpowers/handoffs/2026-06-12-ui-three-tab-restructure-handoff.md]
topic: [desktop-experience]
---

## Summary

Branch: feat/ui-three-tab-restructure Branch point: 33f7dc4 (off main ) As of commit: 8ee0fd0 (Task 12 review fix) Replaces the cluttered single "Knowledge Harness" screen (three stacked bars: Runs / MarkdownViewer / Agent Configuration) with a 3-tab IA Driving spec: docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md Source-of-truth plan (19 tasks, exact code per task): docs/superpowers/plans/2026-06-12-ui-three-tab-restructure.md Workflow contract from the user (verbatim) "1번으로 개바를 진행해. 각 task가 종료 될때마다 team mode로 검증하고 개선하고 commit해." → Subagent-driven development. Every task = TDD implement → spec review → quality review → f

## Content map

- **1. What this branch does** — Replaces the cluttered single "Knowledge Harness" screen (three stacked bars: Runs / MarkdownViewer / Agent Configuration) with a 3-tab IA Driving spec: docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md Source-of-truth plan (19 tasks, exact code per task): docs/superpowers/plans/2026-06-12-ui-three-t
- **2. Progress: 12 of 19 tasks done**
- **Done — Phase 1 (shell), Phase 2 (Wiki Gen), Phase 3 (Knowledge plumbing)** — Each task has a feat / refactor commit and a fix(... review ...) commit (the team-mode pass).
- **Remaining — Phase 3 finish, Phase 4 (Home), Phase 5 (cleanup + verify)** — After Task 19: dispatch one final whole-branch code reviewer, then superpowers:finishing-a-development-branch .
- **3. Verification state at this handoff** — Run from repo root with the Node-22 PATH prefix (see §5) component scheduled for deletion in Task 18. Not a failure, do not chase it. Branch diff vs main : 27 files, +1592 / −310.
- **4. Architecture & patterns established (follow these for Tasks 13–19)** — 1. Channel constant in apps/desktop/src/shared/ipc-contract.ts ( q:fsReadDoc style) + req/res types. 2. Handler in apps/desktop/src/main/ipc.ts — parse args with zod .strict().parse() . 3. Core logic in a dedicated apps/desktop/src/main/ .ts module ( project-files.ts , next: project-changes.ts ) — keep IO/security here
- **5. How to resume (env — WSL on Windows filesystem)** — The dev toolchain is not on the default non-interactive PATH. Always prefix (better-sqlite3, node-pty); reinstalling on WSL rebuilds them for linux and breaks the Windows Electron build. The linux test binaries (rollup, esbuild) are already present.
- **6. Gotcha: stale TypeScript diagnostics (recurring)** — After creating/editing a file you will often see harness-reported diagnostics like "Cannot find module './X.js'", "Property does not exist", or "implicitly has any type". structural diagnostic, verify directly: pnpm run typecheck (it has been EXIT 0 every time) and grep for the symbol. Do not rewrite working code to ch

## Related

- Source: `docs/superpowers/handoffs/2026-06-12-ui-three-tab-restructure-handoff.md`
