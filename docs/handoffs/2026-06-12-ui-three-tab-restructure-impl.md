# Implementation Handoff — UI 3-Tab Restructure (COMPLETE)

**Branch:** `feat/ui-three-tab-restructure`
**Status:** ✅ All 19 tasks complete. 36 commits, 43 files (+2808 / −1660). 155 tests pass (27 files), typecheck clean.
**Date:** 2026-06-12
**Spec:** `docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md`
**Plan:** `docs/superpowers/plans/2026-06-12-ui-three-tab-restructure.md` (source of truth, 19 tasks)
**Mid-progress handoff (superseded by this doc):** `docs/superpowers/handoffs/2026-06-12-ui-three-tab-restructure-handoff.md`

---

## What shipped

The cluttered single "Knowledge Harness" screen (Runs / MarkdownViewer / Agent Configuration stacked) is replaced by a **3-tab IA**:

| Tab | Contents |
|-----|----------|
| **🏠 Home** | `current.md` viewer + "✨ 갱신 제안" (generate) + git **변경분 feed** (new/modified/code groups, 미반영 badge) + in-context **Ingest now** + PM strip (goal/progress/review-queue, expandable to PmHome) |
| **📖 Knowledge** | `[문서｜그래프]` toggle. Docs mode: tree of wiki artifacts + project docs (`fs:listDocs`), renders via `MarkdownContent`. Graph mode: `GraphVisualization`, node click → peek panel with **disk fallback** (`fs:readDoc`) when no artifact matches |
| **⚙ Wiki Gen** | 실행 이력 run rail + `▶ 위키 생성 ▾` 2-mode dropdown (전체 문서 / 최근 세션) + review subtabs (요약/Coverage/Quality/Proposals/Flow) + promote area + `⚙ 에이전트 설정` slide-over (HarnessStructurePanel: pipeline-map-as-settings) |

Plus shell changes: collapsible agent terminal dock (status dots, Shift+N auto-expand), global `⋯` overflow menu (Update moved in), toolbar trimmed to `🔎` + `⋯`.

---

## Live verification (Electron via CDP, 2026-06-12)

Launched `pnpm --filter @apc/desktop dev -- --remote-debugging-port=9222` (native modules already Electron-ABI-125; no rebuild needed). Drove the renderer over CDP (`Page.captureScreenshot` + `Runtime.evaluate`). App booted clean — only benign dbus/GPU warnings (no dbus socket, GPU→swiftshader; expected under WSLg).

| Checklist item | Result |
|----------------|--------|
| 3 top tabs render + switch | ✅ Home / Knowledge / Wiki Gen |
| Tab restore via localStorage | ✅ click→`apc:mainTab` persists (`knowledge`/`wikigen`/`home` all verified) |
| Home: current.md + 갱신 제안 + 변경분 feed + Ingest now | ✅ all present |
| Knowledge: doc tree (wiki + project docs) renders | ✅ `fs:listDocs` populated the real repo's `docs/superpowers/...`; clicking "Final Report" rendered markdown |
| Knowledge: `[문서｜그래프]` toggle | ✅ both seg buttons present |
| Wiki Gen: 실행 이력 rail + run cards | ✅ |
| Wiki Gen: `▶ 위키 생성 ▾` 2 modes | ✅ "전체 문서" + "최근 세션" |
| Wiki Gen: review subtabs | ✅ 요약 / Coverage / Quality / Proposals / Flow |
| Wiki Gen: ⚙ 에이전트 설정 | ✅ present |
| Toolbar trimmed | ✅ only 🔎 + ⋯ |
| Collapsible terminal dock | ✅ ▼ agents • claude • opencode • codex |

No crashes or console errors beyond the benign WSLg warnings. Screenshots captured to `/tmp/{home,knowledge,wikigen,dropdown}.png` (not committed).

The graph node-peek disk-fallback and the structure-panel gate editing were not click-driven live (SVG node hit-testing over CDP is fiddly) but are covered exhaustively by unit/component tests.

---

## Static verification

```
pnpm --filter @apc/desktop exec vitest run   # 155 passed (27 files)
pnpm run typecheck                            # EXIT 0
```

New/changed test coverage of note: `KnowledgeView` (4), `HomeView` (4), `WikiGenDashboard` (5), `HarnessStructurePanel` (7), `HarnessRunList` (6), `project-files`/`project-changes`/`ipc` (real-git + real-handler integration), `harness-utils` helpers (13), `MarkdownContent`, `GeneratePreflightModal`.

Every task went through the team-mode rhythm (implementer → spec review → quality review → fix → commit). Reviews caught real issues that were fixed, e.g. Task 13 peek→file jump bug, Task 14 untested `diffProjectFile`, Task 15 untested `changesDiff`.

---

## Known limitations / deferred follow-ups

1. **Changes-feed "ingest cutoff" is global, not per-project.** `changes:list` uses `SELECT MAX(updated_at) FROM ingest_cursors` (documented in `ipc.ts`). `ingest_cursors.source_id` is an opaque adapter string with no clean FK to a project, and ingestion runs globally — so per-project scoping needs a schema/semantic change. In multi-project use this can *under*-flag a trailing project's changed docs (`unreflected`). Soft UI hint only.
2. **Home generate-modal unmounts on tab switch.** `generateOpen` state lives in `HomeView`; leaving the Home tab closes the modal (the underlying `generating` store state persists). Low impact.
3. **Deleted markdown files** show under the "수정된 문서" feed group (the per-row `−` marker disambiguates). Cosmetic.
4. **Per-project wiki-policy advisor agent** (user request, 2026-06-12): an agent that proposes a project-tailored wiki policy on top of `DEFAULT_PREAMBLE`. Captured in memory `wiki-policy-advisor-idea.md`; warrants its own brainstorm → spec → plan now that the Wiki Gen settings UI exists to host it.

---

## Next steps

1. Final whole-branch code review (optional — each task already reviewed).
2. `superpowers:finishing-a-development-branch` to merge / PR.
3. When ready, brainstorm the wiki-policy advisor (#4 above).
