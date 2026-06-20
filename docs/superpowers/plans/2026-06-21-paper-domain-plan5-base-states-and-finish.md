# Paper Domain — Plan 5: base-states overlay + finish (real generation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. NOTE: subagent monthly spend limit was hit in the prior session — these may need controller-direct execution until the limit is raised.

**Goal:** Make a real `domain:'paper'` run clean and complete: (1) overlay the BASE states so paper runs never call project-docs LLM agents (the Plan 4 gap), then the finishing pieces — (2) PDF ingest via autosci-read, (3) typed edges → `edges.jsonl`, (4) package `wiki-domains/`, (5) a real end-to-end LLM run.

**Architecture:** `makePaperDrivers` already overlays `NODE_PROPOSALS_CREATED`/`STAGING_WRITTEN`/`VALIDATED`. Plan 4 left the base states (`PROJECT_SCANNED`/`SOURCES_EXTRACTED`/`DOCUMENTS_CLASSIFIED`/`LEAD_MERGED`/`WRITE_PLAN_CREATED`) running the project-docs agents. This plan adds **minimal paper base-state drivers** (mirroring the proven `paper-phase1-drivers.ts`, minus the golden fixture) so the paper overlay covers every state the run advances through — no project-docs agent runs for paper. The other tasks complete ingest/edges/packaging.

**Tech Stack:** TypeScript (pnpm monorepo), the harness runtime, `@apc/wiki-substrate`, Vitest.

## Global Constraints

- project-docs runs MUST stay byte-identical — only `makePaperDrivers` and the paper branch of `makeDrivers` change.
- The base-state minimal drivers must produce the SAME artifact names the runner/UI expect (`ARTIFACTS.projectDiscovery`, `conversationHistory`, `documentIntent`, `graphUpdatePlan`, `writePlan`), mirroring `paper-phase1-drivers.ts` which is proven to advance to `HUMAN_REVIEW_REQUIRED`.
- Paper interactive-confirm mode is OUT of scope (the minimal `WRITE_PLAN_CREATED` does not pause) — a follow-on.
- Tests from repo root. Typecheck: `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`.

## File Structure

- `packages/knowledge-harness/src/runtime/paper-drivers.ts` — add the 5 minimal base-state drivers.
- `packages/knowledge-harness/src/runtime/paper-pipeline-routing.test.ts` — assert base states are now the paper-minimal ones (not project-docs).

---

### Task 1: base-states overlay (paper runs never call project-docs agents) — THIS PLAN'S CORE

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/paper-drivers.ts`
- Modify: `packages/knowledge-harness/src/runtime/paper-pipeline-routing.test.ts`

**Interfaces:**
- Consumes: `ARTIFACTS` (make-drivers).
- Produces: `makePaperDrivers` additionally returns `PROJECT_SCANNED`, `SOURCES_EXTRACTED`, `DOCUMENTS_CLASSIFIED`, `LEAD_MERGED`, `WRITE_PLAN_CREATED` (minimal, no LLM).

- [ ] **Step 1: Update the failing routing test**

In `paper-pipeline-routing.test.ts`, change the third test ("paper overlay keeps the project-docs base states...") to assert the base states are now the PAPER-minimal ones, proving no project-docs agent runs:
```ts
  test('paper overlay replaces the base states (no project-docs agents run)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'route-base-'))
    try {
      const store = new RunArtifactStore(join(dir, 'run')); store.init()
      const paper = makeDrivers(deps(dir, fakeRunner({}), true))
      // PROJECT_SCANNED is now the paper-minimal driver: emits { domain: 'paper' } with NO runner call.
      const res = await paper.PROJECT_SCANNED!(nodeProposalsCtx(store))
      const data = res.artifacts.find((a) => a.name === ARTIFACTS.projectDiscovery)!.data as { domain?: string }
      expect(data.domain).toBe('paper')
      // all generation + base states present
      for (const s of ['PROJECT_SCANNED','SOURCES_EXTRACTED','DOCUMENTS_CLASSIFIED','LEAD_MERGED','WRITE_PLAN_CREATED','NODE_PROPOSALS_CREATED','STAGING_WRITTEN','VALIDATED'] as const) expect(paper[s]).toBeDefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
```

- [ ] **Step 2: Run → RED** (`PROJECT_SCANNED` for paper currently runs the project-docs discovery agent via the fake runner, so `data.domain` is not `'paper'`).

Run: `pnpm exec vitest run packages/knowledge-harness/src/runtime/paper-pipeline-routing.test.ts`

- [ ] **Step 3: Add the minimal base-state drivers**

In `paper-drivers.ts`, inside the returned object (alongside the 3 existing drivers), add (mirroring `paper-phase1-drivers.ts`):
```ts
    PROJECT_SCANNED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.projectDiscovery, data: { domain: 'paper' } }] }),
    SOURCES_EXTRACTED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.conversationHistory, data: { sessions: [], summary: '' } }] }),
    DOCUMENTS_CLASSIFIED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.documentIntent, data: { documents: [] } }] }),
    LEAD_MERGED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.graphUpdatePlan, data: { node_ops: [], edge_ops: [] } }] }),
    WRITE_PLAN_CREATED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.writePlan, data: { operations: [] } }] }),
```
> NOTE: confirm each artifact's minimal `data` shape parses if anything downstream reads it. `paper-phase1-drivers.ts` used `{ ops: [] }` for the write plan and `{ node_ops: [] }` for the graph plan — if a strict schema parse fails, match paper-phase1's exact shapes. Paper STAGING_WRITTEN/VALIDATED don't read these, so the shapes only need to not crash the runner.

- [ ] **Step 4: Run → GREEN + regression + typecheck**

Run: `pnpm exec vitest run packages/knowledge-harness` and `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json`
Expected: routing test green, full knowledge-harness suite unchanged for project-docs, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge-harness/src/runtime/paper-drivers.ts packages/knowledge-harness/src/runtime/paper-pipeline-routing.test.ts
git commit -m "feat(knowledge-harness): paper base-state overlays — paper runs no longer call project-docs agents"
```

---

### Task 2 (follow-on): PDF ingest via autosci-read
Extend `WikiSubstrate.checkSources` (or add `ingest`) to return parsed text for `raw/papers/*.pdf`; feed it into the extractor's `sources` alongside the `SourceReader` markdown/text. Currently only markdown/text in `raw/` reaches the extractor.

### Task 3 (follow-on): typed edges → `wiki/graph/edges.jsonl`
Have the extractor (or a LEAD_MERGED paper step) emit typed edges (`uses_module`/`pipeline_from_paper`/`alternative_to`); render them to `<stagingRoot>/wiki/graph/edges.jsonl` in STAGING_WRITTEN so the kernel lints the graph and the UI shows edges.

### Task 4 (follow-on): package `wiki-domains/`
electron-builder `extraResources` for `wiki-domains/`; set/resolve `APC_PAPER_CONTRACT_DIR` in the packaged app so `resolvePaperContractDir()` finds the contract (verify in a packaged build). The Windows-packaging clone (`[[win-packaging-clone]]`) is where this is built.

### Task 5 (follow-on): real end-to-end LLM run
On a machine with the venv (WSL/Linux): set the papers project `domain=paper`, run "생성", confirm it ingests the workspace docs, the LLM emits typed nodes, kernel lint gates, and the wiki promotes. This is the empirical proof the whole feature works.

---

## Self-Review

**Spec coverage:** Task 1 closes the Plan 4 base-states gap (the one correctness blocker for a clean paper run); Tasks 2-5 are the remaining finish work, scoped as follow-ons. Interactive-confirm for paper is explicitly out of scope.

**Placeholder scan:** Task 1 has concrete code; the NOTE on minimal artifact shapes points at the proven `paper-phase1-drivers.ts`. Tasks 2-5 are intentionally descriptive (each warrants its own task breakdown when started).

**Type consistency:** the 5 added drivers all return `DriverResult { artifacts: [...] }`, matching the existing paper drivers and the `Driver` type.

---

## Execution Handoff

(see skill — offered after save)
