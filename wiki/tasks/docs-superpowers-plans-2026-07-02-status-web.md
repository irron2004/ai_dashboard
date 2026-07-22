---
title: "Implementation Plan — P4: 원격 읽기전용 웹 대시보드 (status web)"
slug: docs-superpowers-plans-2026-07-02-status-web
sources: [docs/superpowers/plans/2026-07-02-status-web.md]
status: open
created: 2026-07-02
topic: [project-management]
---

## Summary

Expose the cross-project workspace overview over HTTP so the user can check status from a phone / another PC — READ-ONLY , token-authenticated. Write actions (approve/run) are an explicit later phase and are out of scope . 1. A new leaf package packages/status-web ( @apc/status-web ) with a small node:http server (no express), a read-only sqlite open helper, a tiny TTL+stale overview cache, CLI config parsing, and an entry ( cli.ts ). 2. A single static src/public/index.html — vanilla-JS mobile status page (no build step, no React) that polls GET /api/overview every 10s. 3. A launcher scripts/status-web.mjs (mirrors scripts/graph-web.mjs styl

## Progress log

- Source checklist: 0 completed, 0 remaining.
- **Goal** — Expose the cross-project workspace overview over HTTP so the user can check status from a phone / another PC — READ-ONLY , token-authenticated. Write actions (approve/run) are an explicit later phase and are out of scope . Deliverables 1. A new leaf package packages/status-web ( @apc/status-web ) with a small node:http
- **FIXED SEAM (given by P3 — do NOT implement, only consume)** — P3 lands first and adds to packages/dashboard-api ( @apc/dashboard-api )
- **Architecture (data flow this plan adds)**
- **Tech stack / verified facts (all probed in this repo, Node v22.22.3)**
- **Global constraints (read before every task)** — Use scope status-web (new scope for this package); docs for the docs task.
- **Task 1 — Scaffold @apc/status-web + workspace plumbing + openReadOnlyDb**
- **Files**
- **Steps** — 1. Create the package manifest — packages/status-web/package.json (mirrors packages/dashboard-api/package.json ; no per-package tsconfig, like dashboard-api) 2. Link the new workspace package Expected: pnpm reports @apc/status-web added; node modules/@apc/status-web symlink now exists. 3. Failing test — packages/status

## Related

- Source: `docs/superpowers/plans/2026-07-02-status-web.md`
