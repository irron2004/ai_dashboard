# Handoff — Current Diagnosis Remediation

- **Date**: 2026-06-03
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **Scope**: Follow-up implementation for the team-mode diagnosis of the current working tree. This handoff covers the remediation pass requested after the diagnosis report, not a commit.

## Summary

All diagnosed issues from the latest team-mode pass were addressed in the working tree:

1. Renderer layout and modal regressions.
2. Graph visualization accessibility/performance concerns.
3. OpenCode multi-root cursor collisions and missing source ordering timestamps.
4. GenerateService unbounded parsing regression while preserving matches beyond the old 25-source window.
5. Remote Claude transcript discovery missing nested session files.
6. Test coverage gaps around source discovery, ingest locking, generate selection, and graph-integrity advisory behavior.

## Changes made

### Desktop renderer

- `apps/desktop/src/renderer/App.tsx`
  - Replaced inline `gridTemplateColumns` override with a CSS custom property (`--sidebar-width`).
  - Kept draggable sidebar width behavior while allowing CSS media queries and grid areas to work.
  - Cleaned up React type imports for `CSSProperties` and mouse events.

- `apps/desktop/src/renderer/app.css`
  - `app-layout` now uses `var(--sidebar-width, 240px)` and a two-column grid matching the declared grid areas.

- `apps/desktop/src/renderer/components/ProjectSidebar.tsx`
  - Context menu is closed before opening the edit dialog, preventing the fixed menu overlay from blocking the modal.
  - Malformed `ssh://` project paths now fall back to local mode with the raw path editable.

- `apps/desktop/src/renderer/components/GraphVisualization.tsx`
  - Added SVG/canvas ARIA label.
  - Graph nodes are now keyboard-focusable buttons with Enter/Space activation.
  - Added focus/blur hover parity.
  - Reduced force-layout iterations from 140 to 80.
  - Added a bounded layout cache keyed by filtered graph signature.

### Agent discovery and services

- `packages/agents/src/opencode-adapter.ts`
  - OpenCode source IDs now include the database path: `opencode:<dbPath>#session:<sessionId>`.
  - This prevents cursor collisions when multiple discovered `opencode.db` files contain the same session id.
  - Discovered OpenCode sources now emit `mtimeMs` from `time_updated`/`time_created` using seconds-vs-ms normalization.

- `packages/app-services/src/generate-service.ts`
  - Added `GENERATE_SOURCE_SCAN_LIMIT = 100`.
  - GenerateService scans most-recent sources up to that bound, avoiding full-history parsing while still finding matches beyond the previous 25-source cap.

- `apps/desktop/src/main/remote-generate.ts`
  - Remote Claude transcript discovery now uses recursive `find` under the encoded Claude project directory.
  - This mirrors local recursive source discovery and finds nested `.jsonl` session files.

### Test coverage

- `packages/agents/src/opencode-adapter.test.ts`
  - Added assertions for db-path source IDs and `mtimeMs`.
  - Added multi-root same-session-id collision regression coverage.

- `packages/agents/src/source-discovery.test.ts`
  - New direct helper tests for root normalization, recursive walking/dedupe, and `folderPathFor`.

- `packages/app-services/src/generate-service.test.ts`
  - Added coverage for a matching repo session beyond the old 25-source window.
  - Added coverage that GenerateService does not parse past `GENERATE_SOURCE_SCAN_LIMIT`.

- `packages/app-services/src/ingest-service.test.ts`
  - Added concurrent `ingestAll` serialization test.
  - Added lock-release-after-parse-failure test.

- `apps/desktop/src/main/remote-generate.test.ts`
  - Strengthened remote transcript discovery assertion to require recursive `find`.

- `packages/knowledge-harness/src/verify/graph-integrity.test.ts`
  - Strengthened advisory/self-link cases to assert hard-fail fields remain empty and `ok` remains true.

## Validation

All validation commands passed:

```bash
pnpm typecheck
```

```bash
npx vitest run packages/agents/src/opencode-adapter.test.ts packages/agents/src/source-discovery.test.ts packages/app-services/src/generate-service.test.ts packages/app-services/src/ingest-service.test.ts packages/knowledge-harness/src/verify/graph-integrity.test.ts
# 5 files passed, 26 tests passed
```

```bash
cd apps/desktop && npx vitest run src/main/remote-generate.test.ts src/renderer/harness-store.test.tsx
# 2 files passed, 16 tests passed
```

```bash
npx vitest run packages/llm-wiki/src/cli-agent-runner.test.ts
# 1 file passed, 5 tests passed
```

```bash
pnpm test
# 75 files passed, 288 tests passed, 1 skipped
```

```bash
cd apps/desktop && npx vitest run
# 8 files passed, 38 tests passed
```

## Notes and risks

- OpenCode source id format changed. Existing cursor rows keyed as `opencode:<sessionId>` will not match the new db-scoped ids, so affected OpenCode sessions may re-ingest once. This is intentional to eliminate cross-db cursor collisions.
- `GENERATE_SOURCE_SCAN_LIMIT` is now 100. This balances the old false-negative at 25 with avoiding full-history parsing. If projects have extremely old relevant sessions beyond 100, generation will still return no local session.
- Remote recursive discovery uses GNU-style `find -printf`, matching the expected Linux SSH target environment. Non-GNU remote shells may need an alternate command later.
- The working tree still contains broad pre-existing uncommitted/untracked work from the ongoing harness/renderer stream; this handoff only documents this remediation pass.

## Recommended next steps

1. Review `git diff` to separate this remediation pass from earlier in-flight work if committing.
2. If preserving old OpenCode cursor continuity is important, add a one-time cursor migration or fallback lookup for `opencode:<sessionId>`.
3. Consider product-level tuning for `GENERATE_SOURCE_SCAN_LIMIT` if real user histories exceed 100 recent sources per generation attempt.
