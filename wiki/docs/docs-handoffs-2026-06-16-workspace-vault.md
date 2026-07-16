---
title: "Handoff — Workspace vault (wiki lives in the project's workspace)"
slug: docs-handoffs-2026-06-16-workspace-vault
sources: [docs/handoffs/2026-06-16-workspace-vault.md]
topic: [project-management]
---

## Summary

Branch: feat/workspace-vault (off feat/wiki-policy-advisor , not yet pushed/PR'd) Status: ✅ Implemented, typecheck clean, full suites green (root 447 passed / desktop 185 passed, 0 failed), and pnpm --filter @apc/desktop build succeeds (main + preload + renderer). ❗ Not yet verified against the live ssh host (blocked by the account 429 limit + no remote run this session). The wiki vault lived in the desktop app's userData/vault , tying a project's knowledge to one machine. The goal (user-confirmed): the wiki is generated in the workspace you connect to and exported to {repo}/wiki , so it is portable across machines. .gitignore ( ) keeps it ou

## Content map

- **Why** — The wiki vault lived in the desktop app's userData/vault , tying a project's knowledge to one machine. The goal (user-confirmed): the wiki is generated in the workspace you connect to and exported to {repo}/wiki , so it is portable across machines.
- **What shipped**
- **Layout (in the workspace; = repoPaths[0] )** — .gitignore ( ) keeps it out of the user's git.
- **How it works** — across runs, so "최근 세션" (materialize off) is legitimate. userData/../apc-workspace-cache/ (EvidenceVerifier needs local files). Lifecycle = pull .apc-wiki (minus raw/) → re-materialize raw/ → run/verify → pushInternal. Export pushes the readable docs to remote /wiki/ . ssh always force-materializes (see acd5a84 ).
- **Known gaps / next steps** — not run against hskim@10.10.100.45 . Verify there once the engine limit resets. to the workspace. The full per-step run artifacts still live in the separate apc-harness-runs root; only the consolidated transcript syncs. Sources/raw still don't sync (re-materialized each run). the workspace via the next run's pushIntern
- **Files of interest**
- **Follow-on work on this branch (same session, after the vault relocation)** — The branch grew well past the vault relocation. Full picture for whoever picks it up (root tests now ~483 green / desktop ~191 / build clean; still no live remote run )
- **A. Prompt-size + engine fixes** — in the reader/extractor prompt. Default DEFAULT MAX PROMPT SOURCE CHARS=200K (codex hit both the hard 1,048,576-char limit AND the model token window). Configurable via DriverDeps.maxPromptChars . maps model / reasoning effort / sandbox / approval / permission-mode to each CLI's flags; threaded config→IPC( HarnessRunRe

## Related

- Source: `docs/handoffs/2026-06-16-workspace-vault.md`
