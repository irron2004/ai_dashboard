---
title: Harness Config Form Editor (diff/validate/apply) Implementation Plan
slug: docs-superpowers-plans-2026-06-08-harness-config-apply
sources: [docs/superpowers/plans/2026-06-08-harness-config-apply.md]
status: open
created: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Let the user edit an OpenCode agent config via a form, preview the diff, validate it, and apply it with a snapshot backup + atomic write (and roll back) — closing PRD acceptance criterion 8. Architecture: A pure-ish AgentConfigEditor ( @apc/harness ) serializes form edits back into the config text (markdown via gray-matter round-trip; jsonc via parse→re-stringify, comments reformatted), validates, diffs, and applies with sn

## Progress log

- Source checklist: 0 completed, 31 remaining.
- **File Structure**
- **Task 1: ProfileEdits + serializeProfileEdit**
- **Task 2: validateConfigText + diffText**
- **Task 3: applyConfigText + rollbackConfig + IO helpers ( previewEdit / applyEdit )** — And add these methods to the class (Also add import { beforeEach, afterEach } from 'vitest' to the test file's vitest import if not present.)
- **Task 4: IPC contract + handlers + api** — And add types (import ProfileEdits from @apc/shared at the top of the file — it already imports from @apc/shared ) Add ConfigEditReq, ConfigRollbackReq to the import type { ... } from '../shared/ipc-contract.js' list at the top of ipc.ts. Add ConfigEditReq, ConfigPreviewRes, ConfigApplyRes, ConfigRollbackReq, ConfigRol
- **Task 5: AgentConfigEditorPanel + Config tab** — (a) Import: import { AgentConfigEditorPanel } from './AgentConfigEditorPanel.js' (b) Extend Tab : add 'config' to the union. (c) Add a tab button after the others (d) Add content after the others ( profiles is already a prop of HarnessDashboard)
- **Task 6: Full verification** — Expected: all green, typecheck clean. 1. Form edit + Validate/Diff/Apply for OpenCode. ✔ (Task 5) 2. Apply snapshots then atomic-writes; no write if snapshot fails (copyFileSync throws → no write). ✔ (Task 3) 3. Diff shows current↔proposed unified diff. ✔ (Task 2/5) 4. Rollback restores latest snapshot. ✔ (Task 3) 5. V
- **Notes for the implementer**

## Related

- Source: `docs/superpowers/plans/2026-06-08-harness-config-apply.md`
