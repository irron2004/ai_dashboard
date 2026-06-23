# CLI Session Persistence + Auto-Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱을 닫았다 켜도 프로젝트별 CLI(claude/codex/opencode) 대화를 라이브 resume로 이어가고, 열려 있던 패널 워크스페이스를 자동 복원한다.

**Architecture:** `@apc/agents`에 세션 발견(`findLatestSession`)과 CLI별 resume 명령 매핑(`resumeCommand`)을 추가(기존 어댑터 재사용). `@apc/desktop` main에 sqlite 워크스페이스 스냅샷(`session-store`)과 PTY resume 경로를 추가하고, 종료 시 스냅샷 → 부팅 시 렌더러가 패널을 재오픈하며 각 CLI를 resume로 띄운다.

**Tech Stack:** TypeScript, Electron, node-pty(`@homebridge/node-pty-prebuilt-multiarch`), better-sqlite3, zustand, vitest. 설계: `docs/superpowers/specs/2026-06-23-cli-session-persistence-design.md`.

## Global Constraints

- 대상 CLI: `claude` · `codex` · `opencode` (= `AgentKind`). 그 외는 기존 평범한 start 유지.
- resume 실패/세션 없음 → **패널은 항상 열림**, fresh 폴백 + 안내 메시지(작업 흐름 안 깨짐).
- 기존 `kernel`/`@apc/*` 공개 시그니처를 깨지 않는다. `StartPtyReq`는 **추가 필드만**(`resume?`, `agent?`, `sessionId?`) — 기존 호출 호환.
- 테스트: vitest. 실행은 repo 루트에서 `pnpm vitest run <path>`.
- 커밋은 Conventional Commits.

---

### Task 1: `@apc/agents` — resumeCommand (CLI별 resume 명령 매핑)

**Files:**
- Create: `packages/agents/src/resume.ts`
- Test: `packages/agents/src/resume.test.ts`

**Interfaces:**
- Consumes: `AgentKind` from `@apc/shared` (`'claude'|'codex'|'opencode'`).
- Produces: `resumeCommand(agent: AgentKind, opts: { sessionId?: string }): { command: string; args: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/src/resume.test.ts
import { describe, test, expect } from 'vitest'
import { resumeCommand } from './resume.js'

describe('resumeCommand', () => {
  test('claude with sessionId → --resume <id>', () => {
    expect(resumeCommand('claude', { sessionId: 'abc' })).toEqual({ command: 'claude', args: ['--resume', 'abc'] })
  })
  test('claude without sessionId → --continue (latest)', () => {
    expect(resumeCommand('claude', {})).toEqual({ command: 'claude', args: ['--continue'] })
  })
  test('codex with sessionId → resume <id>', () => {
    expect(resumeCommand('codex', { sessionId: 'x' })).toEqual({ command: 'codex', args: ['resume', 'x'] })
  })
  test('codex without sessionId → resume --last', () => {
    expect(resumeCommand('codex', {})).toEqual({ command: 'codex', args: ['resume', '--last'] })
  })
  test('opencode with sessionId → --session <id>', () => {
    expect(resumeCommand('opencode', { sessionId: 's' })).toEqual({ command: 'opencode', args: ['--session', 's'] })
  })
  test('opencode without sessionId → --continue', () => {
    expect(resumeCommand('opencode', {})).toEqual({ command: 'opencode', args: ['--continue'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/agents/src/resume.test.ts`
Expected: FAIL — "Failed to resolve import './resume.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agents/src/resume.ts
import type { AgentKind } from '@apc/shared'

export type ResumeOpts = { sessionId?: string }
export type LaunchSpec = { command: string; args: string[] }

/**
 * CLI별 resume 명령 매핑. sessionId가 있으면 특정 세션, 없으면 "가장 최근" 세션.
 * NOTE: 플래그는 각 CLI `--help`로 검증됨(2026-06). 변경 시 여기만 고친다.
 */
export function resumeCommand(agent: AgentKind, opts: ResumeOpts): LaunchSpec {
  const id = opts.sessionId
  switch (agent) {
    case 'claude':
      return { command: 'claude', args: id ? ['--resume', id] : ['--continue'] }
    case 'codex':
      return { command: 'codex', args: id ? ['resume', id] : ['resume', '--last'] }
    case 'opencode':
      return { command: 'opencode', args: id ? ['--session', id] : ['--continue'] }
    default:
      return { command: agent, args: [] }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/agents/src/resume.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify CLI flags before merge (manual)**

Run each and confirm the flag exists; if a flag differs, update the mapping + test:
`claude --help | grep -E 'resume|continue'` · `codex resume --help` · `opencode --help | grep -E 'session|continue'`.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/resume.ts packages/agents/src/resume.test.ts
git commit -m "feat(agents): resumeCommand — per-CLI resume launch mapping"
```

---

### Task 2: `@apc/agents` — findLatestSession + adapterFor (repo의 최신 세션 발견)

**Files:**
- Modify: `packages/agents/src/resume.ts` (append)
- Modify: `packages/agents/src/index.ts` (export resume.js)
- Test: `packages/agents/src/resume.find.test.ts`

**Interfaces:**
- Consumes: `AgentIngestAdapter` (`{ agentKind, discoverSources(cursorFor), parseSource(source) }`), `AgentSource` (`{ id, locator, repoPath?, mtimeMs? }`), `NormalizedSession` (`{ id, agentType, repoPath?, startedAt?, endedAt? }`) from `@apc/agents`/`@apc/shared`. `ClaudeAdapter`/`CodexAdapter`/`OpenCodeAdapter`.
- Produces:
  - `findLatestSession(adapter: AgentIngestAdapter, repoPath: string): Promise<{ sessionId: string; startedAt?: string } | null>`
  - `adapterFor(agent: AgentKind): AgentIngestAdapter`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/src/resume.find.test.ts
import { describe, test, expect } from 'vitest'
import type { AgentIngestAdapter } from './types.js'
import type { AgentSource, NormalizedSession } from '@apc/shared'
import { findLatestSession } from './resume.js'

function fakeAdapter(rows: Array<{ source: Partial<AgentSource>; session: Partial<NormalizedSession> }>): AgentIngestAdapter {
  return {
    agentKind: 'claude',
    async discoverSources() {
      return rows.map((r, i) => ({
        id: `s${i}`, agentKind: 'claude', kind: 'jsonl-file', locator: `/l${i}`, ...r.source,
      })) as AgentSource[]
    },
    async parseSource(source) {
      const r = rows.find((x, i) => (x.source.id ?? `s${i}`) === source.id)!
      return { session: { id: 's', agentType: 'claude', ...r.session } as NormalizedSession, position: '' }
    },
  }
}

describe('findLatestSession', () => {
  test('picks newest session matching repoPath', async () => {
    const adapter = fakeAdapter([
      { source: { id: 's0' }, session: { id: 'old', repoPath: '/repo/a', endedAt: '2026-06-01T00:00:00Z' } },
      { source: { id: 's1' }, session: { id: 'new', repoPath: '/repo/a', endedAt: '2026-06-10T00:00:00Z' } },
      { source: { id: 's2' }, session: { id: 'other', repoPath: '/repo/b', endedAt: '2026-06-20T00:00:00Z' } },
    ])
    const r = await findLatestSession(adapter, '/repo/a')
    expect(r?.sessionId).toBe('new')
  })

  test('returns null when no session matches repoPath', async () => {
    const adapter = fakeAdapter([{ source: { id: 's0' }, session: { id: 'x', repoPath: '/other' } }])
    expect(await findLatestSession(adapter, '/repo/a')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/agents/src/resume.find.test.ts`
Expected: FAIL — `findLatestSession` is not exported.

- [ ] **Step 3: Write minimal implementation (append to resume.ts)**

```ts
// packages/agents/src/resume.ts  (append)
import { homedir } from 'node:os'
import type { AgentIngestAdapter } from './types.js'
import { ClaudeAdapter } from './claude-adapter.js'
import { CodexAdapter } from './codex-adapter.js'
import { OpenCodeAdapter } from './opencode-adapter.js'

export function adapterFor(agent: AgentKind): AgentIngestAdapter {
  switch (agent) {
    case 'claude': return new ClaudeAdapter()
    case 'codex': return new CodexAdapter()
    case 'opencode': return new OpenCodeAdapter()
    default: throw new Error(`no adapter for agent: ${agent}`)
  }
}

const _t = (s?: string) => (s ? Date.parse(s) : 0)

/** repoPath와 일치하는 세션 중 가장 최근(endedAt||startedAt) 1건의 sessionId를 돌려준다. */
export async function findLatestSession(
  adapter: AgentIngestAdapter,
  repoPath: string,
): Promise<{ sessionId: string; startedAt?: string } | null> {
  const sources = await adapter.discoverSources(() => undefined)
  let best: { sessionId: string; startedAt?: string; rank: number } | null = null
  for (const source of sources) {
    // 빠른 경로: source.repoPath가 이미 채워져 있으면 parse 생략 가능하지만,
    // sessionId는 parse가 필요하므로 매칭 후보만 parse한다.
    if (source.repoPath && source.repoPath !== repoPath) continue
    const { session } = await adapter.parseSource(source)
    if (session.repoPath !== repoPath) continue
    const rank = Math.max(_t(session.endedAt), _t(session.startedAt), source.mtimeMs ?? 0)
    if (!best || rank > best.rank) best = { sessionId: session.id, startedAt: session.startedAt, rank }
  }
  return best ? { sessionId: best.sessionId, startedAt: best.startedAt } : null
}
```

- [ ] **Step 4: Export from index**

```ts
// packages/agents/src/index.ts  (append one line)
export * from './resume.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/agents/src/resume.find.test.ts packages/agents/src/resume.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/resume.ts packages/agents/src/resume.find.test.ts packages/agents/src/index.ts
git commit -m "feat(agents): findLatestSession + adapterFor (discover latest session per repo)"
```

---

### Task 3: desktop main — session-store (sqlite 워크스페이스 스냅샷)

**Files:**
- Create: `apps/desktop/src/main/session-store.ts`
- Test: `apps/desktop/src/main/session-store.test.ts`

**Interfaces:**
- Consumes: better-sqlite3 `Database` (via `apps/desktop/src/main/sqlite-shim.ts` — `import Database from './sqlite-shim.js'` 패턴은 기존 코드 참고).
- Produces: `class SessionStore` with:
  - `constructor(db: DB)` and `ensureSchema(): void`
  - `upsertPane(p: { projectId: string; agent: string; lastSessionId?: string | null; wasOpen: boolean }): void`
  - `listOpenPanes(): Array<{ projectId: string; agent: string; lastSessionId: string | null }>`
  - `setState(key: string, value: string): void` / `getState(key: string): string | null`
  - `closeAllPanes(): void`  (스냅샷 직전 was_open 초기화용)

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/session-store.test.ts
import { describe, test, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { SessionStore } from './session-store.js'

let store: SessionStore
beforeEach(() => {
  store = new SessionStore(new Database(':memory:'))
  store.ensureSchema()
})

describe('SessionStore', () => {
  test('upsert + listOpenPanes returns only open panes', () => {
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'sid', wasOpen: true })
    store.upsertPane({ projectId: 'p1', agent: 'codex', lastSessionId: null, wasOpen: false })
    const open = store.listOpenPanes()
    expect(open).toEqual([{ projectId: 'p1', agent: 'claude', lastSessionId: 'sid' }])
  })

  test('upsert replaces same (project,agent)', () => {
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'a', wasOpen: true })
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'b', wasOpen: true })
    expect(store.listOpenPanes()).toEqual([{ projectId: 'p1', agent: 'claude', lastSessionId: 'b' }])
  })

  test('app_state round-trips', () => {
    expect(store.getState('selected_project_id')).toBeNull()
    store.setState('selected_project_id', 'p1')
    expect(store.getState('selected_project_id')).toBe('p1')
  })

  test('closeAllPanes clears was_open', () => {
    store.upsertPane({ projectId: 'p1', agent: 'claude', lastSessionId: 'a', wasOpen: true })
    store.closeAllPanes()
    expect(store.listOpenPanes()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/desktop/src/main/session-store.test.ts`
Expected: FAIL — cannot import `./session-store.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/main/session-store.ts
type DB = {
  exec(sql: string): unknown
  prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): any; all(...a: unknown[]): any[] }
}

export class SessionStore {
  constructor(private readonly db: DB) {}

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_pane (
        project_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        last_session_id TEXT,
        last_active TEXT,
        was_open INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, agent)
      );
      CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT);
    `)
  }

  upsertPane(p: { projectId: string; agent: string; lastSessionId?: string | null; wasOpen: boolean }): void {
    this.db.prepare(`
      INSERT INTO workspace_pane (project_id, agent, last_session_id, last_active, was_open)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, agent) DO UPDATE SET
        last_session_id = excluded.last_session_id,
        last_active = excluded.last_active,
        was_open = excluded.was_open
    `).run(p.projectId, p.agent, p.lastSessionId ?? null, new Date().toISOString(), p.wasOpen ? 1 : 0)
  }

  listOpenPanes(): Array<{ projectId: string; agent: string; lastSessionId: string | null }> {
    return this.db.prepare(
      `SELECT project_id as projectId, agent, last_session_id as lastSessionId
       FROM workspace_pane WHERE was_open = 1 ORDER BY project_id, agent`,
    ).all()
  }

  setState(key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value)
  }

  getState(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key)
    return row ? (row.value as string) : null
  }

  closeAllPanes(): void {
    this.db.exec(`UPDATE workspace_pane SET was_open = 0`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/desktop/src/main/session-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/session-store.ts apps/desktop/src/main/session-store.test.ts
git commit -m "feat(desktop): SessionStore — sqlite workspace snapshot"
```

---

### Task 4: desktop main — pty-manager resume 경로 + StartPtyReq 확장

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (StartPtyReq에 필드 추가)
- Modify: `apps/desktop/src/main/pty-manager.ts` (resume 분기)
- Test: `apps/desktop/src/main/pty-manager.resume.test.ts`

**Interfaces:**
- Consumes: `resumeCommand`, `findLatestSession`, `adapterFor` from `@apc/agents`; `AgentKind`.
- Produces: `PtyManager.start(...)`가 `req`에 `resume`가 있으면 resume argv로 spawn. 테스트를 위해 PtyManager에 의존성 주입 훅 추가:
  - `PtyManager` constructor 2번째 인자 `deps?: { resolveResume?: (agent: AgentKind, cwd: string) => Promise<{ command: string; args: string[] }> }`.

- [ ] **Step 1: Extend StartPtyReq (ipc-contract)**

```ts
// apps/desktop/src/shared/ipc-contract.ts — 기존 라인 교체
export type StartPtyReq = {
  id: string; command: string; args: string[]; cwd: string
  resume?: boolean            // true면 main이 resume argv를 구성(아래 agent 필요)
  agent?: 'claude' | 'codex' | 'opencode'
  sessionId?: string          // 알려진 세션 id(없으면 main이 최신 발견)
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/desktop/src/main/pty-manager.resume.test.ts
import { describe, test, expect, vi } from 'vitest'
import { PtyManager } from './pty-manager.js'

// node-pty를 가짜로 — spawn 인자를 캡처
vi.mock('@homebridge/node-pty-prebuilt-multiarch', () => {
  const spawn = vi.fn(() => ({ onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }))
  return { spawn, __spawn: spawn }
})

describe('PtyManager resume', () => {
  test('resume=true uses resolveResume to build the launched line', async () => {
    const resolveResume = vi.fn(async () => ({ command: 'claude', args: ['--resume', 'sid'] }))
    const writes: string[] = []
    const pm = new PtyManager(() => {}, { resolveResume })
    // start의 자동 입력 라인을 가로채기 위해 write를 감시: 가짜 pty.write 캡처
    const mod = await import('@homebridge/node-pty-prebuilt-multiarch') as any
    mod.__spawn.mockImplementation(() => ({
      onData() {}, onExit() {}, kill() {}, resize() {},
      write: (d: string) => writes.push(d),
    }))
    await pm.start('p1:claude', 'claude', [], '/repo/a', { resume: true, agent: 'claude' })
    expect(resolveResume).toHaveBeenCalledWith('claude', '/repo/a')
    // 셸에 타이핑되는 라인이 resume 명령이어야 한다
    await new Promise((r) => setTimeout(r, 700))
    expect(writes.join('')).toContain('claude --resume sid')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run apps/desktop/src/main/pty-manager.resume.test.ts`
Expected: FAIL — `start`는 5번째 인자/`deps`를 모른다(타입/런타임 에러).

- [ ] **Step 4: Implement resume branch in pty-manager**

`pty-manager.ts` 수정:
1. constructor에 deps 추가:

```ts
import { resumeCommand, findLatestSession, adapterFor } from '@apc/agents'
import type { AgentKind } from '@apc/shared'

type ResumeDeps = {
  resolveResume?: (agent: AgentKind, cwd: string) => Promise<{ command: string; args: string[] }>
}

export class PtyManager {
  private readonly resolveResume: NonNullable<ResumeDeps['resolveResume']>
  constructor(private readonly send: SendFn, deps: ResumeDeps = {}) {
    this.resolveResume = deps.resolveResume ?? (async (agent, cwd) => {
      const found = await findLatestSession(adapterFor(agent), cwd).catch(() => null)
      return resumeCommand(agent, { sessionId: found?.sessionId })
    })
  }
  // ...
```

2. `start` 시그니처에 opts 추가하고, 자동 입력 라인 구성 직전에 resume 반영:

```ts
  async start(
    id: string, command: string, args: string[], cwd: string,
    opts: { resume?: boolean; agent?: AgentKind } = {},
  ): Promise<void> {
    // ...기존 셸 spawn 로직 그대로...
    // 자동 입력 라인 구성 부분만 교체:
    let line = [command, ...args].filter(Boolean).join(' ').trim()
    if (opts.resume && opts.agent) {
      try {
        const r = await this.resolveResume(opts.agent, cwd)
        line = [r.command, ...r.args].join(' ').trim()
      } catch {
        this.send('pty:data', id, '[no prior session — fresh start]\r\n')
      }
    }
    if (line) {
      setTimeout(() => { try { p.write(line + '\r') } catch { /* shell closed */ } }, ssh ? 1500 : 500)
    }
```

(주의: `p`/`ssh` 변수는 기존 `start` 본문 스코프에 이미 있다. resolveResume await가 spawn 이후로 가도록 자동입력 블록만 옮긴다.)

- [ ] **Step 5: Update the ipcMain.on(ptyStart) call to pass opts**

```ts
// apps/desktop/src/main/index.ts — 기존:
//   ipcMain.on(CH.ptyStart, (_e, req) => { void pty.start(req.id, req.command, req.args, req.cwd) })
// 로 교체:
ipcMain.on(CH.ptyStart, (_e, req: StartPtyReq) => {
  void pty.start(req.id, req.command, req.args, req.cwd, { resume: req.resume, agent: req.agent })
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run apps/desktop/src/main/pty-manager.resume.test.ts`
Expected: PASS.

- [ ] **Step 7: Run existing pty/ipc tests for regressions**

Run: `pnpm vitest run apps/desktop/src/main/ipc.test.ts`
Expected: PASS (기존 start 호출은 opts 기본값으로 호환).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/pty-manager.ts apps/desktop/src/main/pty-manager.resume.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): pty-manager resume path + StartPtyReq resume fields"
```

---

### Task 5: desktop main — 종료 스냅샷 + 부팅 복원 IPC

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (SessionStore 생성, before-quit, 부팅 시 restore 전송)
- Modify: `apps/desktop/src/main/ipc.ts` (pane open/close 보고 + selected project 저장 핸들러)
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (workspace 채널 + 타입)

**Interfaces:**
- Consumes: `SessionStore` (Task 3), `findLatestSession`/`adapterFor` (Task 2), 기존 `db`(`apc.db`), `mainWindow.webContents`.
- Produces:
  - 채널 상수: `CH.workspaceRestore = 'workspace:restore'`(main→renderer), `CH.paneOpened = 'pane:opened'`, `CH.paneClosed = 'pane:closed'`, `CH.selectProject = 'workspace:select-project'`(renderer→main).
  - main→renderer payload: `WorkspaceRestore = { panes: Array<{ projectId: string; agent: AgentKind; lastSessionId: string | null }>; selectedProjectId: string | null }`.

- [ ] **Step 1: Add channels + types to ipc-contract**

```ts
// apps/desktop/src/shared/ipc-contract.ts (CH 객체에 추가, 타입 추가)
// CH 안에:
//   workspaceRestore: 'workspace:restore',
//   paneOpened: 'pane:opened',
//   paneClosed: 'pane:closed',
//   selectProject: 'workspace:select-project',
export type PaneRef = { projectId: string; agent: 'claude' | 'codex' | 'opencode' }
export type WorkspaceRestore = {
  panes: Array<PaneRef & { lastSessionId: string | null }>
  selectedProjectId: string | null
}
```

- [ ] **Step 2: Wire SessionStore + handlers in main (index.ts / ipc.ts)**

`index.ts`에서 기존 sqlite `db` 핸들 옆에 SessionStore를 만들고 ensureSchema, 핸들러 등록:

```ts
import { SessionStore } from './session-store.js'
import { adapterFor, findLatestSession } from '@apc/agents'
// db는 기존 better-sqlite3 인스턴스(컨테이너에서 생성). 동일 파일(apc.db)을 공유.
const sessions = new SessionStore(db)
sessions.ensureSchema()

// 렌더러가 패널을 열고/닫을 때 보고
ipcMain.on(CH.paneOpened, (_e, p: PaneRef) =>
  sessions.upsertPane({ projectId: p.projectId, agent: p.agent, wasOpen: true }))
ipcMain.on(CH.paneClosed, (_e, p: PaneRef) =>
  sessions.upsertPane({ projectId: p.projectId, agent: p.agent, wasOpen: false }))
ipcMain.on(CH.selectProject, (_e, id: string) => sessions.setState('selected_project_id', id))
```

- [ ] **Step 3: Snapshot on before-quit (capture latest session ids)**

```ts
// index.ts
app.on('before-quit', async () => {
  const open = sessions.listOpenPanes()
  for (const pane of open) {
    const repoPath = projectRepoPath(pane.projectId) // 기존 프로젝트 조회로 repoPath 해석
    if (!repoPath) continue
    const found = await findLatestSession(adapterFor(pane.agent as any), repoPath).catch(() => null)
    if (found) sessions.upsertPane({ projectId: pane.projectId, agent: pane.agent, lastSessionId: found.sessionId, wasOpen: true })
  }
})
```

(`projectRepoPath(projectId)`는 기존 프로젝트 저장소 조회 함수/쿼리를 사용. 컨테이너의 projects repo에서 `repoPath`를 읽는다.)

- [ ] **Step 4: Send restore on renderer ready**

```ts
// index.ts — mainWindow 로드 완료 후
mainWindow.webContents.on('did-finish-load', () => {
  const open = sessions.listOpenPanes()
  const payload: WorkspaceRestore = {
    panes: open.map((p) => ({ projectId: p.projectId, agent: p.agent as any, lastSessionId: p.lastSessionId })),
    selectedProjectId: sessions.getState('selected_project_id'),
  }
  mainWindow.webContents.send(CH.workspaceRestore, payload)
})
```

- [ ] **Step 5: Expose channels in preload + api**

`apps/desktop/src/preload/index.ts`에 `paneOpened/paneClosed/selectProject` send와 `onWorkspaceRestore(cb)` 구독을 추가하고, `apps/desktop/src/renderer/api.ts`에 대응 메서드를 추가(기존 `onPtyData` 패턴과 동일).

```ts
// preload (apc 객체에 추가)
paneOpened: (p: unknown) => ipcRenderer.send(CH.paneOpened, p),
paneClosed: (p: unknown) => ipcRenderer.send(CH.paneClosed, p),
selectProject: (id: string) => ipcRenderer.send(CH.selectProject, id),
onWorkspaceRestore: (cb: (p: unknown) => void) => {
  const h = (_e: unknown, p: unknown) => cb(p); ipcRenderer.on(CH.workspaceRestore, h)
  return () => ipcRenderer.removeListener(CH.workspaceRestore, h)
},
```

```ts
// api.ts (api 객체에 추가)
paneOpened(p: PaneRef): void { window.apc.paneOpened(p) },
paneClosed(p: PaneRef): void { window.apc.paneClosed(p) },
selectProject(id: string): void { window.apc.selectProject(id) },
onWorkspaceRestore(cb: (p: WorkspaceRestore) => void): () => void { return window.apc.onWorkspaceRestore(cb as any) },
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @apc/desktop exec tsc -p tsconfig.json --noEmit` (또는 repo의 typecheck 스크립트 `pnpm typecheck`).
Expected: 타입 에러 없음.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/main/ipc.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(desktop): snapshot workspace on quit + restore IPC on boot"
```

---

### Task 6: desktop renderer — 워크스페이스 하이드레이트 + AgentTerminal resume

**Files:**
- Modify: `apps/desktop/src/renderer/components/AgentTerminal.tsx` (resume props → startPty)
- Modify: `apps/desktop/src/renderer/App.tsx` (boot 시 onWorkspaceRestore로 패널 재오픈 + 선택 프로젝트 복원, pane open/close 보고)
- Modify: `apps/desktop/src/renderer/store.ts` (열린 패널/선택 프로젝트 상태 + 하이드레이트 액션)
- Test: `apps/desktop/src/renderer/workspace-restore.test.ts`

**Interfaces:**
- Consumes: `api.startPty`(확장됨), `api.onWorkspaceRestore`, `api.paneOpened/paneClosed/selectProject`, `WorkspaceRestore`.
- Produces: store에 `openPanes: Record<string, { agent: AgentKind; sessionId: string | null }>`(키 `${projectId}:${agent}`)와 `hydrateWorkspace(p: WorkspaceRestore): void`.

- [ ] **Step 1: Write the failing test (store hydration)**

```ts
// apps/desktop/src/renderer/workspace-restore.test.ts
import { describe, test, expect, beforeEach } from 'vitest'
import { useStore } from './store.js'

describe('hydrateWorkspace', () => {
  beforeEach(() => useStore.setState({ openPanes: {}, selectedProjectId: null } as any))
  test('opens saved panes with sessionId and restores selected project', () => {
    useStore.getState().hydrateWorkspace({
      panes: [{ projectId: 'p1', agent: 'claude', lastSessionId: 'sid' }],
      selectedProjectId: 'p1',
    })
    const s = useStore.getState()
    expect(s.openPanes['p1:claude']).toEqual({ agent: 'claude', sessionId: 'sid' })
    expect(s.selectedProjectId).toBe('p1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/desktop/src/renderer/workspace-restore.test.ts`
Expected: FAIL — `hydrateWorkspace`/`openPanes` 미정의.

- [ ] **Step 3: Add openPanes state + hydrateWorkspace to store**

```ts
// store.ts — ApcStore 타입에 추가
openPanes: Record<string, { agent: AgentType; sessionId: string | null }>
hydrateWorkspace(p: { panes: Array<{ projectId: string; agent: AgentType; lastSessionId: string | null }>; selectedProjectId: string | null }): void

// create(...) 초기값/구현에 추가
openPanes: {},
hydrateWorkspace(p) {
  const openPanes: Record<string, { agent: AgentType; sessionId: string | null }> = {}
  for (const pane of p.panes) openPanes[`${pane.projectId}:${pane.agent}`] = { agent: pane.agent, sessionId: pane.lastSessionId }
  set({ openPanes, selectedProjectId: p.selectedProjectId ?? get().selectedProjectId })
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/desktop/src/renderer/workspace-restore.test.ts`
Expected: PASS.

- [ ] **Step 5: AgentTerminal forwards resume to startPty**

```tsx
// AgentTerminal.tsx — props 확장
export type AgentTerminalProps = {
  sessionId: string; command: string; args: string[]; cwd: string
  agent?: 'claude' | 'codex' | 'opencode'
  resumeSessionId?: string | null   // null이면 최신 발견, undefined면 resume 안 함
  onStatus?: (s: AgentRunStatus) => void; onActivate?: () => void
}
// startPty 호출 교체:
api.startPty({
  id: sessionId, command, args, cwd,
  resume: props.agent != null && props.resumeSessionId !== undefined,
  agent: props.agent,
  sessionId: props.resumeSessionId ?? undefined,
})
```

- [ ] **Step 6: App.tsx — subscribe restore on boot, report open/close, pass resume**

```tsx
// App.tsx (effect, 최상위 한 번)
useEffect(() => {
  const off = api.onWorkspaceRestore((p) => useStore.getState().hydrateWorkspace(p))
  return off
}, [])
// 패널 렌더 시 (기존 ${pid}:${a} 매핑 자리):
//  - 패널 마운트되면 api.paneOpened({ projectId: pid, agent: a }) + AgentTerminal에 agent/resumeSessionId 전달
//  - 패널 닫힘/언마운트되면 api.paneClosed({ projectId: pid, agent: a })
//  - 프로젝트 선택 변경 시 api.selectProject(pid)
// resumeSessionId는 store.openPanes[`${pid}:${a}`]?.sessionId (복원된 패널이면 그 값, 아니면 undefined로 fresh)
```

- [ ] **Step 7: Typecheck + run renderer tests**

Run: `pnpm vitest run apps/desktop/src/renderer/workspace-restore.test.ts && pnpm typecheck`
Expected: PASS, 타입 에러 없음.

- [ ] **Step 8: Manual smoke (WSLg)**

Run: `bash run-desktop.sh` → 한 프로젝트에서 claude 패널 열고 대화 → 앱 닫기 → 다시 `bash run-desktop.sh` → 같은 패널이 자동으로 열리고 `claude --resume/--continue`로 이전 대화가 이어지는지 확인.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/AgentTerminal.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/workspace-restore.test.ts
git commit -m "feat(desktop): hydrate workspace on boot + AgentTerminal resume"
```

---

## Notes for the implementer

- `projectRepoPath(projectId)`(Task 5)와 `db` 핸들 위치는 `apps/desktop/src/main/container.ts`/`index.ts`의 기존 projects repository를 따른다 — 그 패턴을 그대로 사용(새 db 만들지 말 것, `apc.db` 공유).
- resume 플래그(Task 1 §Step 5)는 머지 전 반드시 실제 CLI로 검증.
- 모든 task는 Global Constraints를 암묵 포함.
