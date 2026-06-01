# Agent Project Console — Ingest Engine Implementation Plan (Plan 2 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read real Claude Code / Codex / OpenCode session logs, normalize them into a common `NormalizedSession` shape, store an incremental watermark per source so re-ingest only reads new data, redact secrets, and index turns for full-text search — all pure Node + `node:sqlite`, no Electron.

**Architecture:** `@apc/agents` holds one `AgentIngestAdapter` per provider that turns provider-specific storage (JSONL files for Claude/Codex, the `opencode.db` SQLite for OpenCode) into `NormalizedSession`. A `SourceNormalizer` redacts secrets. `@apc/core` gains an `IngestCursorStore` (persists watermarks in the `ingest_cursors` table from Plan 1). `@apc/search` builds an FTS5 index over normalized turns. Adapters never spawn the agents and never read credential files.

**Tech Stack:** TypeScript (ESM), Vitest, Zod, `node:sqlite` (`DatabaseSync`, incl. FTS5 — both verified on Node 24), Node 24.

> Builds on Plan 1 (`@apc/shared`, `@apc/core`). Spec: `docs/superpowers/specs/2026-06-01-agent-project-console-design.md` §5 (NormalizedSession), §6 (ingest reality + incremental), §7 (project identity), §8 (AgentSessionManager), §12 (safety/redaction).

> **Verified formats (2026-06-01, this machine):**
> - Claude: `~/.claude/projects/<dir>/<uuid>.jsonl`. Lines have `type` (`user`/`assistant`/…), `message.role`, `message.content[]` blocks (`{type:"text"|"tool_use"|"tool_result"|"thinking", …}`), ISO `timestamp`, `uuid`, `parentUuid`, `cwd`, `gitBranch`, `sessionId`. **The dir name is NOT reliably decodable to a repo path (dashes collide with names like `ai-dashboard`) — read `repoPath` from the `cwd` field instead.**
> - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`. Line 1 `type:"session_meta"` → `payload.{id,cwd,git.branch,git.repository_url,cli_version}`; `type:"response_item"` → `payload.{type:"message",role,content[].{type:"input_text"|"output_text",text}}`. `logs_2.sqlite` is trace logs — **ignore for ingest.**
> - OpenCode: `~/.local/share/opencode/opencode.db`. Tables: `session`(id, `project_id`, `agent`, `model`, `time_created`, **`time_updated` ms = incremental key**), `message`(id, session_id, `role`, JSON `data`), `part`(id, message_id, JSON `data` with `type`/`text`), `project`(id, `worktree`). `auth.json` is credentials — **never read.**

---

## File Structure

```
packages/shared/src/
  ingest-schema.ts        # NormalizedSession/Turn/ToolCall, AgentSource, SourceCursor (Zod)
  ingest-schema.test.ts
packages/core/src/
  ingest-cursor-store.ts  # read/write watermark per source (ingest_cursors table)
  ingest-cursor-store.test.ts
packages/agents/
  package.json
  src/index.ts
  src/types.ts            # AgentIngestAdapter interface
  src/redact.ts           # secret redaction
  src/redact.test.ts
  src/claude-adapter.ts
  src/claude-adapter.test.ts
  src/codex-adapter.ts
  src/codex-adapter.test.ts
  src/opencode-adapter.ts
  src/opencode-adapter.test.ts
packages/search/
  package.json
  src/index.ts
  src/search-index.ts     # FTS5 over normalized turns
  src/search-index.test.ts
```

Add aliases for `@apc/agents` and `@apc/search` to `vitest.config.ts` (mirroring the existing `@apc/*` entries).

---

### Task 1: Ingest contracts in `@apc/shared`

**Files:**
- Create: `packages/shared/src/ingest-schema.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './ingest-schema.js'`)
- Test: `packages/shared/src/ingest-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { NormalizedSessionSchema, AgentSourceSchema, SourceCursorSchema } from './ingest-schema.js'

describe('NormalizedSessionSchema', () => {
  test('parses a session with turns and tool calls', () => {
    const s = NormalizedSessionSchema.parse({
      id: 'sess-1',
      agentType: 'claude',
      repoPath: '/mnt/c/work/apc',
      branch: 'main',
      startedAt: '2026-06-01T10:00:00Z',
      endedAt: '2026-06-01T10:30:00Z',
      turns: [
        { role: 'user', text: 'do X', toolCalls: [] },
        { role: 'assistant', text: 'done', toolCalls: [{ name: 'Bash', resultText: 'ok', isError: false }] },
      ],
      filesTouched: ['src/a.ts'],
    })
    expect(s.turns).toHaveLength(2)
    expect(s.turns[1].toolCalls[0].name).toBe('Bash')
  })

  test('defaults turns/toolCalls/filesTouched to empty arrays', () => {
    const s = NormalizedSessionSchema.parse({ id: 'x', agentType: 'codex' })
    expect(s.turns).toEqual([])
    expect(s.filesTouched).toEqual([])
  })
})

describe('AgentSourceSchema / SourceCursorSchema', () => {
  test('parses a jsonl-file source', () => {
    const src = AgentSourceSchema.parse({
      id: 'claude:/a/b.jsonl', agentKind: 'claude', kind: 'jsonl-file',
      locator: '/a/b.jsonl', mtimeMs: 123, sizeBytes: 456,
    })
    expect(src.kind).toBe('jsonl-file')
  })

  test('cursor carries an opaque position string', () => {
    const c = SourceCursorSchema.parse({
      sourceId: 'claude:/a/b.jsonl', position: JSON.stringify({ sizeBytes: 456, mtimeMs: 123 }),
      updatedAt: '2026-06-01T10:30:00Z',
    })
    expect(JSON.parse(c.position).sizeBytes).toBe(456)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/shared/src/ingest-schema.test.ts`
Expected: FAIL — cannot resolve `./ingest-schema.js`.

- [ ] **Step 3: Write the schema**

```ts
import { z } from 'zod'
import { AgentKind } from './schema.js'

export const NormalizedToolCallSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  input: z.unknown().optional(),
  resultText: z.string().optional(),
  isError: z.boolean().optional(),
})
export type NormalizedToolCall = z.infer<typeof NormalizedToolCallSchema>

export const NormalizedTurnSchema = z.object({
  uuid: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  text: z.string().default(''),
  timestamp: z.string().optional(),
  toolCalls: z.array(NormalizedToolCallSchema).default([]),
})
export type NormalizedTurn = z.infer<typeof NormalizedTurnSchema>

export const NormalizedSessionSchema = z.object({
  id: z.string().min(1),
  agentType: AgentKind,
  projectId: z.string().optional(),
  repoPath: z.string().optional(),
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  transcriptPath: z.string().optional(),
  turns: z.array(NormalizedTurnSchema).default([]),
  filesTouched: z.array(z.string()).default([]),
})
export type NormalizedSession = z.infer<typeof NormalizedSessionSchema>

export const AgentSourceSchema = z.object({
  id: z.string().min(1),
  agentKind: AgentKind,
  kind: z.enum(['jsonl-file', 'sqlite-session']),
  locator: z.string(),            // abs file path, or "db#sessionId"
  repoPath: z.string().optional(),
  mtimeMs: z.number().optional(),
  sizeBytes: z.number().optional(),
})
export type AgentSource = z.infer<typeof AgentSourceSchema>

export const SourceCursorSchema = z.object({
  sourceId: z.string().min(1),
  position: z.string(),           // opaque JSON: {sizeBytes,mtimeMs} or {timeUpdated}
  updatedAt: z.string(),
})
export type SourceCursor = z.infer<typeof SourceCursorSchema>
```

- [ ] **Step 4: Export + run tests**

Add to `packages/shared/src/index.ts`: `export * from './ingest-schema.js'`
Run: `pnpm test -- packages/shared/src/ingest-schema.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(shared): add ingest contracts (NormalizedSession, AgentSource, SourceCursor)"
```

---

### Task 2: `IngestCursorStore` in `@apc/core`

**Files:**
- Create: `packages/core/src/ingest-cursor-store.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ingest-cursor-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from './db.js'
import { IngestCursorStore } from './ingest-cursor-store.js'

describe('IngestCursorStore', () => {
  let db: Db
  let store: IngestCursorStore
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); store = new IngestCursorStore(db)
  })

  test('get returns undefined for an unknown source', () => {
    expect(store.get('nope')).toBeUndefined()
  })

  test('set then get round-trips the position', () => {
    store.set('claude:/a.jsonl', JSON.stringify({ sizeBytes: 10, mtimeMs: 5 }))
    const c = store.get('claude:/a.jsonl')
    expect(JSON.parse(c!.position).sizeBytes).toBe(10)
  })

  test('set overwrites an existing cursor', () => {
    store.set('s', '{"sizeBytes":1}')
    store.set('s', '{"sizeBytes":2}')
    expect(JSON.parse(store.get('s')!.position).sizeBytes).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/src/ingest-cursor-store.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement**

```ts
import type { SourceCursor } from '@apc/shared'
import type { Db } from './db.js'

export class IngestCursorStore {
  constructor(private readonly db: Db) {}

  get(sourceId: string): SourceCursor | undefined {
    const row = this.db
      .prepare('SELECT source_id, cursor, updated_at FROM ingest_cursors WHERE source_id = ?')
      .get(sourceId) as { source_id: string; cursor: string; updated_at: string } | undefined
    if (!row) return undefined
    return { sourceId: row.source_id, position: row.cursor, updatedAt: row.updated_at }
  }

  set(sourceId: string, position: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ingest_cursors (source_id, cursor, updated_at)
         VALUES (?, ?, datetime('now'))`,
      )
      .run(sourceId, position)
  }
}
```

- [ ] **Step 4: Export + run** — add `export * from './ingest-cursor-store.js'` to core index; `pnpm test -- packages/core/src/ingest-cursor-store.test.ts` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): add IngestCursorStore (per-source incremental watermark)"
```

---

### Task 3: `@apc/agents` scaffold + adapter interface + redaction

**Files:**
- Create: `packages/agents/package.json`, `packages/agents/src/index.ts`, `packages/agents/src/types.ts`
- Create: `packages/agents/src/redact.ts`
- Test: `packages/agents/src/redact.test.ts`
- Modify: `vitest.config.ts` (add `@apc/agents` + `@apc/search` aliases)

- [ ] **Step 1: Create package + interface + aliases**

`packages/agents/package.json`:

```json
{
  "name": "@apc/agents",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*", "@apc/core": "workspace:*" }
}
```

`packages/agents/src/types.ts`:

```ts
import type { AgentKind, AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'

export interface AgentIngestAdapter {
  readonly agentKind: AgentKind
  /** List sources whose data changed since their cursor. `cursorFor` returns the last saved cursor (or undefined). */
  discoverSources(cursorFor: (sourceId: string) => SourceCursor | undefined): Promise<AgentSource[]>
  /** Parse one source into a normalized session. Returns the session and the new cursor position string. */
  parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }>
}
```

In `vitest.config.ts` `resolve.alias`, add:
```ts
      '@apc/agents': `${root}packages/agents/src/index.ts`,
      '@apc/search': `${root}packages/search/src/index.ts`,
```

`packages/agents/src/index.ts`:
```ts
export * from './types.js'
export * from './redact.js'
export * from './claude-adapter.js'
export * from './codex-adapter.js'
export * from './opencode-adapter.js'
```
(The adapter exports will resolve once Tasks 4–6 create those files; for this task, temporarily export only `./types.js` and `./redact.js`, then add the others in their tasks.)

- [ ] **Step 2: Write the failing redaction test**

`packages/agents/src/redact.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { redact } from './redact.js'

describe('redact', () => {
  test('masks an OpenAI-style key', () => {
    expect(redact('key sk-abcdef0123456789abcdef0123')).toContain('[REDACTED]')
    expect(redact('key sk-abcdef0123456789abcdef0123')).not.toContain('sk-abcdef')
  })
  test('masks bearer tokens and emails', () => {
    expect(redact('Authorization: Bearer ABC.def-123')).toContain('[REDACTED]')
    expect(redact('mail me at a.b@example.com')).toContain('[REDACTED]')
  })
  test('leaves ordinary text untouched', () => {
    expect(redact('just normal text 42')).toBe('just normal text 42')
  })
})
```

- [ ] **Step 3: Run → FAIL** (`pnpm test -- packages/agents/src/redact.test.ts`).

- [ ] **Step 4: Implement redaction**

`packages/agents/src/redact.ts`:

```ts
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,                      // OpenAI-style keys
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,               // Slack tokens
  /\bBearer\s+[A-Za-z0-9._-]{8,}/g,                  // bearer tokens
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails
]

export function redact(text: string): string {
  let out = text
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]')
  return out
}
```

- [ ] **Step 5: Run → PASS (3). Commit**

```bash
git add -A && git commit -m "feat(agents): scaffold package, AgentIngestAdapter interface, secret redaction"
```

---

### Task 4: `ClaudeAdapter`

**Files:**
- Create: `packages/agents/src/claude-adapter.ts`
- Test: `packages/agents/src/claude-adapter.test.ts`

**Key behavior:** scan a base dir (default `~/.claude/projects`, injectable for tests) for `*/*.jsonl`; each file is a `jsonl-file` source; `discoverSources` skips files whose `{sizeBytes,mtimeMs}` matches the saved cursor. `parseSource` reads the whole file (Claude session files are small), parses each line, derives `repoPath`/`branch` from the first line carrying `cwd`/`gitBranch`, builds turns from `message.content[]`, collects `filesTouched` from `Edit`/`Write`/`MultiEdit` tool inputs, and redacts turn text.

- [ ] **Step 1: Write the failing test (with a real-shape fixture)**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeAdapter } from './claude-adapter.js'

function writeSession(base: string, dir: string, file: string, lines: object[]) {
  const d = join(base, dir)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, file), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

describe('ClaudeAdapter', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'apc-claude-'))
    writeSession(base, '-mnt-c-work-apc', 's1.jsonl', [
      { type: 'user', sessionId: 's1', cwd: '/mnt/c/work/apc', gitBranch: 'main',
        timestamp: '2026-06-01T10:00:00Z', uuid: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: 'add a feature' }] } },
      { type: 'assistant', sessionId: 's1', timestamp: '2026-06-01T10:01:00Z', uuid: 'u2',
        message: { role: 'assistant', content: [
          { type: 'text', text: 'editing file' },
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts' } },
        ] } },
      { type: 'user', sessionId: 's1', timestamp: '2026-06-01T10:01:30Z', uuid: 'u3',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false },
        ] } },
    ])
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  test('discoverSources finds the jsonl file', async () => {
    const a = new ClaudeAdapter(base)
    const sources = await a.discoverSources(() => undefined)
    expect(sources).toHaveLength(1)
    expect(sources[0].agentKind).toBe('claude')
    expect(sources[0].kind).toBe('jsonl-file')
  })

  test('discoverSources skips a source whose cursor matches size+mtime', async () => {
    const a = new ClaudeAdapter(base)
    const [src] = await a.discoverSources(() => undefined)
    const seen = { sourceId: src.id, position: JSON.stringify({ sizeBytes: src.sizeBytes, mtimeMs: src.mtimeMs }), updatedAt: 'x' }
    const second = await a.discoverSources((id) => (id === src.id ? seen : undefined))
    expect(second).toHaveLength(0)
  })

  test('parseSource normalizes turns, repoPath, branch, filesTouched', async () => {
    const a = new ClaudeAdapter(base)
    const [src] = await a.discoverSources(() => undefined)
    const { session, position } = await a.parseSource(src)
    expect(session.id).toBe('s1')
    expect(session.agentType).toBe('claude')
    expect(session.repoPath).toBe('/mnt/c/work/apc')
    expect(session.branch).toBe('main')
    expect(session.startedAt).toBe('2026-06-01T10:00:00Z')
    expect(session.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user'])
    expect(session.turns[1].toolCalls[0].name).toBe('Edit')
    expect(session.filesTouched).toContain('src/a.ts')
    expect(JSON.parse(position).sizeBytes).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSourceSchema, NormalizedSessionSchema, type AgentSource, type NormalizedSession, type NormalizedTurn, type SourceCursor } from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export class ClaudeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'claude' as const
  constructor(private readonly projectsDir: string = join(homedir(), '.claude', 'projects')) {}

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    const out: AgentSource[] = []
    let dirs: string[]
    try { dirs = readdirSync(this.projectsDir) } catch { return [] }
    for (const dir of dirs) {
      const abs = join(this.projectsDir, dir)
      let files: string[]
      try { files = readdirSync(abs) } catch { continue }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue
        const locator = join(abs, f)
        const st = statSync(locator)
        const id = `claude:${locator}`
        const cur = cursorFor(id)
        if (cur) {
          const pos = JSON.parse(cur.position) as { sizeBytes?: number; mtimeMs?: number }
          if (pos.sizeBytes === st.size && pos.mtimeMs === Math.floor(st.mtimeMs)) continue
        }
        out.push(AgentSourceSchema.parse({
          id, agentKind: 'claude', kind: 'jsonl-file', locator,
          mtimeMs: Math.floor(st.mtimeMs), sizeBytes: st.size,
        }))
      }
    }
    return out
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const raw = readFileSync(source.locator, 'utf8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    const turns: NormalizedTurn[] = []
    const filesTouched = new Set<string>()
    let sessionId: string | undefined
    let repoPath: string | undefined
    let branch: string | undefined
    let startedAt: string | undefined
    let endedAt: string | undefined

    for (const line of lines) {
      let obj: any
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.sessionId && !sessionId) sessionId = obj.sessionId
      if (obj.cwd && !repoPath) repoPath = obj.cwd
      if (obj.gitBranch && !branch && obj.gitBranch !== 'HEAD') branch = obj.gitBranch
      if (obj.timestamp) { if (!startedAt) startedAt = obj.timestamp; endedAt = obj.timestamp }

      if ((obj.type === 'user' || obj.type === 'assistant') && obj.message?.content) {
        const role = obj.message.role === 'assistant' ? 'assistant' : 'user'
        const texts: string[] = []
        const toolCalls: NormalizedTurn['toolCalls'] = []
        for (const block of obj.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
          else if (block.type === 'tool_use') {
            toolCalls.push({ id: block.id, name: block.name, input: block.input })
            const fp = block.input?.file_path
            if (FILE_EDIT_TOOLS.has(block.name) && typeof fp === 'string') filesTouched.add(fp)
          } else if (block.type === 'tool_result') {
            const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
            toolCalls.push({ id: block.tool_use_id, name: 'tool_result', resultText: redact(content).slice(0, 4000), isError: !!block.is_error })
          }
        }
        turns.push({ uuid: obj.uuid, role, text: redact(texts.join('\n')), timestamp: obj.timestamp, toolCalls })
      }
    }

    const session = NormalizedSessionSchema.parse({
      id: sessionId ?? source.locator,
      agentType: 'claude',
      repoPath, branch, startedAt, endedAt,
      transcriptPath: source.locator,
      turns, filesTouched: [...filesTouched],
    })
    const position = JSON.stringify({ sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs })
    return { session, position }
  }
}
```

- [ ] **Step 4: Run → PASS (3).** Then add `export * from './claude-adapter.js'` to `packages/agents/src/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(agents): ClaudeAdapter — JSONL discovery + incremental + normalization"
```

---

### Task 5: `CodexAdapter`

**Files:**
- Create: `packages/agents/src/codex-adapter.ts`
- Test: `packages/agents/src/codex-adapter.test.ts`

**Key behavior:** walk `<base>/YYYY/MM/DD/rollout-*.jsonl`; each file is a source; same `{sizeBytes,mtimeMs}` cursor logic. `parseSource` reads `session_meta` (→ id/cwd/branch/startedAt) and `response_item` lines with `payload.type==='message'` (→ turns from `content[].text`); redact text.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexAdapter } from './codex-adapter.js'

describe('CodexAdapter', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'apc-codex-'))
    const d = join(base, '2026', '06', '01')
    mkdirSync(d, { recursive: true })
    const lines = [
      { type: 'session_meta', timestamp: '2026-06-01T10:00:00Z',
        payload: { id: 'cx1', timestamp: '2026-06-01T10:00:00Z', cwd: '/mnt/c/work/apc',
          git: { branch: 'feat/x', repository_url: 'https://github.com/o/r' } } },
      { type: 'response_item', timestamp: '2026-06-01T10:00:05Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
      { type: 'response_item', timestamp: '2026-06-01T10:00:10Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] } },
      { type: 'event_msg', timestamp: '2026-06-01T10:00:11Z', payload: { type: 'task_started' } },
    ]
    writeFileSync(join(d, 'rollout-2026-06-01T10-00-00-cx1.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  test('discovers nested rollout files', async () => {
    const a = new CodexAdapter(base)
    const sources = await a.discoverSources(() => undefined)
    expect(sources).toHaveLength(1)
    expect(sources[0].agentKind).toBe('codex')
  })

  test('parseSource extracts id/cwd/branch and message turns', async () => {
    const a = new CodexAdapter(base)
    const [src] = await a.discoverSources(() => undefined)
    const { session } = await a.parseSource(src)
    expect(session.id).toBe('cx1')
    expect(session.repoPath).toBe('/mnt/c/work/apc')
    expect(session.branch).toBe('feat/x')
    expect(session.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(session.turns[1].text).toBe('hi there')
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSourceSchema, NormalizedSessionSchema, type AgentSource, type NormalizedSession, type NormalizedTurn, type SourceCursor } from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'

function walkJsonl(dir: string): string[] {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkJsonl(abs))
    else if (e.name.endsWith('.jsonl')) out.push(abs)
  }
  return out
}

export class CodexAdapter implements AgentIngestAdapter {
  readonly agentKind = 'codex' as const
  constructor(private readonly sessionsDir: string = join(homedir(), '.codex', 'sessions')) {}

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    const out: AgentSource[] = []
    for (const locator of walkJsonl(this.sessionsDir)) {
      const st = statSync(locator)
      const id = `codex:${locator}`
      const cur = cursorFor(id)
      if (cur) {
        const pos = JSON.parse(cur.position) as { sizeBytes?: number; mtimeMs?: number }
        if (pos.sizeBytes === st.size && pos.mtimeMs === Math.floor(st.mtimeMs)) continue
      }
      out.push(AgentSourceSchema.parse({
        id, agentKind: 'codex', kind: 'jsonl-file', locator,
        mtimeMs: Math.floor(st.mtimeMs), sizeBytes: st.size,
      }))
    }
    return out
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const lines = readFileSync(source.locator, 'utf8').split('\n').filter((l) => l.trim())
    const turns: NormalizedTurn[] = []
    let id: string | undefined
    let repoPath: string | undefined
    let branch: string | undefined
    let startedAt: string | undefined
    let endedAt: string | undefined

    for (const line of lines) {
      let obj: any
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.timestamp) { if (!startedAt) startedAt = obj.timestamp; endedAt = obj.timestamp }
      if (obj.type === 'session_meta') {
        id = obj.payload?.id ?? id
        repoPath = obj.payload?.cwd ?? repoPath
        branch = obj.payload?.git?.branch ?? branch
      } else if (obj.type === 'response_item' && obj.payload?.type === 'message') {
        const role = obj.payload.role === 'assistant' ? 'assistant'
          : obj.payload.role === 'user' ? 'user' : 'system'
        const text = (obj.payload.content ?? [])
          .map((c: any) => (typeof c.text === 'string' ? c.text : '')).join('\n')
        turns.push({ role, text: redact(text), timestamp: obj.timestamp, toolCalls: [] })
      }
    }

    const session = NormalizedSessionSchema.parse({
      id: id ?? source.locator, agentType: 'codex', repoPath, branch, startedAt, endedAt,
      transcriptPath: source.locator, turns, filesTouched: [],
    })
    return { session, position: JSON.stringify({ sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs }) }
  }
}
```

- [ ] **Step 4: Run → PASS (2).** Add `export * from './codex-adapter.js'` to index.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(agents): CodexAdapter — rollout JSONL discovery + normalization"
```

---

### Task 6: `OpenCodeAdapter` (SQLite, incremental by `time_updated`)

**Files:**
- Create: `packages/agents/src/opencode-adapter.ts`
- Test: `packages/agents/src/opencode-adapter.test.ts`

**Key behavior:** open `opencode.db` read-only; `discoverSources` returns one `sqlite-session` source per `session` row with `time_updated` greater than the saved cursor (cursor position = `{timeUpdated}`); `parseSource` joins `message`+`part` for that session into turns, resolves `repoPath` via the `project.worktree`. The test builds a tiny DB with the real column shapes so it never touches the user's 347MB file.

- [ ] **Step 1: Write the failing test (builds a fixture DB)**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenCodeAdapter } from './opencode-adapter.js'

describe('OpenCodeAdapter', () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-oc-'))
    dbPath = join(dir, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
    `)
    db.prepare('INSERT INTO project VALUES (?,?)').run('p1', '/mnt/c/work/apc')
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?)').run('oc1', 'p1', 'build', 'openai/gpt-5.5', 1000, 2000)
    db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m1', 'oc1', 'user', '{}')
    db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m2', 'oc1', 'assistant', '{}')
    db.prepare('INSERT INTO part VALUES (?,?,?)').run('pt1', 'm1', JSON.stringify({ type: 'text', text: 'please build' }))
    db.prepare('INSERT INTO part VALUES (?,?,?)').run('pt2', 'm2', JSON.stringify({ type: 'text', text: 'building now' }))
    db.close()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('discovers sessions newer than the cursor', async () => {
    const a = new OpenCodeAdapter(dbPath)
    expect(await a.discoverSources(() => undefined)).toHaveLength(1)
    const seen = { sourceId: 'opencode:oc1', position: JSON.stringify({ timeUpdated: 2000 }), updatedAt: 'x' }
    expect(await a.discoverSources((id) => (id === 'opencode:oc1' ? seen : undefined))).toHaveLength(0)
  })

  test('parseSource joins message+part into turns and resolves repoPath', async () => {
    const a = new OpenCodeAdapter(dbPath)
    const [src] = await a.discoverSources(() => undefined)
    const { session, position } = await a.parseSource(src)
    expect(session.id).toBe('oc1')
    expect(session.repoPath).toBe('/mnt/c/work/apc')
    expect(session.turns.map((t) => t.text)).toEqual(['please build', 'building now'])
    expect(JSON.parse(position).timeUpdated).toBe(2000)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSourceSchema, NormalizedSessionSchema, type AgentSource, type NormalizedSession, type NormalizedTurn, type SourceCursor } from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'

const DEFAULT_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

export class OpenCodeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'opencode' as const
  constructor(private readonly dbPath: string = DEFAULT_DB) {}

  private open(): DatabaseSync {
    return new DatabaseSync(this.dbPath, { readOnly: true })
  }

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    let db: DatabaseSync
    try { db = this.open() } catch { return [] }
    try {
      const rows = db.prepare('SELECT id, time_updated FROM session ORDER BY time_updated').all() as
        { id: string; time_updated: number }[]
      const out: AgentSource[] = []
      for (const r of rows) {
        const id = `opencode:${r.id}`
        const cur = cursorFor(id)
        if (cur && (JSON.parse(cur.position).timeUpdated ?? -1) >= r.time_updated) continue
        out.push(AgentSourceSchema.parse({
          id, agentKind: 'opencode', kind: 'sqlite-session', locator: `${this.dbPath}#${r.id}`,
        }))
      }
      return out
    } finally { db.close() }
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const sessionId = source.locator.split('#')[1]
    const db = this.open()
    try {
      const s = db.prepare('SELECT id, project_id, time_updated FROM session WHERE id = ?').get(sessionId) as
        { id: string; project_id: string; time_updated: number } | undefined
      if (!s) throw new Error(`OpenCode session not found: ${sessionId}`)
      const proj = db.prepare('SELECT worktree FROM project WHERE id = ?').get(s.project_id) as
        { worktree: string } | undefined

      const messages = db.prepare('SELECT id, role FROM message WHERE session_id = ? ORDER BY id').all(sessionId) as
        { id: string; role: string }[]
      const partStmt = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY id')
      const turns: NormalizedTurn[] = []
      for (const m of messages) {
        const parts = partStmt.all(m.id) as { data: string }[]
        const text = parts.map((p) => {
          try { const d = JSON.parse(p.data); return typeof d.text === 'string' ? d.text : '' } catch { return '' }
        }).filter(Boolean).join('\n')
        const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : 'system'
        turns.push({ role, text: redact(text), toolCalls: [] })
      }

      const session = NormalizedSessionSchema.parse({
        id: s.id, agentType: 'opencode',
        repoPath: proj?.worktree, worktreePath: proj?.worktree,
        turns, filesTouched: [],
      })
      return { session, position: JSON.stringify({ timeUpdated: s.time_updated }) }
    } finally { db.close() }
  }
}
```

- [ ] **Step 4: Run → PASS (2).** Add `export * from './opencode-adapter.js'` to index.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(agents): OpenCodeAdapter — opencode.db incremental ingest by time_updated"
```

---

### Task 7: `@apc/search` — FTS5 index over turns

**Files:**
- Create: `packages/search/package.json`, `packages/search/src/index.ts`, `packages/search/src/search-index.ts`
- Test: `packages/search/src/search-index.test.ts`

**Key behavior:** an FTS5 virtual table `turn_fts(session_id, project_id, role, body)`; `indexSession(session, projectId)` deletes prior rows for that session then inserts one row per turn; `search(query, {projectId?})` runs an FTS `MATCH`, returns ranked `{sessionId, role, snippet}`.

- [ ] **Step 1: Create package**

`packages/search/package.json`:

```json
{
  "name": "@apc/search",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*" }
}
```

`packages/search/src/index.ts`:
```ts
export * from './search-index.js'
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SearchIndex } from './search-index.js'

function session(id: string, projectId: string, texts: [string, string][]) {
  return { id, agentType: 'claude' as const, projectId,
    turns: texts.map(([role, text]) => ({ role: role as 'user' | 'assistant', text, toolCalls: [] })),
    filesTouched: [] }
}

describe('SearchIndex', () => {
  test('indexes turns and finds them by MATCH, scoped by project', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'design the agent session manager'], ['assistant', 'ok']]))
    idx.indexSession(session('s2', 'p2', [['user', 'unrelated billing work']]))

    const hits = idx.search('session manager')
    expect(hits.map((h) => h.sessionId)).toContain('s1')
    expect(idx.search('session manager', { projectId: 'p2' })).toHaveLength(0)
  })

  test('re-indexing a session replaces its old rows', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'first version text']]))
    idx.indexSession(session('s1', 'p1', [['user', 'second version text']]))
    expect(idx.search('first')).toHaveLength(0)
    expect(idx.search('second')).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement**

```ts
import type { DatabaseSync } from 'node:sqlite'
import type { NormalizedSession } from '@apc/shared'

export type SearchHit = { sessionId: string; projectId: string; role: string; snippet: string }

export class SearchIndex {
  constructor(private readonly db: DatabaseSync) {
    // contentless-external columns kept simple: store values directly in FTS table
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts USING fts5(session_id, project_id, role, body)`)
  }

  indexSession(session: NormalizedSession): void {
    const projectId = session.projectId ?? ''
    this.db.prepare('DELETE FROM turn_fts WHERE session_id = ?').run(session.id)
    const ins = this.db.prepare('INSERT INTO turn_fts (session_id, project_id, role, body) VALUES (?, ?, ?, ?)')
    for (const t of session.turns) {
      if (!t.text.trim()) continue
      ins.run(session.id, projectId, t.role, t.text)
    }
  }

  search(query: string, opts: { projectId?: string } = {}): SearchHit[] {
    const sql = opts.projectId
      ? `SELECT session_id, project_id, role, snippet(turn_fts, 3, '[', ']', '…', 10) AS snip
         FROM turn_fts WHERE turn_fts MATCH ? AND project_id = ? ORDER BY rank`
      : `SELECT session_id, project_id, role, snippet(turn_fts, 3, '[', ']', '…', 10) AS snip
         FROM turn_fts WHERE turn_fts MATCH ? ORDER BY rank`
    const rows = (opts.projectId
      ? this.db.prepare(sql).all(query, opts.projectId)
      : this.db.prepare(sql).all(query)) as { session_id: string; project_id: string; role: string; snip: string }[]
    return rows.map((r) => ({ sessionId: r.session_id, projectId: r.project_id, role: r.role, snippet: r.snip }))
  }
}
```

- [ ] **Step 5: Run → PASS (2).** Then run the full suite `pnpm test`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(search): FTS5 SearchIndex over normalized turns (project-scoped)"
```

---

## Definition of Done (Plan 2)

- [ ] `pnpm test` green across shared/core/vault/workflow/agents/search.
- [ ] Three adapters turn real-shape fixtures into `NormalizedSession` (verified field-by-field).
- [ ] Incremental discovery skips unchanged sources (file size+mtime for Claude/Codex; `time_updated` for OpenCode).
- [ ] `IngestCursorStore` round-trips watermarks; OpenCode opens its DB **read-only** and never reads `auth.json`.
- [ ] Secret patterns are redacted from turn text before storage/index.
- [ ] `SearchIndex` finds indexed turns by FTS `MATCH`, scoped by project, with replace-on-reindex.

## Deferred to later plans

- An `IngestService` that ties adapters → ProjectRegistry mapping → SearchIndex → cursor save in one pass, run inside a `LocalWorkerRunner` job — **Plan 4** (PM domain wires the pipeline) or the Electron integration **Plan 6**.
- Terminal surface (`node-pty`/`xterm.js`) and `buildCommand` runtime methods of the adapter — **Plan 6**.
- Folder watch / hook auto-ingest — P1 per spec.
