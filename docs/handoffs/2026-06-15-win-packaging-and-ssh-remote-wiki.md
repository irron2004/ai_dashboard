# Handoff — Windows packaging + SSH/remote wiki generation (COMPLETE)

**Date:** 2026-06-15
**Branches (both pushed to `origin`):**
- `feat/win-packaging` — Windows installer packaging (off `main`, 1 commit `d997464`)
- `feat/wiki-policy-advisor` — SSH/remote wiki-generation fixes (8 new commits `9634406..b4b5596`)

**Status:** ✅ Both shipped & verified. Package-level typecheck clean; desktop typecheck clean (via source-path config); affected test suites green; every SSH path verified against the live host `hskim@10.10.100.45`.

> ⚠️ Native-ABI note: the packaged `.exe` is built in a **separate clone** at `C:\Users\irron\Downloads\ai_dashboard-pkg` so its `node_modules` native modules stay built for the **Electron 31 ABI (125)**. Do **not** run `pnpm install` there (it would rebuild better-sqlite3/node-pty for Node's ABI and break packaging). See "Building the .exe" below.

---

## Part 1 — Windows packaging (`feat/win-packaging`)

Turns `@apc/desktop` (electron-vite + pnpm monorepo) into a real Windows app.

**What shipped** (`apps/desktop/electron-builder.yml` + `package.json` changes):
- electron-builder (nsis installer **+** portable), `directories.output=dist`, `asarUnpack` for native `.node`, `npmRebuild:false` (we electron-rebuild manually).
- `electronVersion: 31.7.7` pinned (electron is hoisted to the workspace-root `node_modules`, so it can't be auto-detected).
- Bundled JS deps (`@apc/*`, react, zustand, xterm) moved to **devDependencies** so electron-builder doesn't try to package workspace symlinks (their realpath is outside the app dir and breaks asar packing). Native modules stay in `optionalDependencies`.
- `bindings` + `file-uri-to-path` added explicitly — electron-builder's pnpm collector doesn't recurse into better-sqlite3's transitive runtime deps, so without these the packaged better-sqlite3 fails with `Cannot find module 'bindings'`.
- `.npmrc` / `pnpm-workspace.yaml`: `blockExoticSubdeps:false` so pnpm 11 allows `@electron/rebuild`'s git-resolved `@electron/node-gyp` subdep.

**Verified:** packaged app launches; better-sqlite3 creates a fresh DB with 17 tables incl. FTS5; node-pty spawns a shell. Native modules rebuilt for Electron 31 ABI (125). Output: `Agent Project Console Setup 0.0.0.exe` (NSIS) + `Agent Project Console 0.0.0.exe` (portable), ~92 MB each.

---

## Part 2 — SSH/remote wiki generation (`feat/wiki-policy-advisor`)

The wiki harness kept failing on SSH/remote projects. Root issue: **EvidenceVerifier requires every evidence to resolve to a local file under `<vault>/raw/`, but for a remote project the agents (running on the remote via `claude -p`) cite remote/out-of-scope paths and nothing was materialized locally.** Fixed in 8 commits:

| Commit | What |
|---|---|
| `9634406` | **Idempotent re-runs.** New `wiki_processed_sources` table + `ProcessedSourceStore` (`@apc/knowledge`). A `SourceLedger` port lets `makeDrivers` skip sources already processed (by content hash) and re-process only changed ones; marked at `HUMAN_REVIEW_REQUIRED`. (Answers the original "처리한 문서 추적 table" question.) |
| `1e2959b` | **Materialize remote project docs.** `materializeProjectDocs` is async + takes a `RemoteDocFetcher`; for `ssh://` it fetches docs into `raw/project-docs/<i>/`. Desktop `remote-docs.ts` does it in one ssh round-trip (`find \| base64`, framed by collision-free markers, run via `bash -s` over stdin). |
| `2678543` | **Normalize evidence → raw/.** `normalizeEvidencePaths` rewrites each cited path to its materialized `raw/` copy (longest-tail match). Plus the `bash -s`/stdin hardening (Windows `ssh.exe` mangles complex command args; stdin avoids it) + materialize manifest logged to the live engine log. |
| `e25044c` | **Out-of-repo context.** The agent also cites the **ancestor** `CLAUDE.md`/`AGENTS.md` and the **Claude project memory** (`~/.claude/projects/<cwd>/memory/`). These live outside the repo path → fetched into `raw/context/<abs>` (absolute path preserved) and normalized too. |
| `b9ed43d` | **Honest errors.** `SshAgentRunner` strips the benign `bash -lic` "no job control" noise; `LlmAgent.extractCliError` surfaces the engine's own stdout error (e.g. claude `{is_error, api_error_status:429, result}` → "You've hit your session limit … (HTTP 429)"). |
| `6a2946d` | **Remote conversations: claude** + shared plumbing. For ssh projects, conversations are pulled from the **remote** (never the local machine). `sessionMatchesProject` is ssh-aware (matches the URL pathname); `parseRemoteFileBlocks` is binary-safe. `remote-conversations.ts::fetchRemoteConversations` ssh-copies `~/.claude/projects/<enc>/*.jsonl` into a temp dir and returns a `ClaudeAdapter` pointed there. |
| `444ad70` | **Remote conversations: codex.** Lists recent `~/.codex/sessions` rollouts that reference the project path (matcher filters precisely by `session_meta.cwd`). |
| `b4b5596` | **Remote conversations: opencode.** The db is multi-GB (6.1 GB on the host) + no remote `sqlite3` CLI, so a remote **python3** script exports only this project's recent sessions (filtered by `session.directory`) into a small `opencode.db`, which we fetch. `OpenCodeAdapter` now prefers `session.directory` over `project.worktree` (worktree was a git-internal path `.git/modules/docs` that never matched). |

### Key design rule (saved to memory)
**For `ssh://` projects, never read the local machine's filesystem.** All sources/docs/memory/conversations come from the remote workspace. Local ingest adapters (`packages/agents/*-adapter.ts`, which default to local `homedir()`) are used **only** for local projects.

### Verified against the live host (`hskim@10.10.100.45`, project `/home/hskim/work/llm-agent-v2/docs/papers`)
- Docs + ancestor `CLAUDE.md`/`AGENTS.md` + remote memory fetch: 210 files (incl. the exact files a failed run had cited).
- Claude conversations: 12 transcripts, `cwd` matches the project.
- Codex: 12 rollouts, `session_meta.cwd` matches.
- OpenCode: remote python filtered export = 10 sessions / 277 messages / 1397 parts; small db (7.8 MB) fetches & opens cleanly; `directory` matches the project.

---

## Building the .exe

The shippable exe combines BOTH branches. Built in the clone `C:\Users\irron\Downloads\ai_dashboard-pkg` on a local integration branch `feat/win-packaging-wiki` (cherry-picks of the two source branches — **not pushed**, it's redundant and re-derivable):

```
cd C:\Users\irron\Downloads\ai_dashboard-pkg
# integration branch = wiki branch + packaging commit, cherry-picked:
git fetch wd feat/wiki-policy-advisor   # wd = remote pointing at the working dir
git checkout -b feat/win-packaging-wiki wd/feat/wiki-policy-advisor
git cherry-pick <packaging-commit>      # d997464 from feat/win-packaging (config files only → clean)
# build (no pnpm install — keep Electron-ABI natives):
pnpm --filter @apc/desktop build
node node_modules/electron-builder/cli.js --win --projectDir apps/desktop
```
Output: `apps/desktop/dist/win-unpacked/Agent Project Console.exe` (+ Setup/portable). Native rebuild when needed:
`node node_modules/@electron/rebuild/lib/cli.js -f -v 31.7.7 --build-from-source --only <mod>`.

**To run:** launch `…\dist\win-unpacked\Agent Project Console.exe` directly (not a Start-Menu install of an older build). Unsigned → SmartScreen "추가 정보 → 실행".

---

## Known constraints / next steps

- **Claude usage limit (429).** Remote `claude` hit "session limit · resets 9am UTC". This is an account limit, not a bug — wait for reset (≈18:00 KST) or use codex/opencode. The new build now surfaces this message clearly.
- **Mode matters.** "전체 문서" = materialize ON (pulls docs + conversations). "최근 세션" = materialize OFF (pulls nothing) — for SSH it produces no local sources, so use **전체 문서**.
- **opencode export needs `python3`** on the remote (no `sqlite3` CLI required). Schema assumed: `session.directory`, `project.worktree`, `message`, `part`. Older opencode dbs lacking `session.directory` would degrade to 0 opencode sessions (caught, non-fatal).
- **Caps:** docs ≤200 files <1 MB each; claude ≤12 transcripts; codex ≤12 rollouts; opencode ≤10 sessions. Adjustable in `remote-docs.ts` / `remote-conversations.ts`.
- **Integration branch** `feat/win-packaging-wiki` is local-only; if a CI/repro build is wanted, either push it or merge the packaging config into `feat/wiki-policy-advisor`.
- No PRs opened yet.

## Files of interest
- `apps/desktop/electron-builder.yml`, `apps/desktop/package.json`, `.npmrc`, `pnpm-workspace.yaml` (packaging)
- `apps/desktop/src/main/remote-docs.ts`, `remote-conversations.ts`, `ssh-agent-runner.ts`, `container.ts`
- `packages/app-services/src/{source-materializer,conversation-materializer,harness-service}.ts`
- `packages/knowledge/src/{migrate,processed-source-store}.ts`
- `packages/knowledge-harness/src/runtime/{make-drivers,source-reader,source-ledger,evidence-normalize}.ts`
- `packages/knowledge-harness/src/agents/llm-agent.ts`, `packages/agents/src/opencode-adapter.ts`
