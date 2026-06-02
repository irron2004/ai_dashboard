---
title: Generate / LLM Wiki UI — Design
date: 2026-06-02
status: draft
owner: irron2004
relates: 2026-06-01-agent-project-console-design.md (PRD v0.4 §9 LLM Wiki engine, §11 vault, §10 conflict)
---

# Generate / LLM Wiki UI — Design

## 0. Goal

Wire the already-built LLM Wiki engine into the desktop app so a PM can, with one click, **turn recent agent work into Obsidian-compatible project memory**: pick an engine, generate a work summary + a `current.md` proposal, review it, and promote it into the canonical vault.

> Engines already exist (`@apc/llm-wiki` `WikiEngine`/`CliAgentRunner`/`buildWikiPrompt`/`parseStructured`; `@apc/pm` `VaultWriter`; `@apc/app-services` `RunService`/`CurrentPromotionService`; renderer `ModelPicker`). This spec covers the **desktop wiring** plus two engine fixes needed to make it work.

## 1. Scope (MVP)

In:
- A **Generate** action per project → **model picker** (claude/codex/opencode) → runs the chosen CLI headless → writes a **work summary** + **`current.proposal.md`** into the project's vault.
- A **review/promote** step: show the proposal; **Promote** writes it to canonical `current.md` (conflict-gated, human-approved).
- Generation **source = the latest local agent session for the project** (no Task/AgentRun prerequisite).

Out (P1+):
- Full task-lifecycle Generate (Task → AgentRun → Review next-tasks) — that's `RunService`'s richer path; deferred.
- Auto/scheduled generation; multi-session synthesis; remote (ssh) session sourcing.

## 2. Key decisions

### 2.1 What does Generate operate on?
The desktop terminals are plain shells — there is **no `AgentRun` record or captured transcript**. So Generate does **not** depend on a Task/AgentRun. Instead:

> **Generate summarizes the most recent agent session for the selected project.**

A new `GenerateService.generateForProject({ projectId, engine })`:
1. Asks each ingest adapter (`@apc/agents`) to `discoverSources`, ordered most-recent-first.
2. Parses sources in order (cap ~25) until one whose `NormalizedSession.repoPath` matches the project's `repoPaths[0]`.
3. Reads current canonical (`vault/projects/<id>/current.md`, or `''`).
4. `WikiEngine.generate(session, { engine, currentCanonical })`.
5. `VaultWriter.writeRunSummary(...)` → `agent-runs/gen-<stamp>-summary.md`; if `currentProposalMarkdown` present → `VaultWriter.writeCurrentProposal(...)` → `current.proposal.md`.
6. Returns `{ ok, generation, summaryPath, proposalPath, sessionId }` or `{ ok:false, reason }` when no session is found.

If the project path is `ssh://…`, no local session matches in MVP → returns "no local session" (remote-session sourcing is P1).

### 2.2 Headless CLI invocation must be robust (engine fix)
`CliAgentRunner` currently substitutes the prompt into **argv** (`{{PROMPT}}`) and `spawn`s the bare command. Two problems: (1) Windows agent CLIs are `.cmd` shims → bare `spawn('claude')` fails (`ENOENT`); (2) a large prompt in argv is fragile (quoting/length). Fix:

> **Pass the prompt via stdin**, and spawn **shell-safely on Windows**.

- Command templates carry no `{{PROMPT}}`; the prompt is written to the child's **stdin** (`claude -p --output-format json`, `codex exec`, `opencode run` reading stdin).
- Spawn with `shell: process.platform === 'win32'` (so `.cmd`/PATHEXT resolves), `stdio: ['pipe','pipe','pipe']`, write prompt to stdin, then `end()`.
- Keep timeout/kill + `{ ok, output, raw }`. `FakeAgentRunner` stays for tests; a real-subprocess test drives `node -e` reading stdin.
- Exact flags remain version-dependent (per PRD §9) — the templates are the documented defaults and overridable; failures surface as `ok:false` with stderr in the UI.

### 2.3 Trigger & review (PRD §9 권한)
- Trigger = **single user click** ("Generate" button) → **ModelPicker** modal (default engine per project; override in picker).
- Output is **candidate/proposal**: summary + `current.proposal.md` are written automatically; **canonical `current.md` is written only on Promote** (`CurrentPromotionService`, hash-gated → conflict doc on mismatch).

## 3. Flow

```
[user clicks Generate]
   → ModelPicker (claude | codex | opencode)
   → generateProject(projectId, engine)         (IPC → main)
        → GenerateService: latest session for project → WikiEngine(chosen CLI) → VaultWriter
        → writes agent-runs/gen-<stamp>-summary.md + current.proposal.md
   → result panel: work summary, files, open problems, next-task candidates, proposal preview
   → [Promote current] → promoteCurrent(projectId, lastReadHash)
        → CurrentPromotionService: writes current.md (or conflict doc), human-gated
```

## 4. Interfaces

```ts
// IPC
generateProject: 'c:generateProject'   // existing: promoteCurrent, selectProfile, ...
type GenerateProjectReq = { projectId: string; engine: AgentType }
type GenerateProjectRes = {
  ok: boolean
  reason?: string                       // when ok=false (e.g. "no local session found")
  sessionId?: string
  summaryPath?: string
  proposalPath?: string
  generation?: WikiGeneration           // workSummary, filesTouched, openProblems, nextTasks, currentProposalMarkdown
}

// app-services
class GenerateService {
  constructor(deps: {
    adapters: AgentIngestAdapter[]
    registry: ProjectRegistry
    vault: VaultAdapter
    vaultWriter: VaultWriter
    wiki: WikiEngine
    now?: () => string
  })
  generateForProject(input: { projectId: string; engine: AgentType }): Promise<GenerateProjectRes>
}
```

## 5. UI

- **Generate button** in the PM Home toolbar (next to Ingest), enabled when a project is selected.
- Click → **ModelPicker** modal (reuse existing component) → on pick, call `generateProject`, show a running state.
- **Result modal/panel**: work summary, files touched, open problems, next-task candidates (list), and a **proposal preview** (`current.proposal.md` body) with:
  - **Promote current** → `promoteCurrent`; on conflict, show "conflict document created" notice with its path.
  - **Close**.
- Engine default per project: store `defaultEngine` (P1); MVP defaults to `claude`.

## 6. Acceptance criteria

1. With a project selected, **Generate → pick engine** runs and (on success) writes `current.proposal.md` + a `gen-*-summary.md` under the project's vault.
2. The result panel shows the summary, files, open problems, next-task candidates, and the proposal text.
3. **Promote** writes `current.md` from the proposal; if `current.md` changed since last read, a **conflict doc** is created and canonical is not overwritten.
4. Generated Markdown opens cleanly in Obsidian (frontmatter + `[[wiki-link]]`).
5. When no local session matches the project, the UI shows a clear "no session to summarize" message (no crash).
6. `CliAgentRunner` works on Windows (`.cmd` shims) by spawning shell-safely and passing the prompt via stdin; engine failures surface as a readable error.
7. `pnpm test` stays green; new logic (`GenerateService`, stdin runner) is unit-tested with fakes.

## 7. Non-goals / risks

- **CLI headless behavior is agent/version-specific** — the default templates may need per-machine adjustment; failures are surfaced, not hidden.
- **Generation source is "latest local session"** — not remote (ssh) sessions, not multi-session synthesis (P1).
- No auto-trigger; generation is always a user click (cost control, PRD §9).
