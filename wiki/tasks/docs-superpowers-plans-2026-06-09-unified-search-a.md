---
title: Unified Search A (service + modal UI) Implementation Plan
slug: docs-superpowers-plans-2026-06-09-unified-search-a
sources: [docs/superpowers/plans/2026-06-09-unified-search-a.md]
status: open
created: 2026-06-09
topic: [knowledge-and-search]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Add a normalized unified search over the session index ( @apc/search ) plus a search modal, closing the first half of PRD AC 6 (knowledge results are a slot filled by sub-project B). Architecture: A UnifiedSearch composition (in apps/desktop/src/main , alongside the container/searchIndex) queries the session FTS index and maps hits to a normalized UnifiedSearchResponse ( @apc/shared ). The existing q:search IPC returns it;

## Progress log

- Source checklist: 0 completed, 25 remaining.
- **File Structure**
- **Task 1: UnifiedSearch service + types** — And in packages/shared/src/index.ts add
- **Task 2: Wire search through container + ipc + api** — (a) Add the import near the other local imports (b) Add SearchReq and UnifiedSearchResponse to the imports. SearchReq comes from '../shared/ipc-contract.js' (add to that import list). UnifiedSearchResponse comes from @apc/shared — add it to the existing @apc/shared / ipc-contract type imports (it is re-exported by neit
- **Task 3: SearchModal component**
- **Task 4: Wire the modal into App (toolbar button + Ctrl+K)** — Add state near the other useState hooks (e.g. by const [generateModalOpen, setGenerateModalOpen] = useState(false) ) ( selectProject is already destructured from the store in App.tsx.)
- **Task 5: Full verification** — Expected: all green, typecheck clean. 1. Toolbar/Ctrl+K opens the modal; query → normalized session hits. ✔ (Task 3/4) 2. q:search returns UnifiedSearchResponse . ✔ (Task 1/2) 3. Clicking a hit switches project. ✔ (Task 3/4) 4. Empty/0-result/error states handled. ✔ (Task 3) 5. New + existing tests + typecheck pass; no
- **Notes for the implementer**

## Related

- Source: `docs/superpowers/plans/2026-06-09-unified-search-a.md`
