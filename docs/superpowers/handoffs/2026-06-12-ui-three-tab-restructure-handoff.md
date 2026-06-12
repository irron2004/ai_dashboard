# Handoff — UI 3-Tab Restructure (Home / Knowledge / Wiki Gen)

**Branch:** `feat/ui-three-tab-restructure`
**Branch point:** `33f7dc4` (off `main`)
**As of commit:** `8ee0fd0` (Task 12 review fix)
**Date:** 2026-06-12

---

## 1. What this branch does

Replaces the cluttered single "Knowledge Harness" screen (three stacked bars: Runs /
MarkdownViewer / Agent Configuration) with a **3-tab IA**:

| Tab | Role |
|-----|------|
| **Home** (`home`) | `current.md` viewer + git change feed + PM strip — "what's happening now" |
| **Knowledge** (`knowledge`) | docs + graph, **read-only** — grasp md content to direct agents |
| **Wiki Gen** (`wikigen`) | generation + review + promote — the harness pipeline |

Driving spec: `docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md`
Source-of-truth plan (19 tasks, exact code per task): `docs/superpowers/plans/2026-06-12-ui-three-tab-restructure.md`

Workflow contract from the user (verbatim):
> "1번으로 개바를 진행해. 각 task가 종료 될때마다 team mode로 검증하고 개선하고 commit해."

→ Subagent-driven development. Every task = TDD implement → **spec review** → **quality
review** → fix → commit. This rhythm is non-negotiable and has been honored for Tasks 1–12.

---

## 2. Progress: 12 of 19 tasks done

### Done — Phase 1 (shell), Phase 2 (Wiki Gen), Phase 3 (Knowledge plumbing)

Each task has a `feat`/`refactor` commit **and** a `fix(... review ...)` commit (the team-mode pass).

| Task | What | Commits |
|------|------|---------|
| **1** | MainPanel → 3 tabs + running badge | `8530b14`, `49aa45d` |
| **2** | Global `⋯` overflow menu (Update moved out of toolbar) | `57dfd4d`, `325c224` |
| **3** | Collapsible terminal dock with status dots | `a3478d7`, `d6e343b` |
| **4** | `harness-utils`: run mode / resumable / pipeline-stage helpers | `6026dc4`, `224c3fa` |
| **5** | `store`: record run input mode on bundles | `9df1e3c`, `b93e553` |
| **6** | `HarnessRunList` → "실행 이력" + `▶ 위키 생성 ▾` dropdown + contextual `↻ 이어하기` | `2fc8b8f`, `79dfb49` |
| **7** | `HarnessStructurePanel` — pipeline map doubles as agent settings | `e600799`, `cebc0b1` |
| **8** | `WikiGenDashboard` assembly + MainPanel wire | `cdceec2`, `874c96d` |
| **9** | main `project-files.ts` — root-contained doc read/list core | `0f405b0`, `218e66d` |
| **10** | `fs:readDoc` / `fs:listDocs` IPC wiring | `270d65d`, `2de0a78` |
| **11** | `MarkdownContent` extract (reusable md-string renderer) | `fdc62c6`, `f13fb3e`, `905c71d` |
| **12** | `pickNodeArtifact` extract (graph node → artifact resolver) | `5fd0093`, `8ee0fd0` |

### Remaining — Phase 3 finish, Phase 4 (Home), Phase 5 (cleanup + verify)

| Task | What | Plan line | Key files |
|------|------|-----------|-----------|
| **13** | **KnowledgeView** — `[문서\|그래프]` modes, node peek with **disk fallback**, MainPanel wire | 2013 | `KnowledgeView.tsx` (+test), `MainPanel.tsx` |
| **14** | main `project-changes.ts` — git change core (parsePorcelain / markUnreflected / listProjectChanges / diffProjectFile) | 2312 | `project-changes.ts` (+test) |
| **15** | `changes:list` / `changes:diff` IPC wiring | 2509 | `ipc.ts`, `ipc-contract.ts`, `api.ts` |
| **16** | `GeneratePreflightModal` extract from `App.tsx` | 2595 | `GeneratePreflightModal.tsx` (+test), `App.tsx` |
| **17** | **HomeView** — `current.md` viewer + changes feed + PM strip + App/MainPanel wire | 2717 | `HomeView.tsx` (+test), `MainPanel.tsx`, `App.tsx` |
| **18** | Remove `HarnessDashboard` / `AgentConfigPanel` / `AgentConfigEditorPanel` + dead CSS | 3024 | deletions |
| **19** | Live Electron CDP verify + final handoff | 3069 | — |

After Task 19: dispatch one final whole-branch code reviewer, then
`superpowers:finishing-a-development-branch`.

---

## 3. Verification state at this handoff

Run from repo root with the Node-22 PATH prefix (see §5):

```
pnpm --filter @apc/desktop exec vitest run     # → 137 passed (26 files)
pnpm run typecheck                              # → EXIT 0 (clean)
```

- **All 26 desktop test files green (137 tests).**
- **Typecheck clean** across `tsconfig.typecheck.json` + `apps/desktop/tsconfig.json`.
- One benign `act(...)` warning from `AgentConfigEditorPanel.test.tsx` — **pre-existing**
  component scheduled for deletion in Task 18. Not a failure, do not chase it.

Branch diff vs `main`: **27 files, +1592 / −310.**

---

## 4. Architecture & patterns established (follow these for Tasks 13–19)

**IPC (main ↔ renderer) — the spine for Tasks 13/14/15:**
1. Channel constant in `apps/desktop/src/shared/ipc-contract.ts` (`q:fsReadDoc` style) + req/res types.
2. Handler in `apps/desktop/src/main/ipc.ts` — parse args with **zod `.strict().parse()`**.
3. Core logic in a dedicated `apps/desktop/src/main/*.ts` module (`project-files.ts`,
   next: `project-changes.ts`) — keep IO/security here, not in the handler.
4. Renderer method in `apps/desktop/src/renderer/api.ts` (thin wrapper over preload `invoke`).
5. DI through `apps/desktop/src/main/container.ts` (e.g. `vaultRoot` is already exposed there).

**Path-containment security (reuse `containedPath` from `project-files.ts`):**
realpath both sides, then `real !== realRoot && !real.startsWith(realRoot + sep)` rejects.
Guards against `..` traversal, symlink escape, and the sibling-prefix bug (`/root-evil`).
`readDoc` roots = `[vault/projects/<id>, ...repoPaths, ...vaultPaths]`; `listDocs` =
repoPaths only (intentional, documented in `ipc.ts`).

**Renderer building blocks now available for Tasks 13/17:**
- `MarkdownContent({ markdown, onOpenWikiLink })` — renders any md string; empty-state
  guard is `markdown.trim() ?` (whitespace-only counts as empty).
- `pickNodeArtifact(arts, node)` — graph node → artifact, **viewable (.md/markdown) first**,
  strips `^(artifact|file|task|evidence|run|document):` prefix, empty idTarget is guarded.
- `api.fsReadDoc` / `api.fsListDocs` — `ReadDocResult` is a **discriminated union**
  (`{ok:true, content}` | `{ok:false, error}`); narrow on `.ok` before reading `.content`.
- KnowledgeView's "node peek": try the run artifact first, **fall back to `fsReadDoc`**
  for the node's `data.path` when no in-memory artifact matches (this is the Task 13 core).

**Run helpers (Task 4) for the Wiki Gen / run rails:**
`HarnessRunMode = 'full-docs' | 'recent-sessions'`, `isRunResumable` (fail-closed
**allowlist** — only known-safe states resume), `runModeLabel`, `STRUCTURE_STAGES`
(8 stages; the `policyGuard` gate stage carries **no** `promptKey`), `stageForState`.

**"Honest UI" policy** (carries into Home/Knowledge): never show a control as functional
when its backing gate isn't honored. `HarnessStructurePanel` only makes a gate editable
when honored; mirror that discipline for any new affordance.

---

## 5. How to resume (env — WSL on Windows filesystem)

The dev toolchain is **not** on the default non-interactive PATH. Always prefix:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd /mnt/c/Users/irron/Downloads/ai_dashboard-main/ai_dashboard-main
```

- **Node 22.22.3, not 20** — `@apc/core` imports the `node:sqlite` builtin (22.5+ only).
- **Do NOT `pnpm install`** — `node_modules` holds Windows-built native modules
  (better-sqlite3, node-pty); reinstalling on WSL rebuilds them for linux and breaks the
  Windows Electron build. The linux test binaries (rollup, esbuild) are already present.
- Tests: `pnpm --filter @apc/desktop exec vitest run <src-rel-path>`
- Typecheck (whole repo): `pnpm run typecheck`
- Edits **LF only** (`.gitattributes` enforces `eol=lf`).

---

## 6. Gotcha: stale TypeScript diagnostics (recurring)

After creating/editing a file you will often see harness-reported diagnostics like
"Cannot find module './X.js'", "Property does not exist", or "implicitly has any type".
**These are almost always stale** — the TS LSP hasn't re-indexed. Before acting on any
structural diagnostic, verify directly: `pnpm run typecheck` (it has been EXIT 0 every
time) and grep for the symbol. Do not rewrite working code to chase a phantom error.

---

## 7. Immediate next action

Task 13 (#22) — **KnowledgeView**. Plan section at line 2013 has the full failing test
and the exact component. It composes everything Phase 3 just built: `[문서|그래프]` toggle,
graph node click → `pickNodeArtifact` → fall back to `api.fsReadDoc(node.data.path)` →
render via `MarkdownContent`, plus `fsListDocs` for the project-doc tree. Then wire
`knowledge` in `MainPanel.tsx` (currently still falls through to `HarnessDashboard`).

Dispatch under the same team-mode rhythm: implementer (sonnet) → spec reviewer → quality
reviewer → fix subagent → commit `feat` + `fix(... Task 13 review ...)`. Then mark #22
done and continue to Task 14.
