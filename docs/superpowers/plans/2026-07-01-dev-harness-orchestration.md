# Dev-Harness Orchestration (S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ai_dashboard 콘솔이 프로젝트 task에 대해 멀티에이전트 하네스(langgraph-agent `agents_up_cli.sh`)를 shell-out으로 구동하고, 로그를 live 스트리밍하며, 실행 이력을 `AgentRunStore`에 기록한다.

**Architecture:** 신규 `DevHarnessService`(app-services)가 `ProjectRegistry`로 repoPath를 풀고 `HarnessCli`(주입식 spawner, `CLI_CONTRACT.md` 어댑터)로 CLI를 실행한다. run 생명주기는 `AgentRunStore`(create→complete/fail)에 기록되고, stdout/stderr는 transcript 파일 + renderer live tail로 fan-out된다. 위키 `HarnessService`와 독립.

**Tech Stack:** TypeScript, Node `child_process`, Electron IPC, Vitest 2, Zod, node:sqlite.

## Global Constraints

- 변경은 **ai_dashboard + autosci-core 내부로만**. langgraph-agent 코드 수정 금지 — `agents/CLI_CONTRACT.md`는 읽기 전용 seam.
- typecheck 권위 = 루트 `pnpm typecheck`(IDE 진단 오경보 무시).
- 기존 위키 하네스(`HarnessService`, `harnessRun` IPC, `harness:engineLog`)와 채널/서비스 분리 — dev 하네스는 `devHarness*` 네임스페이스.
- 커밋은 각 task 종료 시. 커밋 메시지 끝에 Co-Authored-By 트레일러.
- TDD: 실패 테스트 → 최소 구현 → green → commit.

---

### Task 1: vitest workspace — 루트 test가 apps/desktop도 실행 (인프라 하드닝)

**근거:** 루트 `vitest.config.ts`의 `include`가 `packages/**`·`scripts/**`만 포함해 `apps/desktop` 누락 → SP1 회귀를 검증에서 놓친 함정. vitest ^2.0.0이므로 `vitest.workspace.ts`로 두 config를 한 run에 묶는다.

**Files:**
- Create: `vitest.workspace.ts`
- Verify: `vitest.config.ts`(루트), `apps/desktop/vitest.config.ts`(둘 다 존재 확인됨)

**Interfaces:**
- Produces: 루트 `pnpm test`가 packages(node) + apps/desktop(자체 env) 양쪽 스위트를 실행.

- [ ] **Step 1: workspace 파일 작성**

```ts
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config'

// vitest ^2: 루트 packages/scripts 스위트와 apps/desktop 스위트를 한 `vitest run`에 묶는다.
// (예전엔 루트 include가 apps/**를 빠뜨려 apps/desktop 테스트가 회귀 검증에서 누락됐다.)
export default defineWorkspace([
  './vitest.config.ts',
  './apps/desktop/vitest.config.ts',
])
```

- [ ] **Step 2: 양쪽 스위트가 한 번에 도는지 확인**

Run: `pnpm test 2>&1 | tail -20`
Expected: packages 테스트 + apps/desktop 테스트(예: `ipc.test.ts`의 "IPC handlers (no Electron)")가 **둘 다** 실행되고 통과. 이전엔 apps/desktop이 안 돌았음.

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 통과(설정 파일 추가만이라 무영향).

- [ ] **Step 4: Commit**

```bash
git add vitest.workspace.ts
git commit -m "test: vitest workspace so root test runs apps/desktop too (close SP1 regression gap)"
```

---

### Task 2: AgentKind 'harness' + AgentRunStore.fail()

**Files:**
- Modify: `packages/shared/src/schema.ts:3` (AgentKind enum)
- Modify: `packages/pm/src/agent-run-store.ts` (add `fail`)
- Test: `packages/pm/src/agent-run-store.test.ts` (create if absent)

**Interfaces:**
- Produces: `AgentKind`에 `'harness'` 추가. `AgentRunStore.fail(id: string, patch: { endedAt: string }): void` — status를 'failed'로, ended_at 기록.
- Consumes: 기존 `AgentRunStore.create(input: AgentRun)`, `migratePm(db)`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// packages/pm/src/agent-run-store.test.ts
import { test, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migratePm } from './migrate.js'
import { AgentRunStore } from './agent-run-store.js'
import { AgentKind } from '@apc/shared'

function freshStore() {
  const db = new DatabaseSync(':memory:')
  migratePm(db)
  return new AgentRunStore(db as never)
}

test("AgentKind includes 'harness'", () => {
  expect(AgentKind.parse('harness')).toBe('harness')
})

test('fail() marks a run failed with endedAt', () => {
  const runs = freshStore()
  runs.create({
    id: 'run:P:1', taskId: 'req:P:s1', agent: 'harness', repoPath: '/r',
    startedAt: '2026-07-01T00:00:00.000Z', status: 'running', transcriptPath: '/r/t.log',
  })
  runs.fail('run:P:1', { endedAt: '2026-07-01T00:01:00.000Z' })
  const r = runs.get('run:P:1')
  expect(r?.status).toBe('failed')
  expect(r?.endedAt).toBe('2026-07-01T00:01:00.000Z')
  expect(r?.transcriptPath).toBe('/r/t.log')
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test agent-run-store 2>&1 | tail -15`
Expected: FAIL — `AgentKind.parse('harness')` throws (enum에 없음) / `runs.fail` is not a function.

- [ ] **Step 3: 구현**

`packages/shared/src/schema.ts:3`:
```ts
export const AgentKind = z.enum(['claude', 'codex', 'opencode', 'harness'])
```

`packages/pm/src/agent-run-store.ts` — `complete` 메서드 아래에 추가:
```ts
  /** Mark a run failed (non-zero exit, spawn error, timeout, or cancel). Mirrors complete(). */
  fail(id: string, patch: { endedAt: string }): void {
    this.db.prepare('UPDATE agent_runs SET status = ?, ended_at = ? WHERE id = ?')
      .run('failed', patch.endedAt, id)
  }
```

- [ ] **Step 4: green 확인 + 전체 typecheck**

Run: `pnpm test agent-run-store 2>&1 | tail -10 && pnpm typecheck 2>&1 | tail -10`
Expected: 테스트 PASS. typecheck PASS — `resume.ts`의 두 switch는 `default` 보유, `EngineTemplates`는 `Partial`라 'harness' 추가로 깨지지 않음. 깨지는 exhaustive 분기가 있으면 그 자리에서 `'harness'` 케이스(또는 no-op default) 추가.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schema.ts packages/pm/src/agent-run-store.ts packages/pm/src/agent-run-store.test.ts
git commit -m "feat(pm): AgentKind 'harness' + AgentRunStore.fail() for dev-harness runs"
```

---

### Task 3: HarnessCli — CLI_CONTRACT 어댑터 (주입식 spawner)

**Files:**
- Create: `packages/app-services/src/harness-cli.ts`
- Test: `packages/app-services/src/harness-cli.test.ts`
- Modify: `packages/app-services/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `type HarnessCliInput = { root: string; taskId: string; workflow?: string; graphProfile?: string; onChunk?: (stream: 'stdout'|'stderr', text: string) => void; timeoutMs?: number; signal?: AbortSignal }`
  - `type HarnessCliResult = { exitCode: number | null; stdout: string; stderr: string; error?: string }`
  - `type SpawnFn` (DI 경계), `class HarnessCli { constructor(spawnFn?: SpawnFn); run(input): Promise<HarnessCliResult> }`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// packages/app-services/src/harness-cli.test.ts
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { HarnessCli } from './harness-cli.js'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (s?: unknown) => boolean; killed?: unknown }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = (s?: unknown) => { child.killed = s ?? true; return true }
  return child
}

test('builds entry/argv/env from CLI contract', async () => {
  let captured: { cmd: string; args: string[]; opts: { cwd?: string; env?: NodeJS.ProcessEnv } } | undefined
  const child = fakeChild()
  const cli = new HarnessCli(((cmd, args, opts) => { captured = { cmd, args, opts }; return child }) as never)
  const p = cli.run({ root: '/proj', taskId: 'T2', workflow: 'wf', graphProfile: 'gp' })
  child.emit('close', 0); await p
  expect(captured!.cmd).toBe(join('/proj', 'agents_up.sh'))
  expect(captured!.args).toEqual(['T2', '--workflow', 'wf', '--graph-profile', 'gp'])
  expect(captured!.opts.env?.ROOT).toBe('/proj')
  expect(captured!.opts.cwd).toBe('/proj')
})

test('streams stdout/stderr and resolves exit code', async () => {
  const child = fakeChild()
  const cli = new HarnessCli((() => child) as never)
  const chunks: string[] = []
  const p = cli.run({ root: '/r', taskId: 'T', onChunk: (s, t) => chunks.push(`${s}:${t}`) })
  child.stdout.emit('data', Buffer.from('hi'))
  child.stderr.emit('data', Buffer.from('warn'))
  child.emit('close', 0)
  const res = await p
  expect(res).toMatchObject({ exitCode: 0, stdout: 'hi', stderr: 'warn' })
  expect(chunks).toEqual(['stdout:hi', 'stderr:warn'])
})

test('spawn error → exitCode null + error', async () => {
  const child = fakeChild()
  const cli = new HarnessCli((() => child) as never)
  const p = cli.run({ root: '/r', taskId: 'T' })
  child.emit('error', new Error('ENOENT agents_up.sh'))
  const res = await p
  expect(res.exitCode).toBeNull()
  expect(res.error).toContain('ENOENT')
})

test('abort signal kills child → cancelled', async () => {
  const child = fakeChild()
  const cli = new HarnessCli((() => child) as never)
  const ac = new AbortController()
  const p = cli.run({ root: '/r', taskId: 'T', signal: ac.signal })
  ac.abort()
  const res = await p
  expect(res.error).toBe('cancelled')
  expect(child.killed).toBe('SIGTERM')
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test harness-cli 2>&1 | tail -15`
Expected: FAIL — `Cannot find module './harness-cli.js'`.

- [ ] **Step 3: 구현**

```ts
// packages/app-services/src/harness-cli.ts
import { spawn as nodeSpawn } from 'node:child_process'
import { join } from 'node:path'

/** CLI_CONTRACT.md 입력: ROOT(env+cwd), task_id(argv[0]), --workflow/--graph-profile(옵션). */
export type HarnessCliInput = {
  root: string
  taskId: string
  workflow?: string
  graphProfile?: string
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void
  timeoutMs?: number
  signal?: AbortSignal
}
/** 종료코드 0=성공, 비0=실패. error는 spawn 실패/timeout/cancel 같은 비정상 종료 사유. */
export type HarnessCliResult = { exitCode: number | null; stdout: string; stderr: string; error?: string }

type ChildLike = {
  stdout: { on(ev: 'data', cb: (d: unknown) => void): void } | null
  stderr: { on(ev: 'data', cb: (d: unknown) => void): void } | null
  on(ev: 'error', cb: (e: Error) => void): void
  on(ev: 'close', cb: (code: number | null) => void): void
  kill(signal?: string): boolean
}
export type SpawnFn = (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean }) => ChildLike

const defaultSpawn: SpawnFn = (cmd, args, opts) => nodeSpawn(cmd, args, opts) as unknown as ChildLike

/** 하네스 CLI를 계약대로 1회 실행. 내부 구현(tmux 등)에 의존하지 않고 문서화된 seam만 소비. */
export class HarnessCli {
  constructor(private readonly spawnFn: SpawnFn = defaultSpawn) {}

  run(input: HarnessCliInput): Promise<HarnessCliResult> {
    const entry = join(input.root, 'agents_up.sh')
    const args = [
      input.taskId,
      ...(input.workflow ? ['--workflow', input.workflow] : []),
      ...(input.graphProfile ? ['--graph-profile', input.graphProfile] : []),
    ]
    return new Promise<HarnessCliResult>((resolve) => {
      // shell:true on Windows so a .sh shim / bash wrapper resolves; on linux/WSL spawn bash script directly.
      const child = this.spawnFn(entry, args, {
        cwd: input.root,
        env: { ...process.env, ROOT: input.root },
        shell: process.platform === 'win32',
      })
      let stdout = '', stderr = '', settled = false
      const finish = (r: HarnessCliResult) => { if (settled) return; settled = true; cleanup(); resolve(r) }
      const timer = input.timeoutMs
        ? setTimeout(() => { child.kill('SIGKILL'); finish({ exitCode: null, stdout, stderr, error: `timeout after ${input.timeoutMs}ms` }) }, input.timeoutMs)
        : undefined
      const onAbort = () => { child.kill('SIGTERM'); finish({ exitCode: null, stdout, stderr, error: 'cancelled' }) }
      const cleanup = () => { if (timer) clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort) }
      if (input.signal) {
        if (input.signal.aborted) { onAbort(); return }
        input.signal.addEventListener('abort', onAbort)
      }
      child.stdout?.on('data', (d) => { const t = String(d); stdout += t; input.onChunk?.('stdout', t) })
      child.stderr?.on('data', (d) => { const t = String(d); stderr += t; input.onChunk?.('stderr', t) })
      child.on('error', (e) => finish({ exitCode: null, stdout, stderr, error: String(e) }))
      child.on('close', (code) => finish({ exitCode: code, stdout, stderr }))
    })
  }
}
```

`packages/app-services/src/index.ts`에 export 추가:
```ts
export { HarnessCli, type HarnessCliInput, type HarnessCliResult, type SpawnFn } from './harness-cli.js'
```

- [ ] **Step 4: green 확인**

Run: `pnpm test harness-cli 2>&1 | tail -10`
Expected: 4개 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-services/src/harness-cli.ts packages/app-services/src/harness-cli.test.ts packages/app-services/src/index.ts
git commit -m "feat(app-services): HarnessCli — CLI_CONTRACT adapter with DI spawn (stream/exit/timeout/cancel)"
```

---

### Task 4: DevHarnessService — run 생명주기 + 로그 fan-out

**Files:**
- Create: `packages/app-services/src/dev-harness-service.ts`
- Test: `packages/app-services/src/dev-harness-service.test.ts`
- Modify: `packages/app-services/src/index.ts` (export)

**Interfaces:**
- Consumes: `HarnessCli` (Task 3), `AgentRunStore` (`create`/`complete`/`fail`, Task 2), `ProjectLookup`.
- Produces:
  - `type DevHarnessLogEvent = { runId: string; label: string; stream: 'stdout'|'stderr'; chunk: string }`
  - `type DevHarnessRunInput = { projectId: string; taskId: string; workflow?: string; graphProfile?: string }`
  - `type DevHarnessRunResult = { ok: boolean; runId?: string; exitCode?: number | null; reason?: string }`
  - `type ProjectLookup = { get(id: string): { repoPaths: string[] } | undefined }`
  - `class DevHarnessService { run(input, onLog?): Promise<DevHarnessRunResult>; cancel({runId}): { ok: boolean } }`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// packages/app-services/src/dev-harness-service.test.ts
import { test, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevHarnessService } from './dev-harness-service.js'
import type { HarnessCli } from './harness-cli.js'

function fakeRuns() {
  const rows = new Map<string, Record<string, unknown>>()
  const store = {
    create: (r: Record<string, unknown>) => { rows.set(r.id as string, { ...r }) },
    complete: (id: string, p: Record<string, unknown>) => { Object.assign(rows.get(id)!, { status: 'completed', ...p }) },
    fail: (id: string, p: Record<string, unknown>) => { Object.assign(rows.get(id)!, { status: 'failed', ...p }) },
  }
  return { store, rows }
}
const runsRoot = () => mkdtempSync(join(tmpdir(), 'devharness-'))
const okRegistry = { get: () => ({ repoPaths: ['/proj'] }) }

test('records running→completed on exit 0 and fans out logs', async () => {
  const { store, rows } = fakeRuns()
  const cli = { run: async (i: Parameters<HarnessCli['run']>[0]) => { i.onChunk?.('stdout', 'hi'); return { exitCode: 0, stdout: 'hi', stderr: '' } } }
  const logs: unknown[] = []
  const svc = new DevHarnessService({ cli: cli as unknown as HarnessCli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  const res = await svc.run({ projectId: 'P', taskId: 'req:P:s1' }, (e) => logs.push(e))
  expect(res.ok).toBe(true)
  const row = [...rows.values()][0]
  expect(row).toMatchObject({ status: 'completed', agent: 'harness', taskId: 'req:P:s1', repoPath: '/proj' })
  expect(row.transcriptPath).toContain('.agent-runs')
  expect(logs[0]).toMatchObject({ stream: 'stdout', chunk: 'hi', label: 'harness' })
})

test('records failed on non-zero exit', async () => {
  const { store, rows } = fakeRuns()
  const cli = { run: async () => ({ exitCode: 2, stdout: '', stderr: 'boom', error: undefined }) }
  const svc = new DevHarnessService({ cli: cli as unknown as HarnessCli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  const res = await svc.run({ projectId: 'P', taskId: 'T' })
  expect(res.ok).toBe(false)
  expect(res.exitCode).toBe(2)
  expect([...rows.values()][0].status).toBe('failed')
})

test('guards missing project (no run record)', async () => {
  const { store, rows } = fakeRuns()
  const cli = { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }
  const svc = new DevHarnessService({ cli: cli as unknown as HarnessCli, runs: store as never, registry: { get: () => undefined }, runsRoot: runsRoot() })
  const res = await svc.run({ projectId: 'X', taskId: 'T' })
  expect(res.ok).toBe(false)
  expect(rows.size).toBe(0)
})

test('cancel aborts an active run', async () => {
  const { store, rows } = fakeRuns()
  const cli = { run: (i: Parameters<HarnessCli['run']>[0]) => new Promise((res) => { i.signal?.addEventListener('abort', () => res({ exitCode: null, stdout: '', stderr: '', error: 'cancelled' })) }) }
  const svc = new DevHarnessService({ cli: cli as unknown as HarnessCli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  const p = svc.run({ projectId: 'P', taskId: 'T' })
  await new Promise((r) => setTimeout(r, 0))
  const runId = [...rows.keys()][0]
  expect(svc.cancel({ runId }).ok).toBe(true)
  const res = await p
  expect(res.ok).toBe(false)
  expect(res.reason).toBe('cancelled')
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test dev-harness-service 2>&1 | tail -15`
Expected: FAIL — `Cannot find module './dev-harness-service.js'`.

- [ ] **Step 3: 구현**

```ts
// packages/app-services/src/dev-harness-service.ts
import { join, dirname } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'
import type { AgentRunStore } from '@apc/pm'
import type { HarnessCli } from './harness-cli.js'

export type DevHarnessLogEvent = { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }
export type DevHarnessRunInput = { projectId: string; taskId: string; workflow?: string; graphProfile?: string }
export type DevHarnessRunResult = { ok: boolean; runId?: string; exitCode?: number | null; reason?: string }
/** Narrow view of ProjectRegistry — only repoPaths is needed, so the service stays DB-free in tests. */
export type ProjectLookup = { get(id: string): { repoPaths: string[] } | undefined }

export type DevHarnessServiceDeps = {
  cli: HarnessCli
  runs: AgentRunStore
  registry: ProjectLookup
  runsRoot: string
  now?: () => string
  timeoutMs?: number
}

/** Drives the multi-agent dev harness via the CLI_CONTRACT seam, records run lifecycle in
 *  AgentRunStore, and fans stdout/stderr to a transcript file + a live-tail callback. Independent
 *  of the wiki HarnessService. */
export class DevHarnessService {
  private readonly now: () => string
  private readonly active = new Map<string, AbortController>()
  constructor(private readonly deps: DevHarnessServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  async run(input: DevHarnessRunInput, onLog?: (e: DevHarnessLogEvent) => void): Promise<DevHarnessRunResult> {
    const root = this.deps.registry.get(input.projectId)?.repoPaths?.[0]
    if (!root) return { ok: false, reason: `project not found or has no repoPath: ${input.projectId}` }

    const startedAt = this.now()
    const runId = `run:${input.projectId}:${startedAt.replace(/[:.]/g, '-')}`
    const transcriptPath = join(this.deps.runsRoot, '.agent-runs', runId, 'transcript.log')
    try { mkdirSync(dirname(transcriptPath), { recursive: true }) } catch { /* best-effort */ }

    this.deps.runs.create({
      id: runId, taskId: input.taskId, agent: 'harness', repoPath: root,
      startedAt, status: 'running', transcriptPath,
    })

    const controller = new AbortController()
    this.active.set(runId, controller)
    const onChunk = (stream: 'stdout' | 'stderr', text: string) => {
      try { appendFileSync(transcriptPath, text) } catch { /* transcript is best-effort; never fail the run */ }
      onLog?.({ runId, label: 'harness', stream, chunk: text })
    }
    const result = await this.deps.cli.run({
      root, taskId: input.taskId, workflow: input.workflow, graphProfile: input.graphProfile,
      onChunk, timeoutMs: this.deps.timeoutMs, signal: controller.signal,
    })
    this.active.delete(runId)

    const endedAt = this.now()
    if (result.exitCode === 0) {
      this.deps.runs.complete(runId, { endedAt })
      return { ok: true, runId, exitCode: 0 }
    }
    this.deps.runs.fail(runId, { endedAt })
    return { ok: false, runId, exitCode: result.exitCode, reason: result.error ?? `exit code ${result.exitCode}` }
  }

  /** Abort an in-flight run (SIGTERM via the CLI's signal). No-op (ok:false) if the run already ended. */
  cancel(input: { runId: string }): { ok: boolean } {
    const controller = this.active.get(input.runId)
    if (!controller) return { ok: false }
    controller.abort()
    return { ok: true }
  }
}
```

`packages/app-services/src/index.ts`에 export 추가:
```ts
export { DevHarnessService, type DevHarnessRunInput, type DevHarnessRunResult, type DevHarnessLogEvent, type DevHarnessServiceDeps, type ProjectLookup } from './dev-harness-service.js'
```

- [ ] **Step 4: green 확인 + typecheck**

Run: `pnpm test dev-harness-service 2>&1 | tail -10 && pnpm typecheck 2>&1 | tail -5`
Expected: 4개 PASS, typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-services/src/dev-harness-service.ts packages/app-services/src/dev-harness-service.test.ts packages/app-services/src/index.ts
git commit -m "feat(app-services): DevHarnessService — run lifecycle + transcript + log fan-out + cancel"
```

---

### Task 5: IPC 계약 + 핸들러 + 컨테이너 배선

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (CH 채널 + 타입)
- Modify: `apps/desktop/src/main/container.ts` (DevHarnessService 배선 + 메서드 + emit opt)
- Modify: `apps/desktop/src/main/ipc.ts` (handlers 엔트리)
- Modify: `apps/desktop/src/main/index.ts` (emitDevHarnessLog → webContents.send)
- Test: `apps/desktop/src/main/ipc.test.ts` (devHarnessRun 가드 경로)

**Interfaces:**
- Consumes: `DevHarnessService` (Task 4), 기존 `container.registry`/`runs`/`harnessRunsRoot`.
- Produces: IPC 채널 `CH.devHarnessRun`/`CH.devHarnessCancel`/`CH.devHarnessLog`; container 메서드 `devHarnessRun(req)`/`devHarnessCancel(req)`; req/res 타입.

- [ ] **Step 1: 실패 테스트 작성** — `ipc.test.ts`에 추가 (repoPaths 없는 프로젝트 → ok:false; 실제 spawn 없이 핸들러→서비스→registry 배선만 검증)

```ts
test('devHarnessRun returns ok:false for a project without repoPaths', async () => {
  const h = handlers(container)
  // 테스트 컨테이너에 repoPaths 없는 프로젝트 등록
  await h[CH.registerProject]({ id: 'np', name: 'NoRepo', status: 'active', repoPaths: [], vaultPaths: [], sourcePaths: [] })
  const res = await h[CH.devHarnessRun]({ projectId: 'np', taskId: 'T' })
  expect(res).toMatchObject({ ok: false })
})
```
(필요 시 기존 테스트의 `registerProject` 페이로드 형태를 참고해 필드 정렬.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm test ipc 2>&1 | tail -15`
Expected: FAIL — `CH.devHarnessRun` undefined / handler 없음.

- [ ] **Step 3: 구현**

`ipc-contract.ts` — CH 객체에 채널 추가(기존 harness 항목 근처):
```ts
  devHarnessRun: 'c:devHarnessRun',
  devHarnessCancel: 'c:devHarnessCancel',
  devHarnessLog: 'devHarness:log',
```
같은 파일에 타입 추가:
```ts
export type DevHarnessRunReq = { projectId: string; taskId: string; workflow?: string; graphProfile?: string }
export type DevHarnessRunRes = { ok: boolean; runId?: string; exitCode?: number | null; reason?: string }
export type DevHarnessCancelReq = { runId: string }
export type DevHarnessCancelRes = { ok: boolean }
export type DevHarnessLogEvent = { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }
```

`container.ts`:
- import: `import { ..., DevHarnessService } from '@apc/app-services'` 및 타입 `DevHarnessRunReq, DevHarnessRunRes, DevHarnessCancelReq, DevHarnessCancelRes, DevHarnessLogEvent` from ipc-contract.
- `Container` 인터페이스에 추가:
```ts
  devHarnessRun: (req: DevHarnessRunReq) => Promise<DevHarnessRunRes>
  devHarnessCancel: (req: DevHarnessCancelReq) => DevHarnessCancelRes
```
- opts에 추가: `emitDevHarnessLog?: (e: DevHarnessLogEvent) => void`
- 서비스 생성(harness 생성부 근처, `runs`·`registry` 이용. runsRoot는 기존 harnessRunsRoot 재사용 또는 동일 기본):
```ts
  const devHarness = new DevHarnessService({
    cli: new HarnessCli(),
    runs,
    registry,
    runsRoot: opts.harnessRunsRoot ?? join(opts.vaultRoot, '.harness-runs'),
  })
```
(`HarnessCli` import from `@apc/app-services`.)
- 반환 객체에 메서드:
```ts
  devHarnessRun: (req) => devHarness.run(req, opts.emitDevHarnessLog ? (e) => opts.emitDevHarnessLog!(e) : undefined),
  devHarnessCancel: (req) => devHarness.cancel(req),
```

`ipc.ts` — handlers Record에 추가:
```ts
    [CH.devHarnessRun]: async (payload: unknown) => container.devHarnessRun(payload as DevHarnessRunReq),
    [CH.devHarnessCancel]: async (payload: unknown) => container.devHarnessCancel(payload as DevHarnessCancelReq),
```
(상단 import에 `DevHarnessRunReq, DevHarnessCancelReq` 추가.)

`index.ts` — createContainer/buildContainer opts에 emit 배선(기존 emitHarnessEngineLog 옆):
```ts
    emitDevHarnessLog: (e) => win.webContents.send(CH.devHarnessLog, e),
```

- [ ] **Step 4: green 확인 + typecheck**

Run: `pnpm test ipc 2>&1 | tail -10 && pnpm typecheck 2>&1 | tail -10`
Expected: 새 IPC 테스트 PASS, typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/index.ts apps/desktop/src/main/ipc.test.ts
git commit -m "feat(desktop): devHarness IPC — run/cancel handlers + log push wiring"
```

---

### Task 6: preload bridge + 최소 renderer UI

**Files:**
- Modify: `apps/desktop/src/preload/index.ts` (devHarnessRun/Cancel invoke + onDevHarnessLog subscribe)
- Modify: renderer — task 액션이 있는 컴포넌트(예: 작업 리스트/상세, SP1/SP2가 만든 task 뷰)에 ▶ Run harness 버튼 + live 로그 패널. 정확한 파일은 실행 시 `grep -rn "tasksList\|TaskList\|KnowledgeView" apps/desktop/src/renderer`로 확인.

**Interfaces:**
- Consumes: preload가 노출하는 `window.api.devHarnessRun`/`devHarnessCancel`/`onDevHarnessLog`.
- Produces: 사용자가 task에서 하네스 run을 시작/중지하고 로그를 보는 UI.

- [ ] **Step 1: preload 확장** — 기존 harness invoke/subscribe 패턴을 그대로 따른다.

```ts
// preload/index.ts — 기존 bridge 객체에 추가
devHarnessRun: (req: DevHarnessRunReq): Promise<DevHarnessRunRes> => ipcRenderer.invoke(CH.devHarnessRun, req),
devHarnessCancel: (req: DevHarnessCancelReq): Promise<DevHarnessCancelRes> => ipcRenderer.invoke(CH.devHarnessCancel, req),
onDevHarnessLog: (cb: (e: DevHarnessLogEvent) => void) => {
  const h = (_: unknown, e: DevHarnessLogEvent) => cb(e)
  ipcRenderer.on(CH.devHarnessLog, h)
  return () => ipcRenderer.removeListener(CH.devHarnessLog, h)
},
```
(preload의 채널 노출/타입 규약은 기존 `harness*` 항목과 동일하게 맞춘다. window api 타입 선언 파일이 있으면 시그니처 추가.)

- [ ] **Step 2: renderer — ▶ Run harness 액션 + 로그 패널**

task 행/상세에 버튼을 추가: 클릭 시 `window.api.devHarnessRun({ projectId, taskId })`. 마운트 시 `onDevHarnessLog`로 해당 runId의 chunk를 모아 `<pre>` 로그 뷰에 append. 실행 중에는 ⏹ Cancel 버튼(→ `devHarnessCancel({ runId })`). 기존 위키 하네스 로그 tail 컴포넌트가 있으면 재사용, 없으면 단순 스크롤 `<pre>`.

- [ ] **Step 3: typecheck + 빌드(렌더러 컴파일 확인)**

Run: `pnpm typecheck 2>&1 | tail -10`
Expected: PASS. (렌더러 단위 테스트는 범위 밖 — 배선은 typecheck로, 동작은 수동 스모크로 확인.)

- [ ] **Step 4: 수동 스모크(가능 시)**

repoPaths가 있는 프로젝트에서 ▶ Run harness → 로그 tail이 흐르고 종료 시 `agent_runs`에 레코드. (실제 `agents_up.sh`가 없는 프로젝트면 즉시 failed로 끝나며 그 경로 자체가 배선 검증.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer
git commit -m "feat(desktop): renderer ▶ Run harness action + live log panel (devHarness)"
```

---

### Task 7: SP1 후속 정리 (폴리시)

**Files:**
- Modify: `IngestService` onSessionParsed catch 사이트(실행 시 `grep -rn "onSessionParsed" packages/*/src`로 확인 — `packages/agents` 또는 `packages/app-services`/`core` 내 IngestService) — 무로그 catch에 경고 1줄.
- Modify: SP1 task 추출의 slug 생성(실행 시 `grep -rn "slug\|reconcileSessionTasks\|extractTasks" packages/app-services/src`) — slug 충돌 시 near-dup todo 드롭.

**Interfaces:**
- Consumes/Produces: 기존 SP1 동작 보존 + 진단 가능성↑.

- [ ] **Step 1: onSessionParsed catch 로깅**

해당 catch(현재 무로그)에서:
```ts
} catch (e) { console.warn(`[ingest] onSessionParsed failed for ${projectId}:`, e) }
```
(catch가 IngestService 내부에 있으면 거기에, container의 onSessionParsed 콜백이면 콜백 내부 try/catch로 감싸 동일 로그.)

- [ ] **Step 2: slug near-dup 드롭** — `extractTasks`/`reconcileSessionTasks`에서 동일 slug todo가 이미 있으면 중복 생성하지 않도록 가드(이미 멱등 INSERT OR REPLACE면 near-dup만 추가 가드). 변경 후 기존 SP1 테스트가 green인지 확인.

Run: `pnpm test session-task 2>&1 | tail -10` (또는 SP1 테스트 파일명)
Expected: 기존 테스트 green 유지.

- [ ] **Step 3: 전체 검증**

Run: `pnpm test 2>&1 | tail -15 && pnpm typecheck 2>&1 | tail -5`
Expected: 전체 green, typecheck PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: SP1 follow-ups — log onSessionParsed failures + drop near-dup todos"
```

---

## 최종 검증 (전 task 완료 후)

- [ ] `pnpm test` (루트) — packages + apps/desktop 전체 green.
- [ ] `pnpm typecheck` — PASS.
- [ ] 수용 기준(spec §7) 1–6 충족 확인.
- [ ] opus 통합 코드리뷰(`/code-review` high/max) 실행.

---

## Self-Review (작성자 점검)

**Spec 커버리지:** spec §2 In 1–8 → Task 4(1·3·4·5), Task 3(2), Task 2(6), Task 5(7-IPC), Task 6(7-UI), Task 1(8). cancel(In 5)=Task 3/4. ✅ 전 항목 매핑됨.
**Placeholder:** Task 6/7의 "정확한 파일은 실행 시 grep"은 렌더러/ingest 구조가 SP1/SP2 산출물에 의존해 사전 고정이 불안전한 부분 — grep 명령을 명시해 실행자가 결정. 코드 블록은 모두 실제 내용 포함.
**타입 일관성:** `HarnessCliInput/Result`, `DevHarnessLogEvent`(app-services)와 ipc-contract의 `DevHarnessLogEvent`는 동일 shape(runId/label/stream/chunk). `AgentRun` create 필드(id/taskId/agent/repoPath/startedAt/status/transcriptPath)는 AgentRunSchema 옵셔널 규약과 일치. `agent:'harness'`는 Task 2의 enum 확장에 의존(순서 보장).
