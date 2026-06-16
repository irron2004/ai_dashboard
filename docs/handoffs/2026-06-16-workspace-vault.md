# Handoff — Workspace vault (wiki lives in the project's workspace)

**Date:** 2026-06-16
**Branch:** `feat/workspace-vault` (off `feat/wiki-policy-advisor`, not yet pushed/PR'd)
**Status:** ✅ Implemented, typecheck clean, full suites green (root 447 passed / desktop 185 passed,
0 failed), and `pnpm --filter @apc/desktop build` succeeds (main + preload + renderer). ❗ Not yet
verified against the live ssh host (blocked by the account 429 limit + no remote run this session).

## Why

The wiki vault lived in the desktop app's `userData/vault`, tying a project's knowledge to one machine.
The goal (user-confirmed): the wiki is generated **in the workspace you connect to** and exported to
`{repo}/wiki`, so it is portable across machines.

## What shipped

| Commit | What |
|---|---|
| `6b11fcc` | **Workspace vault model.** `WorkspaceVault` port + `LocalWorkspaceVault` (`packages/app-services/src/workspace-vault.ts`); `SshWorkspaceVault` + `pullDir`/`pushDir` (base64 over `bash -s`) in `apps/desktop/src/main/remote-vault.ts`. `HarnessService.workspaceVaultFor` resolves per project; run does pull → generate/verify locally → pushInternal. New `exportWiki()` + IPC `harnessExportWiki` + a "📤 워크스페이스로 export" button. |
| `d49a2f0` | **Cross-platform tests.** Fixed two Windows-only failures (vault-fs separator, cli-agent-runner shell-quote) — test-only, production unchanged. |
| `acd5a84` | **Fix: ssh force-materialize.** ssh projects re-pull a wiped vault and never sync `raw/`, so `materialize:false` left `raw/` empty → the extractor fabricated remote absolute paths → EvidenceVerifier `path_escape` (the originally-reported failure). ssh now always materializes; local keeps both modes. |
| `014d8d3` | **Fix: export from vault root.** The harness writes nodes at the vault root (`concepts/x.md`), not `projects/<id>/`; `exportWiki` was reading the wrong dir and always published 0 files. Now publishes the whole vault minus `raw/` (and drafts/agent-runs). |
| `cc6be8c` | **Fix: persist promote.** promote writes the local working vault; an ssh project's next pull wipes it, so an approved-but-unexported draft was lost. `syncWorkspaceForRun` now pushes after a successful promote (container boundary; promote stays sync). |
| `1b76499` | **Fix: no self-ingestion.** `.apc-wiki`/`wiki` now live in the repo, so doc materialization (local walk + remote `find`) re-ingested our own raw sources, proposals and output → corpus pollution + generate-from-own-output loop. Both are excluded now. |
| `be662c6` | **Fix: prompt size budget.** "전체 문서" on a real project fed every source into the reader/extractor prompt (2 MB) → codex rejected it (>1,048,576 chars). `budgetSourcesForPrompt` caps the embedded sources (800K); dropped sources show as uncovered. Follow-up: chunk for full coverage. |
| `79b7766` | **Feat: pipeline transcript.** Each run's agent-to-agent conversation is saved as JSONL (one step per line: prompt+output+meta) to the run dir AND `.apc-wiki/runs/<runId>.jsonl` (for study/training). Saved for FAILED runs too via the new additive `WorkspaceVault.pushRuns()`. |

## Layout (in the workspace; `<repo>` = `repoPaths[0]`)

- `<repo>/.apc-wiki/` — internal state (raw/, wiki nodes, proposals, policy). Self-ignoring
  `.gitignore` (`*`) keeps it out of the user's git.
- `<repo>/wiki/` — published readable wiki, written only on manual export.

## How it works

- **Local projects:** `localRoot = <repo>/.apc-wiki` directly; pull/push are no-ops; `raw/` persists
  across runs, so "최근 세션" (materialize off) is legitimate.
- **ssh:// projects:** canonical state is remote; runs use a local working copy under
  `userData/../apc-workspace-cache/<projectId>` (EvidenceVerifier needs local files). Lifecycle =
  pull `.apc-wiki` (minus raw/) → re-materialize raw/ → run/verify → pushInternal. Export pushes the
  readable docs to remote `<repo>/wiki/`. **ssh always force-materializes** (see `acd5a84`).

## Known gaps / next steps

- **Live verification pending.** The ssh pull/push scripts are unit-tested with an injected exec, but
  not run against `hskim@10.10.100.45`. Verify there once the engine limit resets.
- **Run transcripts now reach `.apc-wiki/runs/`** (was a gap). Each run's agent-pipeline JSONL travels
  to the workspace. The full per-step run artifacts still live in the separate `apc-harness-runs` root;
  only the consolidated transcript syncs. Sources/raw still don't sync (re-materialized each run).
- **Policy on ssh is single-machine.** Policy methods write to the local working vault and only reach
  the workspace via the next run's pushInternal; proposing/approving policy on one machine without a
  run won't sync to another. Fine for the common flow; revisit if multi-machine policy editing matters.
- **No PR yet.** Branch is local. Push + open a PR when ready.

## Files of interest

- `packages/app-services/src/workspace-vault.ts`, `harness-service.ts`
- `apps/desktop/src/main/remote-vault.ts`, `container.ts`, `ipc.ts`, `remote-docs.ts` (exported markers)
- `apps/desktop/src/shared/ipc-contract.ts`, `renderer/{api,store}.ts`, `renderer/components/WikiGenDashboard.tsx`
