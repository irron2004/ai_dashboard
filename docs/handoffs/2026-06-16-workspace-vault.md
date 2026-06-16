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

---

## Follow-on work on this branch (same session, after the vault relocation)

The branch grew well past the vault relocation. Full picture for whoever picks it up (root tests now
~483 green / desktop ~191 / build clean; still **no live remote run**):

### A. Prompt-size + engine fixes
- **Prompt source budget** — `budgetSourcesForPrompt` (`source-reader.ts`) caps the serialized sources
  in the reader/extractor prompt. Default `DEFAULT_MAX_PROMPT_SOURCE_CHARS=200K` (codex hit both the hard
  1,048,576-char limit AND the model token window). Configurable via `DriverDeps.maxPromptChars`.
- **Per-harness engine settings** — `EngineOptions` (`@apc/shared`) → `buildEngineArgs` (`@apc/llm-wiki`)
  maps model / reasoning effort / sandbox / approval / permission-mode to each CLI's flags; threaded
  config→IPC(`HarnessRunReq.engineOptions`)→runners. UI in `HarnessStructurePanel` engine section.

### B. Pipeline transcript (study/training)
- Each run's agent-to-agent conversation saved as JSONL (`pipeline-transcript.ts`) to the run dir AND
  `.apc-wiki/runs/<runId>.jsonl` (FAILED runs too, via additive `WorkspaceVault.pushRuns`).

### C. Folder orchestrator-workers (the big one) — replaces single-shot
See **`docs/superpowers/specs/2026-06-16-folder-orchestrator-wiki-design.md`** (status: implemented 1–5).
Fixes the model-window overflow by partitioning docs into folder work units, fanning out the extractor
per folder, and reducing in the lead. Key files: `folder-plan.ts` (`planFolders` bin-packing),
`make-drivers.ts` (`NODE_PROPOSALS_CREATED` fan-out + `runPool` concurrency + provenance),
`merge-proposals.ts` (`dedupeProposalIds`). Reader scoped to `raw/conversations/*`; `raw/context/*`
shared to every worker; `workerConcurrency` user-settable (default 1). Empty/single plan → single-shot
fallback (legacy-equivalent). See memory `folder-orchestrator.md`.

### Still pending (needs the user)
- **🔴 Live remote run** on `hskim@10.10.100.45` — lower reasoning effort + "전체 문서". Only FakeLLM
  integration is verified so far.
- cross-folder reduce: auto (lead, current) vs an added human gate — undecided.
