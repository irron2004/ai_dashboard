# Harness Run UX + Engine cwd Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make harness-run failures actionable (surface the real CLI error), run the engine CLI in the user's project folder, and show run status (loading/failure) on the Coverage tab while guarding promote so a FAILED run can't be promoted with a confusing error.

**Architecture:** (d) `LlmAgent` includes the captured `res.raw` in its thrown error; (e) thread a `cwd` (the project's repoPath) through `RunInput → CliAgentRunner spawn` and through `DriverDeps.projectCwd → make-drivers run object → LlmAgent`; (b)/(c) branch the Coverage tab on run state and disable promote unless `HUMAN_REVIEW_REQUIRED`. No new IPC channel, no DB migration.

**Tech Stack:** TypeScript, Node child_process, Zod, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-harness-run-ux-and-cwd-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/llm-wiki/src/agent-runner.ts` | Modify | `RunInput` gains `cwd?: string` |
| `packages/knowledge-harness/src/agents/llm-agent.ts` | Modify | surface `res.raw`+engine on failure; forward `cwd` |
| `packages/knowledge-harness/src/agents/llm-agent.test.ts` | Modify | tests for (d) + cwd forward |
| `packages/llm-wiki/src/cli-agent-runner.ts` | Modify | spawn with `cwd: input.cwd` |
| `packages/llm-wiki/src/cli-agent-runner.test.ts` | Modify | cwd → process runs there |
| `packages/knowledge-harness/src/runtime/make-drivers.ts` | Modify | `DriverDeps.projectCwd` + `run` object `cwd` |
| `packages/app-services/src/harness-service.ts` | Modify | thread `projectCwd` (repoPaths[0]) into `runnerFor`/`makeDrivers` |
| `packages/app-services/src/harness-service.test.ts` | Modify | run with repoPaths → runner.calls carry cwd |
| `apps/desktop/src/renderer/components/HarnessDashboard.tsx` | Modify | (b) Coverage status branches + (c) promote guard |
| `apps/desktop/src/renderer/components/AgentConfigPanel.tsx` | Modify | (c) `canPromote?` prop disables Promote |

**Verification commands:**
- knowledge-harness: `npx vitest run packages/knowledge-harness`
- llm-wiki: `npx vitest run packages/llm-wiki`
- app-services: `npx vitest run packages/app-services`
- desktop: `cd apps/desktop && npx vitest run`
- typecheck: `pnpm typecheck`

> NodeNext: relative imports use `.js` even for `.ts`/`.tsx`.

---

## Task 1: (d) Surface real CLI error + (e) forward `cwd` in LlmAgent

**Files:**
- Modify: `packages/llm-wiki/src/agent-runner.ts`
- Modify: `packages/knowledge-harness/src/agents/llm-agent.ts`
- Modify: `packages/knowledge-harness/src/agents/llm-agent.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/knowledge-harness/src/agents/llm-agent.test.ts`, add these tests (import `z` from `zod` and the `AgentRunner`/`RunInput` types from `@apc/llm-wiki` if not already imported; construct a minimal agent — adapt to any existing helper in the file):

```ts
import { z } from 'zod'
import type { AgentRunner, RunInput } from '@apc/llm-wiki'
import { LlmAgent } from './llm-agent.js'

const tinyAgent = () => new LlmAgent({ name: 'project-discovery', role: 'r', preamble: 'p', schema: z.object({ ok: z.boolean() }) })

describe('LlmAgent failure + cwd', () => {
  test('surfaces the runner raw error and the engine name when not ok', async () => {
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: 'spawn claude ENOENT' }) }
    await expect(tinyAgent().run({ runner: failing, engine: 'claude', input: {} }))
      .rejects.toThrow(/project-discovery failed \(claude\): .*ENOENT/)
  })

  test('forwards cwd to the runner', async () => {
    const calls: RunInput[] = []
    const rec: AgentRunner = { run: async (i) => { calls.push(i); return { ok: false, output: '', raw: '' } } }
    await tinyAgent().run({ runner: rec, engine: 'codex', input: { x: 1 }, cwd: '/my/proj' }).catch(() => {})
    expect(calls[0].cwd).toBe('/my/proj')
  })
})
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `npx vitest run packages/knowledge-harness/src/agents/llm-agent.test.ts`
Expected: FAIL — error message is the old `agent runner returned not-ok` (no engine/raw), and `LlmRunArgs`/`RunInput` have no `cwd`.

- [ ] **Step 3: Add `cwd` to `RunInput`**

In `packages/llm-wiki/src/agent-runner.ts`, change:

```ts
export type RunInput = { agent: AgentType; prompt: string; timeoutMs: number }
```

to:

```ts
export type RunInput = { agent: AgentType; prompt: string; timeoutMs: number; cwd?: string }
```

- [ ] **Step 4: Forward cwd + surface raw error in `LlmAgent`**

In `packages/knowledge-harness/src/agents/llm-agent.ts`:

(a) Add `cwd` to `LlmRunArgs`:

```ts
export type LlmRunArgs = { runner: AgentRunner; engine: AgentType; input: unknown; timeoutMs?: number; cwd?: string }
```

(b) Replace the body of `run` up to and including the not-ok throw:

```ts
  async run(args: LlmRunArgs): Promise<O> {
    const res = await args.runner.run({ agent: args.engine, prompt: this.buildPrompt(args.input), timeoutMs: args.timeoutMs ?? 180000, cwd: args.cwd })
    if (!res.ok) {
      const detail = (res.raw || 'agent runner returned not-ok').slice(0, 300)
      throw new Error(`${this.cfg.name} failed (${args.engine}): ${detail}`)
    }
```

(leave the `return parseStructured(...)` line unchanged after this.)

- [ ] **Step 5: Run the tests + typecheck, confirm PASS**

Run: `npx vitest run packages/knowledge-harness/src/agents/llm-agent.test.ts && pnpm typecheck`
Expected: PASS (both new tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-wiki/src/agent-runner.ts packages/knowledge-harness/src/agents/llm-agent.ts packages/knowledge-harness/src/agents/llm-agent.test.ts
git commit -m "feat(knowledge-harness): surface real CLI error + forward cwd in LlmAgent"
```

---

## Task 2: (e) `CliAgentRunner` spawns in the given cwd

**Files:**
- Modify: `packages/llm-wiki/src/cli-agent-runner.ts`
- Modify: `packages/llm-wiki/src/cli-agent-runner.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/llm-wiki/src/cli-agent-runner.test.ts`, add (uses a real `node` child that prints its cwd — deterministic, no network/engine needed):

```ts
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

  test('runs the engine command in the provided cwd', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cwd-test-')))
    const runner = new CliAgentRunner({
      codex: { command: process.execPath, args: ['-e', 'process.stdout.write(process.cwd())'] },
    })
    const res = await runner.run({ agent: 'codex', prompt: '', timeoutMs: 10_000, cwd: dir })
    expect(res.ok).toBe(true)
    expect(realpathSync(res.output.trim())).toBe(dir)
  })
```

(If the file uses a different import name than `CliAgentRunner`, adapt. `process.execPath` is the node binary, guaranteed present.)

- [ ] **Step 2: Run, confirm FAIL**

Run: `npx vitest run packages/llm-wiki/src/cli-agent-runner.test.ts`
Expected: FAIL — without `cwd` passed to spawn, the child prints the test process cwd (repo root), not `dir`.

- [ ] **Step 3: Pass cwd to spawn**

In `packages/llm-wiki/src/cli-agent-runner.ts`, change the `spawn` call:

```ts
      const child = spawn(tpl.command, tpl.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' })
```

to:

```ts
      const child = spawn(tpl.command, tpl.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', cwd: input.cwd })
```

(`cwd: undefined` is valid and means "inherit the parent cwd" — so the non-cwd path is unchanged.)

- [ ] **Step 4: Run the test + typecheck, confirm PASS**

Run: `npx vitest run packages/llm-wiki/src/cli-agent-runner.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-wiki/src/cli-agent-runner.ts packages/llm-wiki/src/cli-agent-runner.test.ts
git commit -m "feat(llm-wiki): CliAgentRunner runs the engine in the provided cwd"
```

---

## Task 3: (e) Thread `projectCwd` (repoPath) through make-drivers + harness-service

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts`
- Modify: `packages/app-services/src/harness-service.ts`
- Modify: `packages/app-services/src/harness-service.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/app-services/src/harness-service.test.ts`, add a test that runs with `repoPaths` and asserts the injected runner received that cwd. Build the service with a `FakeAgentRunner` you hold a reference to (mirror the file's existing `service()` setup — same `ws`/`cannedOutputs()`/`gatesPath`/`now`):

```ts
  test('runs the engine CLI with the project repoPath as cwd', async () => {
    const runner = new FakeAgentRunner(cannedOutputs())   // reuse the file's canned outputs helper
    const harness = new HarnessService({
      runner, vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now,                  // reuse the file's gatesPath/now
    })
    const repo = join(ws, 'repo')
    await harness.run({ projectId: 'p1', engine: 'claude', repoPaths: [repo] })
    expect(runner.calls.length).toBeGreaterThan(0)
    expect(runner.calls[0].cwd).toBe(repo)
  })
```

(`FakeAgentRunner` is imported from `@apc/llm-wiki`; it already records every `RunInput` in `.calls`. Adapt identifier names to the file's existing helpers — `ws`, `cannedOutputs`, `gatesPath`, `now`. Import `join`/`FakeAgentRunner` if not already imported.)

- [ ] **Step 2: Run, confirm FAIL**

Run: `npx vitest run packages/app-services/src/harness-service.test.ts`
Expected: FAIL — `runner.calls[0].cwd` is `undefined` (cwd not threaded).

- [ ] **Step 3: Add `projectCwd` to make-drivers**

In `packages/knowledge-harness/src/runtime/make-drivers.ts`:

(a) Add the field to `DriverDeps`:

```ts
export type DriverDeps = {
  runner: AgentRunner
  vaultRoot: string
  stagingRoot: string
  preamble: string
  projectCwd?: string
}
```

(b) Include it in the shared `run` object (currently `const run = { runner: deps.runner }`):

```ts
  const run = { runner: deps.runner, cwd: deps.projectCwd }
```

(every driver already spreads `{ ...run, engine, input }`, so `cwd` now flows to each `LlmAgent.run`.)

- [ ] **Step 4: Thread projectCwd through harness-service**

In `packages/app-services/src/harness-service.ts`:

(a) Change `runnerFor` to accept and forward `projectCwd`:

```ts
  private runnerFor(runId: string, projectId: string, projectCwd?: string): HarnessRunner {
    const drivers = makeDrivers({
      runner: this.deps.runner, vaultRoot: this.deps.vaultRoot,
      stagingRoot: this.stagingDir(runId), preamble: this.preamble, projectCwd,
    })
    const lock = new RunLock(join(this.deps.runsRoot, '.locks'), projectId)
    return new HarnessRunner({ gates: this.featureGate(), drivers, now: this.now, lock })
  }
```

(b) In `run()`, pass the project's first repoPath as cwd. Change:

```ts
    const runner = this.runnerFor(runId, input.projectId)
```

to:

```ts
    const runner = this.runnerFor(runId, input.projectId, input.repoPaths?.[0])
```

(Leave `resume()`'s `runnerFor(input.runId, prev.projectId)` call unchanged — resume keeps the prior behavior, cwd undefined.)

- [ ] **Step 5: Run tests + typecheck, confirm PASS**

Run: `npx vitest run packages/app-services packages/knowledge-harness && pnpm typecheck`
Expected: PASS — the new cwd test passes, all existing harness/app-services tests stay green, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/runtime/make-drivers.ts packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.test.ts
git commit -m "feat: run harness engine in the project repoPath (thread projectCwd)"
```

---

## Task 4: (b) Coverage tab shows loading / failure / coverage

**Files:**
- Modify: `apps/desktop/src/renderer/components/HarnessDashboard.tsx`

- [ ] **Step 1: Replace the coverage tab content**

In `apps/desktop/src/renderer/components/HarnessDashboard.tsx`, replace the coverage tab block (currently lines ~121-125):

```tsx
            {tab === 'coverage' && (
              coverageData
                ? <CoverageMatrix data={coverageData} onOpenSource={(p) => window.alert(p)} />
                : <div className="harness-dashboard__placeholder">아직 커버리지 데이터가 없습니다 — "전 문서로 위키 생성"을 실행하세요.</div>
            )}
```

with:

```tsx
            {tab === 'coverage' && (
              harnessLoading
                ? <div className="harness-dashboard__placeholder">⏳ 위키 생성 중… (수 분 소요 — 단계별 LLM 호출)</div>
                : coverageData
                  ? <CoverageMatrix data={coverageData} onOpenSource={(p) => window.alert(p)} />
                  : currentRun?.runState.state === 'FAILED'
                    ? <div className="harness-dashboard__placeholder harness-dashboard__placeholder--error">❌ 실패: {currentRun.runState.error ?? '원인 미상'}</div>
                    : <div className="harness-dashboard__placeholder">아직 커버리지 데이터가 없습니다 — "전 문서로 위키 생성"을 실행하세요.</div>
            )}
```

- [ ] **Step 2: Add a small style for the error variant**

Append to `apps/desktop/src/renderer/app.css`:

```css
.harness-dashboard__placeholder--error { color: #f87171; white-space: pre-wrap; }
```

(If `.harness-dashboard__placeholder` is not defined in app.css, that's fine — the base div still renders; this rule only adds the error color.)

- [ ] **Step 3: Verify**

Run: `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck`
Expected: full desktop suite green, typecheck clean. (`currentRun.runState.state`/`.error` are valid — `RunState` has `state` and optional `error`.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/HarnessDashboard.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): Coverage tab shows loading + failure reason"
```

---

## Task 5: (c) Guard promote unless the run is HUMAN_REVIEW_REQUIRED

**Files:**
- Modify: `apps/desktop/src/renderer/components/HarnessDashboard.tsx`
- Modify: `apps/desktop/src/renderer/components/AgentConfigPanel.tsx`

- [ ] **Step 1: Compute `canPromote` and guard the canonical buttons (HarnessDashboard)**

In `apps/desktop/src/renderer/components/HarnessDashboard.tsx`, after `currentRun` is computed (near the `coverageData` line), add:

```tsx
  const canPromote = currentRun?.runState.state === 'HUMAN_REVIEW_REQUIRED'
```

Then change the canonical proposal button (currently `disabled={harnessLoading}` at line ~137) to:

```tsx
                      disabled={harnessLoading || !canPromote}
                      title={canPromote ? undefined : '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 promote할 수 있습니다'}
```

And pass `canPromote` to the config panel — change the `<AgentConfigPanel ... />` props (around line 149-161) to add:

```tsx
          canPromote={canPromote}
```

- [ ] **Step 2: Disable the Promote button in AgentConfigPanel**

In `apps/desktop/src/renderer/components/AgentConfigPanel.tsx`:

(a) Read the file. Find its `Props` type and add an optional field:

```tsx
  canPromote?: boolean
```

(b) Destructure `canPromote` in the component signature (default true), e.g. `export function AgentConfigPanel({ ..., canPromote = true }: Props)`.

(c) Find the "Promote current" button (the one wired to `onPromote`). It is currently disabled by `loading`. Change its `disabled` to also honor `canPromote`, and add a title:

```tsx
            disabled={loading || !canPromote}
            title={canPromote ? undefined : '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 promote할 수 있습니다'}
```

(Match the exact existing JSX of that button; only extend its `disabled` and add `title`. Do not change other buttons.)

- [ ] **Step 3: Verify**

Run: `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck`
Expected: full desktop suite green, typecheck clean. (If `AgentConfigPanel.test.tsx` asserts the Promote button enabled/disabled, confirm those tests still pass — the default `canPromote = true` preserves prior behavior when the prop is omitted.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/HarnessDashboard.tsx apps/desktop/src/renderer/components/AgentConfigPanel.tsx
git commit -m "feat(desktop): disable promote unless run is HUMAN_REVIEW_REQUIRED"
```

---

## Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run every affected suite + typecheck**

```bash
npx vitest run packages/llm-wiki
npx vitest run packages/knowledge-harness
npx vitest run packages/app-services
cd apps/desktop && npx vitest run && cd ../..
pnpm typecheck
```
Expected: all green, typecheck clean.

- [ ] **Step 2: Confirm acceptance criteria (spec §6)**

1. CLI failure reason includes engine + real error. ✔ (Task 1)
2. Harness runs CLI with repoPath as cwd. ✔ (Task 2/3)
3. Coverage tab shows loading/failure/coverage by state. ✔ (Task 4)
4. Promote disabled unless HUMAN_REVIEW_REQUIRED. ✔ (Task 5)
5. New + existing tests + typecheck pass. ✔ (Step 1)
6. No new IPC channel / no migration. ✔

- [ ] **Step 3: Note the residual reality**

These changes make failures visible/actionable and run the CLI in the right folder, but the wiki only generates when the selected engine CLI is installed, authenticated, and on the app's PATH. The new error message (Task 1) is what tells the user which of those is missing.

---

## Notes for the implementer

- Tasks 1/3/5 add fields/props consumed by later code in the same task — keep names exact: `RunInput.cwd`, `LlmRunArgs.cwd`, `DriverDeps.projectCwd`, `AgentConfigPanel` prop `canPromote`.
- `cwd: undefined` everywhere means "inherit parent cwd" — the non-materialize / resume / no-repoPath paths keep their current behavior.
- Do NOT change the 9-state pipeline logic or add IPC channels.
- For Tasks 4/5 (HarnessDashboard has no unit test), correctness is gated by `pnpm typecheck` + the full desktop suite staying green.
