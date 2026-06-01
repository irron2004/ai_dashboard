# Agent Project Console — LLM Wiki Engine Implementation Plan (Plan 3 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generate a structured work summary, a `current.md` update proposal, and next-task candidates from a `NormalizedSession`, by calling an installed agent CLI **headless** with a user-selected engine — behind an `AgentRunner` abstraction so the engine and exact CLI command are injectable (and the hard logic — prompt building, JSON extraction, timeout — is fully testable without any agent installed).

**Architecture:** `@apc/llm-wiki` defines `AgentRunner` (run a prompt on one engine, get text back). `CliAgentRunner` spawns a configurable command template per engine; `FakeAgentRunner` returns canned output for tests. Pure prompt builders produce the prompt; `parseStructured()` robustly extracts+validates JSON from CLI stdout; `WikiEngine` orchestrates runner + prompt + parse into validated `@apc/shared` objects. The engine is chosen at call time (the spec's model picker).

**Tech Stack:** TypeScript (ESM), Vitest, Zod, `node:child_process`, Node 24.

> Builds on Plans 1–2. Spec: §9 (LLM Wiki engine, multi-engine, headless `claude -p ... --output-format json`, on-demand, user-selected), §9 산출물/권한 (summary/proposal/next-task auto; canonical apply needs approval).

> **Design note (CLI flags):** exact non-interactive flags differ per agent and per version. This plan does **not** hardcode them in asserted tests; `CliAgentRunner` takes a per-engine command template (default templates provided, validated at runtime by a detect/smoke step in Plan 6). The deterministic tests drive a real subprocess via `node -e`, so spawn/timeout/parse logic is verified for real without needing Claude/Codex/OpenCode installed.

---

## File Structure

```
packages/shared/src/
  wiki-schema.ts          # WikiGeneration (LLM output), WorkSummary, CurrentProposal, NextTaskCandidate
  wiki-schema.test.ts
packages/llm-wiki/
  package.json
  src/index.ts
  src/agent-runner.ts     # AgentRunner interface + FakeAgentRunner
  src/agent-runner.test.ts
  src/cli-agent-runner.ts # spawns a command template per engine
  src/cli-agent-runner.test.ts
  src/parse-structured.ts # robust JSON extraction + Zod validation
  src/parse-structured.test.ts
  src/prompts.ts          # pure prompt builders
  src/prompts.test.ts
  src/wiki-engine.ts      # orchestrates runner + prompt + parse
  src/wiki-engine.test.ts
```

Add `@apc/llm-wiki` alias to `vitest.config.ts`.

---

### Task 1: Wiki contracts in `@apc/shared`

**Files:** Create `packages/shared/src/wiki-schema.ts`; modify `index.ts`; test `wiki-schema.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'vitest'
import { WikiGenerationSchema, NextTaskCandidateSchema } from './wiki-schema.js'

describe('WikiGenerationSchema', () => {
  test('parses a full generation payload', () => {
    const g = WikiGenerationSchema.parse({
      workSummary: 'Implemented the ingest adapters.',
      filesTouched: ['packages/agents/src/claude-adapter.ts'],
      openProblems: ['OpenCode tool-call parsing not done'],
      nextTasks: [{ title: 'Parse OpenCode tool calls', rationale: 'tool calls are dropped today' }],
      currentProposalMarkdown: '## Current\n- adapters done\n',
    })
    expect(g.nextTasks[0].title).toContain('OpenCode')
  })
  test('applies array defaults', () => {
    const g = WikiGenerationSchema.parse({ workSummary: 'x' })
    expect(g.filesTouched).toEqual([])
    expect(g.nextTasks).toEqual([])
  })
  test('NextTaskCandidate requires a title', () => {
    expect(() => NextTaskCandidateSchema.parse({ rationale: 'x' })).toThrow()
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod'

export const NextTaskCandidateSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().default(''),
})
export type NextTaskCandidate = z.infer<typeof NextTaskCandidateSchema>

/** The JSON we ask the agent CLI to emit. */
export const WikiGenerationSchema = z.object({
  workSummary: z.string().min(1),
  filesTouched: z.array(z.string()).default([]),
  openProblems: z.array(z.string()).default([]),
  nextTasks: z.array(NextTaskCandidateSchema).default([]),
  currentProposalMarkdown: z.string().default(''),
})
export type WikiGeneration = z.infer<typeof WikiGenerationSchema>

export const CurrentProposalSchema = z.object({
  projectId: z.string().min(1),
  proposedMarkdown: z.string(),
  basedOnSessionIds: z.array(z.string()).default([]),
})
export type CurrentProposal = z.infer<typeof CurrentProposalSchema>
```

- [ ] **Step 4: Export + run → PASS (3).**
- [ ] **Step 5: Commit** — `feat(shared): add LLM Wiki generation contracts`

---

### Task 2: `AgentRunner` interface + `FakeAgentRunner`

**Files:** Create `packages/llm-wiki/package.json`, `src/index.ts`, `src/agent-runner.ts`; test `agent-runner.test.ts`; add vitest alias.

`packages/llm-wiki/package.json`:
```json
{
  "name": "@apc/llm-wiki",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*" }
}
```

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'vitest'
import { FakeAgentRunner } from './agent-runner.js'

describe('FakeAgentRunner', () => {
  test('returns queued outputs in order and records calls', async () => {
    const r = new FakeAgentRunner(['first', 'second'])
    expect((await r.run({ agent: 'claude', prompt: 'p1', timeoutMs: 1000 })).output).toBe('first')
    expect((await r.run({ agent: 'codex', prompt: 'p2', timeoutMs: 1000 })).output).toBe('second')
    expect(r.calls.map((c) => c.agent)).toEqual(['claude', 'codex'])
  })
  test('ok=false when the queue is exhausted', async () => {
    const r = new FakeAgentRunner([])
    expect((await r.run({ agent: 'claude', prompt: 'p', timeoutMs: 1 })).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { AgentType } from '@apc/shared'

export type RunInput = { agent: AgentType; prompt: string; timeoutMs: number }
export type RunResult = { ok: boolean; output: string; raw: string }

export interface AgentRunner {
  run(input: RunInput): Promise<RunResult>
}

export class FakeAgentRunner implements AgentRunner {
  readonly calls: RunInput[] = []
  constructor(private readonly outputs: string[]) {}
  async run(input: RunInput): Promise<RunResult> {
    this.calls.push(input)
    if (this.calls.length > this.outputs.length) return { ok: false, output: '', raw: '' }
    const output = this.outputs[this.calls.length - 1]
    return { ok: true, output, raw: output }
  }
}
```

`packages/llm-wiki/src/index.ts`:
```ts
export * from './agent-runner.js'
export * from './cli-agent-runner.js'
export * from './parse-structured.js'
export * from './prompts.js'
export * from './wiki-engine.js'
```
(Export only `./agent-runner.js` for now; add the rest in their tasks.)

- [ ] **Step 4: Run → PASS (2).**
- [ ] **Step 5: Commit** — `feat(llm-wiki): AgentRunner interface + FakeAgentRunner`

---

### Task 3: `parseStructured` — robust JSON extraction + validation

**Files:** Create `src/parse-structured.ts`; test `parse-structured.test.ts`.

**Behavior:** CLI stdout may wrap JSON in ```json fences or prose. Extract the first balanced `{…}` (or fenced block), `JSON.parse`, then validate with a Zod schema. Throw a clear error on failure.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { parseStructured } from './parse-structured.js'

const S = z.object({ a: z.number(), b: z.string() })

describe('parseStructured', () => {
  test('parses bare JSON', () => {
    expect(parseStructured('{"a":1,"b":"x"}', S)).toEqual({ a: 1, b: 'x' })
  })
  test('parses JSON inside a ```json fence with surrounding prose', () => {
    const raw = 'Here is the result:\n```json\n{"a":2,"b":"y"}\n```\nDone.'
    expect(parseStructured(raw, S)).toEqual({ a: 2, b: 'y' })
  })
  test('parses JSON embedded in prose without fences', () => {
    expect(parseStructured('blah {"a":3,"b":"z"} trailing', S)).toEqual({ a: 3, b: 'z' })
  })
  test('throws a clear error when no valid JSON is present', () => {
    expect(() => parseStructured('no json here', S)).toThrow(/no JSON object/i)
  })
  test('throws when JSON is present but fails schema validation', () => {
    expect(() => parseStructured('{"a":"not a number","b":"x"}', S)).toThrow()
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { ZodType } from 'zod'

/** Find the first balanced {...} region in text (handles strings/escapes). */
function extractJsonRegion(text: string): string | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const haystack = fence ? fence[1] : text
  const start = haystack.indexOf('{')
  if (start === -1) return undefined
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < haystack.length; i++) {
    const ch = haystack[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return haystack.slice(start, i + 1) }
  }
  return undefined
}

export function parseStructured<T>(raw: string, schema: ZodType<T>): T {
  const region = extractJsonRegion(raw)
  if (!region) throw new Error('Agent output contained no JSON object')
  let parsed: unknown
  try { parsed = JSON.parse(region) } catch (e) {
    throw new Error(`Agent JSON parse failed: ${(e as Error).message}`)
  }
  return schema.parse(parsed)
}
```

- [ ] **Step 4: Run → PASS (5).** Add export.
- [ ] **Step 5: Commit** — `feat(llm-wiki): parseStructured (extract+validate JSON from CLI output)`

---

### Task 4: `CliAgentRunner` — spawn a command template (real-subprocess test)

**Files:** Create `src/cli-agent-runner.ts`; test `cli-agent-runner.test.ts`.

**Behavior:** per-engine command template `{ command: string; args: string[] }` with a `{{PROMPT}}` placeholder; spawn via `child_process.spawn`, write prompt to argv (placeholder substitution), capture stdout, enforce `timeoutMs` (kill + `ok:false`), return `{ok, output, raw}`. Default templates are provided but overridable.

- [ ] **Step 1: Failing test (drives a real `node -e` subprocess)**

```ts
import { describe, expect, test } from 'vitest'
import { CliAgentRunner } from './cli-agent-runner.js'

describe('CliAgentRunner', () => {
  test('runs the configured command and returns stdout', async () => {
    // Fake "agent": echo the prompt back as JSON via node -e
    const runner = new CliAgentRunner({
      claude: { command: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify({echo: process.argv[1]}))', '{{PROMPT}}'] },
    } as any)
    const res = await runner.run({ agent: 'claude', prompt: 'hello', timeoutMs: 10000 })
    expect(res.ok).toBe(true)
    expect(JSON.parse(res.output).echo).toBe('hello')
  })

  test('times out and returns ok:false when the process hangs', async () => {
    const runner = new CliAgentRunner({
      claude: { command: process.execPath, args: ['-e', 'setTimeout(()=>{}, 60000)'] },
    } as any)
    const res = await runner.run({ agent: 'claude', prompt: 'x', timeoutMs: 300 })
    expect(res.ok).toBe(false)
  })

  test('throws for an engine with no configured template', async () => {
    const runner = new CliAgentRunner({} as any)
    await expect(runner.run({ agent: 'opencode', prompt: 'x', timeoutMs: 100 })).rejects.toThrow(/no command template/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { spawn } from 'node:child_process'
import type { AgentType } from '@apc/shared'
import type { AgentRunner, RunInput, RunResult } from './agent-runner.js'

export type CommandTemplate = { command: string; args: string[] }
export type EngineTemplates = Partial<Record<AgentType, CommandTemplate>>

/** Default headless templates. Flags are version-dependent — validate at runtime (Plan 6 detect step). */
export const DEFAULT_TEMPLATES: EngineTemplates = {
  claude: { command: 'claude', args: ['-p', '{{PROMPT}}', '--output-format', 'json'] },
  codex: { command: 'codex', args: ['exec', '{{PROMPT}}'] },
  opencode: { command: 'opencode', args: ['run', '{{PROMPT}}'] },
}

export class CliAgentRunner implements AgentRunner {
  constructor(private readonly templates: EngineTemplates = DEFAULT_TEMPLATES) {}

  run(input: RunInput): Promise<RunResult> {
    const tpl = this.templates[input.agent]
    if (!tpl) return Promise.reject(new Error(`No command template for engine: ${input.agent}`))
    const args = tpl.args.map((a) => a.replace('{{PROMPT}}', input.prompt))

    return new Promise<RunResult>((resolve) => {
      const child = spawn(tpl.command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, output: '', raw: stderr }) }, input.timeoutMs)
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', () => { clearTimeout(timer); resolve({ ok: false, output: '', raw: stderr }) })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0, output: stdout, raw: stdout || stderr })
      })
    })
  }
}
```

- [ ] **Step 4: Run → PASS (3).** Add export.
- [ ] **Step 5: Commit** — `feat(llm-wiki): CliAgentRunner (headless spawn + timeout, configurable templates)`

---

### Task 5: Prompt builders (pure functions)

**Files:** Create `src/prompts.ts`; test `prompts.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'vitest'
import { buildWikiPrompt } from './prompts.js'
import type { NormalizedSession } from '@apc/shared'

const session: NormalizedSession = {
  id: 's1', agentType: 'claude', repoPath: '/work/apc', branch: 'main',
  turns: [
    { role: 'user', text: 'add ingest adapters', toolCalls: [] },
    { role: 'assistant', text: 'done; edited claude-adapter.ts', toolCalls: [] },
  ],
  filesTouched: ['packages/agents/src/claude-adapter.ts'],
}

describe('buildWikiPrompt', () => {
  test('includes the transcript, files, and a strict JSON-output instruction', () => {
    const p = buildWikiPrompt(session, { currentCanonical: '## Current\n- nothing yet\n' })
    expect(p).toContain('add ingest adapters')
    expect(p).toContain('claude-adapter.ts')
    expect(p).toContain('## Current')
    expect(p.toLowerCase()).toContain('json')
    expect(p).toContain('workSummary')        // names the required output keys
    expect(p).toContain('currentProposalMarkdown')
  })
  test('truncates very long transcripts to a bounded size', () => {
    const big = { ...session, turns: [{ role: 'user' as const, text: 'x'.repeat(50000), toolCalls: [] }] }
    expect(buildWikiPrompt(big, { currentCanonical: '' }).length).toBeLessThan(40000)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { NormalizedSession } from '@apc/shared'

const MAX_TRANSCRIPT = 24000

function renderTranscript(session: NormalizedSession): string {
  const text = session.turns.map((t) => `### ${t.role}\n${t.text}`).join('\n\n')
  return text.length > MAX_TRANSCRIPT ? text.slice(0, MAX_TRANSCRIPT) + '\n…[truncated]' : text
}

export function buildWikiPrompt(session: NormalizedSession, ctx: { currentCanonical: string }): string {
  return [
    'You are a PM assistant. Summarize an AI agent work session and propose project-memory updates.',
    'Respond with ONLY a single JSON object (no prose, no code fences) with exactly these keys:',
    '{"workSummary": string, "filesTouched": string[], "openProblems": string[],',
    ' "nextTasks": [{"title": string, "rationale": string}], "currentProposalMarkdown": string}',
    '',
    `Repo: ${session.repoPath ?? 'unknown'} (branch ${session.branch ?? 'unknown'})`,
    `Files the agent touched: ${session.filesTouched.join(', ') || 'none recorded'}`,
    '',
    '## Current canonical (current.md)',
    ctx.currentCanonical || '(empty)',
    '',
    '## Session transcript',
    renderTranscript(session),
  ].join('\n')
}
```

- [ ] **Step 4: Run → PASS (2).** Add export.
- [ ] **Step 5: Commit** — `feat(llm-wiki): pure wiki prompt builder (bounded transcript)`

---

### Task 6: `WikiEngine` — orchestrate runner + prompt + parse

**Files:** Create `src/wiki-engine.ts`; test `wiki-engine.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from 'vitest'
import { FakeAgentRunner } from './agent-runner.js'
import { WikiEngine } from './wiki-engine.js'
import type { NormalizedSession } from '@apc/shared'

const session: NormalizedSession = {
  id: 's1', agentType: 'claude', repoPath: '/work/apc',
  turns: [{ role: 'user', text: 'do the thing', toolCalls: [] }], filesTouched: [],
}

describe('WikiEngine.generate', () => {
  test('runs the chosen engine, parses JSON, returns a validated WikiGeneration', async () => {
    const runner = new FakeAgentRunner([
      JSON.stringify({ workSummary: 'did the thing', filesTouched: ['a.ts'],
        openProblems: [], nextTasks: [{ title: 'next', rationale: 'because' }],
        currentProposalMarkdown: '## Current\n- did the thing\n' }),
    ])
    const engine = new WikiEngine(runner)
    const gen = await engine.generate(session, { engine: 'codex', currentCanonical: '' })
    expect(gen.workSummary).toBe('did the thing')
    expect(gen.nextTasks[0].title).toBe('next')
    expect(runner.calls[0].agent).toBe('codex')        // used the selected engine
  })

  test('throws a clear error when the runner fails', async () => {
    const engine = new WikiEngine(new FakeAgentRunner([]))   // exhausted → ok:false
    await expect(engine.generate(session, { engine: 'claude', currentCanonical: '' }))
      .rejects.toThrow(/engine run failed/i)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { WikiGenerationSchema, type AgentType, type NormalizedSession, type WikiGeneration } from '@apc/shared'
import type { AgentRunner } from './agent-runner.js'
import { buildWikiPrompt } from './prompts.js'
import { parseStructured } from './parse-structured.js'

export class WikiEngine {
  constructor(private readonly runner: AgentRunner, private readonly timeoutMs = 120000) {}

  async generate(
    session: NormalizedSession,
    opts: { engine: AgentType; currentCanonical: string },
  ): Promise<WikiGeneration> {
    const prompt = buildWikiPrompt(session, { currentCanonical: opts.currentCanonical })
    const res = await this.runner.run({ agent: opts.engine, prompt, timeoutMs: this.timeoutMs })
    if (!res.ok) throw new Error(`Wiki engine run failed (engine=${opts.engine})`)
    return parseStructured(res.output, WikiGenerationSchema)
  }
}
```

- [ ] **Step 4: Run → PASS (2). Run full suite `pnpm test`.**
- [ ] **Step 5: Commit** — `feat(llm-wiki): WikiEngine orchestration (engine pick → prompt → parse)`

---

## Definition of Done (Plan 3)

- [ ] `pnpm test` green incl. the new `@apc/llm-wiki` package.
- [ ] `WikiEngine.generate` produces a validated `WikiGeneration` from a `NormalizedSession`, using the **caller-selected** engine (model picker).
- [ ] `parseStructured` survives fenced/embedded/bare JSON and fails loudly otherwise.
- [ ] `CliAgentRunner` spawns a real subprocess, honors `timeoutMs`, and is engine-template-driven (no hardcoded flags asserted).
- [ ] All generation is "candidate/proposal" output — applying `current.md` stays a human gate (enforced later in PM domain / UI).

## Deferred

- Wiring `WikiEngine` output into vault docs (`agent-runs/RUN-*-summary.md`, `current.md` proposal) + Task creation from `nextTasks` — **Plan 4 (PM domain)**.
- The model-picker UI + runtime validation of default CLI templates (detect/smoke) — **Plan 6**.
