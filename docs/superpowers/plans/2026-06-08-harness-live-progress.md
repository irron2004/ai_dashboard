# Harness Live Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stream per-stage progress from the harness run to the renderer so the user sees the current stage live during the multi-minute run.

**Architecture:** Additive `onProgress` callback through `HarnessRunner.advance` → `HarnessService.run` → container `emitHarnessProgress` → `harness:progress` IPC event → preload `onHarnessProgress` → store → UI. Everything optional/fire-and-forget; the core run is unchanged when unwired.

**Tech Stack:** TypeScript, Electron IPC events, React, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-harness-live-progress-design.md`

---

## Task 1: `HarnessRunner.advance(store, onProgress?)`

**Files:** Modify `packages/knowledge-harness/src/runtime/harness-runner.ts` + `packages/knowledge-harness/src/runtime/harness-runner.test.ts`

- [ ] **Step 1: failing test** — in `harness-runner.test.ts`, add a test that `advance` calls `onProgress` with each stage in order. Reuse the file's existing runner/store/drivers setup (it already constructs a `HarnessRunner` with fake drivers + a store). Add:

```ts
  test('advance reports each stage to onProgress in order', async () => {
    // build the runner + store the same way the other tests in this file do (reuse helpers).
    const seen: string[] = []
    await runner.advance(store, (rs) => seen.push(rs.state))
    // the first reported state is the first pipeline step's `to`, last is the terminal this run reaches.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).toEqual([...seen].filter(Boolean))   // no empties
    // states are reported in non-decreasing pipeline order (each distinct, monotonic)
    expect(seen[0]).not.toBe(seen[seen.length - 1])
  })
```
(Adapt identifiers — `runner`/`store` — to the file's existing setup. If the test file's run reaches a single terminal with few stages, assert `seen` contains the expected stage names that file's drivers produce.)

- [ ] **Step 2: run, confirm FAIL** — `npx vitest run packages/knowledge-harness/src/runtime/harness-runner.test.ts` (advance takes no 2nd arg / onProgress never called).

- [ ] **Step 3: implement** — in `harness-runner.ts`, change the signature and emit after each save:
```ts
  async advance(store: RunArtifactStore, onProgress?: (rs: RunState) => void): Promise<RunState> {
```
In the success branch, AFTER `store.saveRunState(runState)` and `ctx.runState = runState`, add:
```ts
          onProgress?.(runState)
```
In the FAILED catch branch, AFTER `store.saveRunState(runState)` and BEFORE `return runState`, add:
```ts
          onProgress?.(runState)
```

- [ ] **Step 4: run test + typecheck PASS** — `npx vitest run packages/knowledge-harness && pnpm typecheck`.

- [ ] **Step 5: commit**
```bash
git add packages/knowledge-harness/src/runtime/harness-runner.ts packages/knowledge-harness/src/runtime/harness-runner.test.ts
git commit -m "feat(knowledge-harness): advance() reports per-stage progress via onProgress"
```

---

## Task 2: `HarnessService.run(input, onProgress?)` passthrough

**Files:** Modify `packages/app-services/src/harness-service.ts` + `packages/app-services/src/harness-service.test.ts`

- [ ] **Step 1: failing test** — in `harness-service.test.ts`, add (reuse the `service()`/FakeAgentRunner setup):
```ts
  test('run forwards per-stage progress to onProgress', async () => {
    const stages: string[] = []
    await service().run({ projectId: 'p1', engine: 'claude' }, (rs) => stages.push(rs.state))
    expect(stages.length).toBeGreaterThan(0)
  })
```
(Use the file's exact service constructor/`cannedOutputs()`.)

- [ ] **Step 2: run, confirm FAIL** — `run` takes no 2nd arg.

- [ ] **Step 3: implement** — in `harness-service.ts`:
(a) `advanceSafely` gains the param and forwards it:
```ts
  private async advanceSafely(runId: string, runner: HarnessRunner, store: RunArtifactStore, onProgress?: (rs: RunState) => void): Promise<HarnessRunResult> {
    try {
      const rs = await runner.advance(store, onProgress)
```
(b) `run` gains the param and passes it:
```ts
  async run(input: { projectId: string; engine: AgentType; materialize?: boolean; repoPaths?: string[] }, onProgress?: (rs: RunState) => void): Promise<HarnessRunResult> {
```
and change the `advanceSafely` call to `return this.advanceSafely(runId, runner, store, onProgress)`. Import `RunState` type from `@apc/shared` if not already imported.

- [ ] **Step 4: run tests + typecheck PASS** — `npx vitest run packages/app-services && pnpm typecheck`.

- [ ] **Step 5: commit**
```bash
git add packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.test.ts
git commit -m "feat(app-services): HarnessService.run forwards onProgress to advance"
```

---

## Task 3: IPC channel + container emit + main + preload wiring

**Files:** Modify `apps/desktop/src/shared/ipc-contract.ts`, `apps/desktop/src/main/container.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/api.ts`

- [ ] **Step 1: ipc-contract** — in `CH` add `harnessProgress: 'harness:progress'`, and add the type:
```ts
export type HarnessProgressEvent = { runId: string; state: string }
```

- [ ] **Step 2: container** — in `buildContainer(opts: {...})`, add to the opts type:
```ts
  emitHarnessProgress?: (e: { runId: string; state: string }) => void
```
and change `harnessRun` to pass an onProgress that emits:
```ts
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => {
    const project = registry.get(req.projectId)
    return harness.run(
      { projectId: req.projectId, engine: req.engine, materialize: req.materialize, repoPaths: project?.repoPaths ?? [] },
      (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }),
    )
  }
```
(The onProgress param is `(rs: RunState) => void`; `rs.runId`/`rs.state` are valid.)

- [ ] **Step 3: main index.ts** — where `buildContainer({...})` is called, add:
```ts
    emitHarnessProgress: (e) => win.webContents.send(CH.harnessProgress, e),
```
(Ensure `win` is in scope at the createContainer call — if the container is built before `win`, move the emit to use a late-bound ref, or construct the container after `win`. Read index.ts: `win` is created near the top of `createWindow`; the container is built there too. Pass the emit referencing `win`.)

- [ ] **Step 4: preload** — add to the `apc` object (mirror `onPtyData`):
```ts
  onHarnessProgress: (cb: (e: { runId: string; state: string }) => void) => {
    const handler = (_e: unknown, ev: { runId: string; state: string }) => cb(ev)
    ipcRenderer.on(CH.harnessProgress, handler)
    return () => ipcRenderer.removeListener(CH.harnessProgress, handler)
  },
```

- [ ] **Step 5: api.ts** — add to the `window.apc` interface block: `onHarnessProgress(cb: (e: { runId: string; state: string }) => void): () => void` and an exported `onHarnessProgress` wrapper:
```ts
  onHarnessProgress(cb: (e: { runId: string; state: string }) => void): () => void {
    return window.apc.onHarnessProgress(cb)
  },
```
(Match the file's existing structure for the `api` object + the `window.apc` type.)

- [ ] **Step 6: verify** — `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck` — green, clean. (No unit test for this wiring; typecheck + suite gate it, same as pty wiring.)

- [ ] **Step 7: commit**
```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(desktop): harness:progress IPC event (container emit + preload + api)"
```

---

## Task 4: renderer store subscription + live stage UI

**Files:** Modify `apps/desktop/src/renderer/store.ts`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/components/HarnessDashboard.tsx`

- [ ] **Step 1: store** — add `harnessProgress: string | null` to the `ApcStore` type and initial state (`harnessProgress: null`). Add an action `setHarnessProgress(state: string | null): void` that does `set({ harnessProgress: state })`. In `startHarnessRun`, at the very start (where it sets `harnessLoading: true`), also set `harnessProgress: null`.

- [ ] **Step 2: App.tsx subscription** — add a `useEffect` (once) that subscribes:
```tsx
  useEffect(() => api.onHarnessProgress((e) => useStore.getState().setHarnessProgress(e.state)), [])
```
(`api.onHarnessProgress` returns the cleanup fn; returning it from the effect unsubscribes. Import `useStore` if not already; `api` is already imported.)

- [ ] **Step 3: HarnessDashboard live stage** — destructure `harnessProgress` from the store. In the Coverage tab's `harnessLoading` branch, show the current stage. Replace:
```tsx
                ? <div className="harness-dashboard__placeholder">⏳ 위키 생성 중… (수 분 소요 — 단계별 LLM 호출)</div>
```
with:
```tsx
                ? <div className="harness-dashboard__placeholder">⏳ 위키 생성 중… {harnessProgress ? `(현재: ${harnessProgress})` : '(시작 중)'}</div>
```

- [ ] **Step 4: verify** — `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck` — green, clean.

- [ ] **Step 5: commit**
```bash
git add apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/HarnessDashboard.tsx
git commit -m "feat(desktop): show live harness stage during the run"
```

---

## Task 5: full verification

- [ ] Run `npx vitest run packages/knowledge-harness packages/app-services`; `cd apps/desktop && npx vitest run`; `pnpm typecheck` — all green.
- [ ] Confirm AC (spec §5): live stage shown; onProgress optional (no regression); fire-and-forget; no new command channel; no migration.

## Notes
- Everything is additive/optional. The unwired path (tests, resume) is unchanged because `onProgress`/`emitHarnessProgress` default to undefined.
- The wiring (Task 3) has no unit test by nature (same as the pty IPC wiring); typecheck + the full suite gate it.
