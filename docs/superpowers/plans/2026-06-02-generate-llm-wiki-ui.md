# Generate / LLM Wiki UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a desktop **Generate** action: pick an engine → summarize the project's latest agent session → write a work summary + `current.proposal.md` to the vault → review → Promote to canonical `current.md`.

**Architecture:** Make `CliAgentRunner` stdin-based + Windows-safe. Add `@apc/app-services` `GenerateService` (latest-session → `WikiEngine` → `VaultWriter`). Wire a `generateProject` IPC + a Generate button + `ModelPicker` modal + result panel in the renderer; Promote reuses `CurrentPromotionService`/`promoteCurrent`.

**Tech Stack:** TypeScript (ESM), Vitest, `node:child_process`, React, Node 24.

> Spec: `docs/superpowers/specs/2026-06-02-generate-llm-wiki-ui-design.md`. Builds on existing `@apc/llm-wiki`, `@apc/agents`, `@apc/pm`, `@apc/app-services`, and the `ModelPicker` renderer component.

---

### Task 1: `CliAgentRunner` — stdin prompt + Windows-safe spawn

**Files:** Modify `packages/llm-wiki/src/cli-agent-runner.ts`; rewrite `packages/llm-wiki/src/cli-agent-runner.test.ts`.

**Why:** argv `{{PROMPT}}` breaks on Windows `.cmd` shims and with large prompts. Pass the prompt via stdin; spawn with `shell` on win32.

- [ ] **Step 1: Rewrite the test (real subprocess reads stdin)**

```ts
import { describe, expect, test } from 'vitest'
import { CliAgentRunner, type EngineTemplates } from './cli-agent-runner.js'

// Fake "agent": read stdin, echo it back as JSON.
const ECHO = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({echo:d})))'

describe('CliAgentRunner (stdin)', () => {
  test('writes the prompt to stdin and returns stdout', async () => {
    const templates: EngineTemplates = { claude: { command: process.execPath, args: ['-e', ECHO] } }
    const res = await new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'hello world', timeoutMs: 10000 })
    expect(res.ok).toBe(true)
    expect(JSON.parse(res.output).echo).toBe('hello world')
  })

  test('times out and returns ok:false when the process hangs', async () => {
    const templates: EngineTemplates = { claude: { command: process.execPath, args: ['-e', 'setTimeout(()=>{},60000)'] } }
    const res = await new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'x', timeoutMs: 300 })
    expect(res.ok).toBe(false)
  })

  test('throws for an engine with no configured template', async () => {
    await expect(new CliAgentRunner({}).run({ agent: 'opencode', prompt: 'x', timeoutMs: 100 })).rejects.toThrow(/no command template/i)
  })
})
```

- [ ] **Step 2: Run → FAIL** (`pnpm test -- packages/llm-wiki/src/cli-agent-runner.test.ts`).

- [ ] **Step 3: Implement**

```ts
import { spawn } from 'node:child_process'
import type { AgentType } from '@apc/shared'
import type { AgentRunner, RunInput, RunResult } from './agent-runner.js'

export type CommandTemplate = { command: string; args: string[] }
export type EngineTemplates = Partial<Record<AgentType, CommandTemplate>>

// Prompt is sent on stdin (not argv), so no quoting/length limits. Flags are version-dependent.
export const DEFAULT_TEMPLATES: EngineTemplates = {
  claude: { command: 'claude', args: ['-p', '--output-format', 'json'] },
  codex: { command: 'codex', args: ['exec'] },
  opencode: { command: 'opencode', args: ['run'] },
}

export class CliAgentRunner implements AgentRunner {
  constructor(private readonly templates: EngineTemplates = DEFAULT_TEMPLATES) {}

  run(input: RunInput): Promise<RunResult> {
    const tpl = this.templates[input.agent]
    if (!tpl) return Promise.reject(new Error(`No command template for engine: ${input.agent}`))

    return new Promise<RunResult>((resolve) => {
      // shell:true on Windows so .cmd/PATHEXT shims (claude.cmd, etc.) resolve.
      const child = spawn(tpl.command, tpl.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, output: '', raw: stderr || 'timeout' }) }, input.timeoutMs)
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: '', raw: String(e) }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: stdout, raw: stdout || stderr }) })
      try { child.stdin?.write(input.prompt); child.stdin?.end() } catch { /* child gone */ }
    })
  }
}
```

- [ ] **Step 4: Run → PASS (3). Commit** — `fix(llm-wiki): CliAgentRunner sends prompt via stdin + shell-safe spawn on Windows`

---

### Task 2: `@apc/app-services` `GenerateService`

**Files:** Create `packages/app-services/src/generate-service.ts`; modify `src/index.ts`; test `src/generate-service.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { VaultAdapter } from '@apc/vault'
import { VaultWriter } from '@apc/pm'
import { WikiEngine, FakeAgentRunner } from '@apc/llm-wiki'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'
import { GenerateService } from './generate-service.js'

function fakeAdapter(session: NormalizedSession): AgentIngestAdapter {
  return {
    agentKind: 'claude',
    async discoverSources(_c: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
      return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/s1.jsonl', mtimeMs: 100 }]
    },
    async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
      return { session, position: '{}' }
    },
  }
}

describe('GenerateService', () => {
  let db: Db; let dir: string
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db)
    dir = mkdtempSync(join(tmpdir(), 'apc-gen-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('summarizes the latest matching session and writes summary + proposal', async () => {
    const registry = new ProjectRegistry(db)
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', turns: [{ role: 'user', text: 'did work', toolCalls: [] }], filesTouched: [] }
    const wiki = new WikiEngine(new FakeAgentRunner([JSON.stringify({
      workSummary: 'summary', filesTouched: ['a.ts'], openProblems: [], nextTasks: [{ title: 'next', rationale: 'r' }],
      currentProposalMarkdown: '## Current\n- updated\n',
    })]))
    const svc = new GenerateService({
      adapters: [fakeAdapter(session)], registry, vault: new VaultAdapter(dir),
      vaultWriter: new VaultWriter(new VaultAdapter(dir)), wiki, now: () => '2026-06-02T00:00:00Z',
    })
    const res = await svc.generateForProject({ projectId: 'p1', engine: 'codex' })
    expect(res.ok).toBe(true)
    expect(res.generation?.workSummary).toBe('summary')
    expect(res.summaryPath).toContain('projects/p1/agent-runs/')
    expect(res.proposalPath).toBe('projects/p1/current.proposal.md')
  })

  test('ok:false with a reason when no session matches the project repoPath', async () => {
    const registry = new ProjectRegistry(db)
    registry.register({ id: 'p2', name: 'P2', status: 'active', projectType: 'git', repoPaths: ['/other'], vaultPaths: [], sourcePaths: [] })
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', turns: [], filesTouched: [] }
    const wiki = new WikiEngine(new FakeAgentRunner([]))
    const svc = new GenerateService({ adapters: [fakeAdapter(session)], registry, vault: new VaultAdapter(dir), vaultWriter: new VaultWriter(new VaultAdapter(dir)), wiki })
    const res = await svc.generateForProject({ projectId: 'p2', engine: 'claude' })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/no.*session/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { AgentIngestAdapter } from '@apc/agents'
import type { ProjectRegistry } from '@apc/core'
import type { VaultAdapter } from '@apc/vault'
import type { VaultWriter } from '@apc/pm'
import type { WikiEngine } from '@apc/llm-wiki'
import type { AgentType, NormalizedSession, WikiGeneration } from '@apc/shared'

export type GenerateResult = {
  ok: boolean
  reason?: string
  sessionId?: string
  summaryPath?: string
  proposalPath?: string
  generation?: WikiGeneration
}

export type GenerateDeps = {
  adapters: AgentIngestAdapter[]
  registry: ProjectRegistry
  vault: VaultAdapter
  vaultWriter: VaultWriter
  wiki: WikiEngine
  now?: () => string
}

export class GenerateService {
  constructor(private readonly deps: GenerateDeps) {}

  async generateForProject(input: { projectId: string; engine: AgentType }): Promise<GenerateResult> {
    const project = this.deps.registry.get(input.projectId)
    if (!project) return { ok: false, reason: 'project not found' }
    const repoPath = project.repoPaths[0]
    if (!repoPath) return { ok: false, reason: 'project has no repo path' }

    // Gather sources from all adapters, most-recent-first; parse until one matches repoPath.
    const pairs: { adapter: AgentIngestAdapter; mtime: number; parse: () => Promise<NormalizedSession> }[] = []
    for (const adapter of this.deps.adapters) {
      const sources = await adapter.discoverSources(() => undefined)
      for (const source of sources) {
        pairs.push({ adapter, mtime: source.mtimeMs ?? 0, parse: async () => (await adapter.parseSource(source)).session })
      }
    }
    pairs.sort((a, b) => b.mtime - a.mtime)

    let session: NormalizedSession | undefined
    for (const p of pairs.slice(0, 25)) {
      const s = await p.parse()
      if (s.repoPath === repoPath) { session = s; break }
    }
    if (!session) return { ok: false, reason: 'no local session found for this project' }

    let currentCanonical = ''
    try { currentCanonical = this.deps.vault.readDoc(`projects/${input.projectId}/current.md`).body } catch { /* none yet */ }

    const generation = await this.deps.wiki.generate(session, { engine: input.engine, currentCanonical })
    const stamp = (this.deps.now ?? (() => new Date().toISOString()))().replace(/[:.]/g, '-')
    const summaryPath = this.deps.vaultWriter.writeRunSummary(input.projectId, {
      runId: `gen-${stamp}`, taskId: session.id, agent: session.agentType,
      summary: generation.workSummary, filesTouched: generation.filesTouched, openProblems: generation.openProblems,
    })
    let proposalPath: string | undefined
    if (generation.currentProposalMarkdown.trim()) {
      proposalPath = this.deps.vaultWriter.writeCurrentProposal(input.projectId, generation.currentProposalMarkdown)
    }
    return { ok: true, sessionId: session.id, summaryPath, proposalPath, generation }
  }
}
```

- [ ] **Step 4: Export from `packages/app-services/src/index.ts`** (`export * from './generate-service.js'`).
- [ ] **Step 5: Run → PASS (2). Commit** — `feat(app-services): GenerateService (latest session → WikiEngine → vault)`

---

### Task 3: container injectable runner + `generateProject` IPC

**Files:** Modify `apps/desktop/src/main/container.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/shared/ipc-contract.ts`; extend `apps/desktop/src/main/ipc.test.ts`.

- [ ] **Step 1: Make the AgentRunner injectable + add GenerateService to the container**

In `container.ts`: `buildContainer` opts gains `agentRunner?: AgentRunner` (default `new CliAgentRunner()`); build `wiki = new WikiEngine(agentRunner)`; add `generate: new GenerateService({ adapters: ingestAdapters, registry, vault, vaultWriter, wiki })` and expose `generate` on `Container`. (Reuse the existing `vaultWriter`/`wiki`.)

- [ ] **Step 2: Contract** — in `ipc-contract.ts` add `generateProject: 'c:generateProject'` and:

```ts
export type GenerateProjectReq = { projectId: string; engine: AgentType }
```

- [ ] **Step 3: Failing test (extends ipc.test.ts)**

```ts
test('c:generateProject summarizes the latest session into a proposal', async () => {
  const session = { id: 's1', agentType: 'claude' as const, repoPath: '/work/apc', turns: [{ role: 'user' as const, text: 'go', toolCalls: [] }], filesTouched: [] }
  const fakeAdapter = {
    agentKind: 'claude' as const,
    async discoverSources() { return [{ id: 'claude:s1', agentKind: 'claude' as const, kind: 'jsonl-file' as const, locator: '/x.jsonl', mtimeMs: 1 }] },
    async parseSource() { return { session, position: '{}' } },
  }
  const runner = { async run() { return { ok: true, output: JSON.stringify({ workSummary: 'did it', filesTouched: [], openProblems: [], nextTasks: [], currentProposalMarkdown: '## Current\n- x\n' }), raw: '' } } }
  const c = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [fakeAdapter], agentRunner: runner })
  c.registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
  const res = (await handlers(c)[CH.generateProject]({ projectId: 'p1', engine: 'claude' })) as { ok: boolean; proposalPath?: string }
  expect(res.ok).toBe(true)
  expect(res.proposalPath).toBe('projects/p1/current.proposal.md')
})
```

- [ ] **Step 4: Implement the handler** in `ipc.ts`:

```ts
[CH.generateProject]: async (payload: unknown) => {
  const req = payload as GenerateProjectReq
  return container.generate.generateForProject(req)
},
```

- [ ] **Step 5: Run → PASS. Commit** — `feat(desktop): generateProject IPC + injectable AgentRunner in container`

---

### Task 4: renderer api + store

**Files:** Modify `apps/desktop/src/renderer/api.ts`, `apps/desktop/src/renderer/store.ts`.

- [ ] **Step 1:** `api.ts` — add:

```ts
generateProject(req: { projectId: string; engine: AgentType }): Promise<GenerateProjectRes> {
  return window.apc.invoke(CH.generateProject, req) as Promise<GenerateProjectRes>
}
```
(Import `AgentType` from `@apc/shared`; define/import `GenerateProjectRes` from the contract — add the result type to `ipc-contract.ts`.)

- [ ] **Step 2:** `store.ts` — add state `generating: boolean`, `generation: GenerateProjectRes | null`, and an action `generate(engine)` that calls `api.generateProject({ projectId: selectedProjectId, engine })`, stores the result, and surfaces `error` on `ok:false`/throw. Keep it consistent with the existing `ingest()` action's try/finally + error handling.

- [ ] **Step 3: Commit** — `feat(desktop): generate api + store action`

---

### Task 5: Generate button + ModelPicker + result panel

**Files:** Modify `apps/desktop/src/renderer/App.tsx` (reuse `components/ModelPicker.tsx`).

- [ ] **Step 1:** Add a **Generate** button to the PM Home toolbar (enabled when `selectedProjectId`). Clicking opens a **ModelPicker** modal (reuse the component; `defaultEngine='claude'`). On `onPick(engine)`: close picker, call `store.generate(engine)`, show a running state.

- [ ] **Step 2:** Add a **result modal** (mirror the Update modal styling) showing, from `store.generation`:
  - `generation.workSummary`, `filesTouched`, `openProblems`, `nextTasks` (titles),
  - a preview of `generation.currentProposalMarkdown`,
  - **Promote current** button → `api.promoteCurrent({ projectId, lastReadHash: '' })`; on `{status:'conflict'}` show the conflict doc path; on `{status:'promoted'}` show success,
  - **Close**.
  - When `store.generation?.ok === false`, show `reason` (e.g. "no local session found").

- [ ] **Step 3: Verify** — `pnpm --filter @apc/desktop exec vitest run` (15+ green) and `electron-vite build` succeeds. Run full `pnpm test`.

- [ ] **Step 4: Commit** — `feat(desktop): Generate button + model picker + result/promote panel`

---

## Definition of Done

- [ ] `pnpm test` green (incl. new `GenerateService` + stdin `CliAgentRunner` tests); desktop suite + `electron-vite build` green.
- [ ] Generate → pick engine → writes `current.proposal.md` + `gen-*-summary.md`; result panel shows summary/files/problems/next-tasks/proposal.
- [ ] Promote writes canonical `current.md` (conflict-gated).
- [ ] No-session case shows a clear message; engine failure surfaces as a readable error.
- [ ] `CliAgentRunner` uses stdin + shell-safe spawn (Windows `.cmd` ok).

## Deferred (P1+)

- Task/AgentRun-tied generation (next-task creation via `ReviewService`), remote (ssh) session sourcing, multi-session synthesis, per-project default engine, runtime detection of CLI headless flags.
