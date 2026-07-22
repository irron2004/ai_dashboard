---
title: Handoff — Windows packaging + SSH/remote wiki generation (COMPLETE)
slug: docs-handoffs-2026-06-15-win-packaging-and-ssh-remote-wiki
sources: [docs/handoffs/2026-06-15-win-packaging-and-ssh-remote-wiki.md]
topic: [remote-and-packaging]
---

## Summary

Branches (both pushed to origin ) Status: ✅ Both shipped & verified. Package-level typecheck clean; desktop typecheck clean (via source-path config); affected test suites green; every SSH path verified against the live host hskim@10.10.100.45 . ⚠️ Native-ABI note: the packaged .exe is built in a separate clone at C:\Users\irron\Downloads\ai dashboard-pkg so its node modules native modules stay built for the Electron 31 ABI (125) . Do not run pnpm install there (it would rebuild better-sqlite3/node-pty for Node's ABI and break packaging). See "Building the .exe" below. Turns @apc/desktop (electron-vite + pnpm monorepo) into a real Windows app.

## Content map

- **Part 1 — Windows packaging ( feat/win-packaging )** — Turns @apc/desktop (electron-vite + pnpm monorepo) into a real Windows app.
- **Part 2 — SSH/remote wiki generation ( feat/wiki-policy-advisor )** — The wiki harness kept failing on SSH/remote projects. Root issue: EvidenceVerifier requires every evidence to resolve to a local file under /raw/ , but for a remote project the agents (running on the remote via claude -p ) cite remote/out-of-scope paths and nothing was materialized locally. Fixed in 8 commits
- **Key design rule (saved to memory)**
- **Verified against the live host ( hskim@10.10.100.45 , project /home/hskim/work/llm-agent-v2/docs/papers )**
- **Building the .exe** — The shippable exe combines BOTH branches. Built in the clone C:\Users\irron\Downloads\ai dashboard-pkg on a local integration branch feat/win-packaging-wiki (cherry-picks of the two source branches — not pushed , it's redundant and re-derivable)
- **integration branch = wiki branch + packaging commit, cherry-picked** — git fetch wd feat/wiki-policy-advisor wd = remote pointing at the working dir git checkout -b feat/win-packaging-wiki wd/feat/wiki-policy-advisor git cherry-pick d997464 from feat/win-packaging (config files only → clean)
- **build (no pnpm install — keep Electron-ABI natives)** — pnpm --filter @apc/desktop build node node modules/electron-builder/cli.js --win --projectDir apps/desktop
- **Known constraints / next steps**

## Related

- Source: `docs/handoffs/2026-06-15-win-packaging-and-ssh-remote-wiki.md`
