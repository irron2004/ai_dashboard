# 대화 세션 → Q&A raw 청킹 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** claude/codex/opencode 세션을 현재 프로젝트 기준으로 골라 `raw/conversations/<engine>/<sessionId>/NNNq_a.txt` Q&A 단위 파일로 materialize하고, "전 문서로 위키 생성" 버튼의 materialize 단계에 통합한다.

**Architecture:** 기존 인제스트 어댑터(`@apc/agents`)를 재사용해 `NormalizedSession`을 얻고, app-services에 신설하는 `conversation-materializer.ts`(순수 함수 3개 + materializer 1개)가 Q&A 파일을 기록한다. `HarnessService.run`의 materialize 블록과 데스크톱 `container.ts`에 배선한다.

**Tech Stack:** TypeScript, vitest, Node fs. 신규 의존성 없음 (`@apc/agents`는 이미 app-services 의존성 — `generate-service.ts:1`과 동일한 `import type` 패턴 사용).

**Spec:** `docs/superpowers/specs/2026-06-11-conversation-qa-chunking-design.md`

**환경/검증 명령 (모든 태스크 공통):**
- 모든 Bash 앞에: `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"` 후 레포 루트(`/mnt/c/Users/irron/Downloads/ai_dashboard-main/ai_dashboard-main`)에서 실행. **Node 22 필수** (node:sqlite).
- 테스트: `pnpm vitest run <파일경로>` / 타입체크: 루트에서 `pnpm run typecheck`
- **`pnpm install` 금지** (Electron용 네이티브 빌드를 덮어씀). LF 줄바꿈 유지.

---

### Task 1: 순수 함수 3개 — groupQaUnits / formatQaFile / sessionMatchesProject

**Files:**
- Create: `packages/app-services/src/conversation-materializer.ts`
- Create: `packages/app-services/src/conversation-materializer.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/app-services/src/conversation-materializer.test.ts` 생성:

```ts
import { describe, expect, test } from 'vitest'
import type { NormalizedTurn, NormalizedSession } from '@apc/shared'
import { groupQaUnits, formatQaFile, sessionMatchesProject } from './conversation-materializer.js'

const t = (over: Partial<NormalizedTurn>): NormalizedTurn => ({ role: 'user', text: '', toolCalls: [], ...over })

describe('groupQaUnits', () => {
  test('groups Q-A-A-Q-A into 2 units', () => {
    const turns = [
      t({ role: 'user', text: 'q1' }),
      t({ role: 'assistant', text: 'a1' }),
      t({ role: 'assistant', text: 'a2' }),
      t({ role: 'user', text: 'q2' }),
      t({ role: 'assistant', text: 'a3' }),
    ]
    const units = groupQaUnits(turns)
    expect(units).toHaveLength(2)
    expect(units[0].q.text).toBe('q1')
    expect(units[0].answers.map((a) => a.text)).toEqual(['a1', 'a2'])
    expect(units[1].answers.map((a) => a.text)).toEqual(['a3'])
  })

  test('skips turns before the first real question (system preamble)', () => {
    const turns = [
      t({ role: 'system', text: 'sys' }),
      t({ role: 'assistant', text: 'banner' }),
      t({ role: 'user', text: 'q1' }),
      t({ role: 'assistant', text: 'a1' }),
    ]
    const units = groupQaUnits(turns)
    expect(units).toHaveLength(1)
    expect(units[0].answers.map((a) => a.text)).toEqual(['a1'])
  })

  test('empty-text user turn (tool_result carrier) joins current unit, not a new Q', () => {
    // claude jsonl: tool_result는 user role 메시지(text 없음, toolCalls만)로 도착한다
    const turns = [
      t({ role: 'user', text: 'q1' }),
      t({ role: 'assistant', text: 'a1', toolCalls: [{ name: 'Bash', input: { command: 'ls' } }] }),
      t({ role: 'user', text: '', toolCalls: [{ name: 'tool_result', resultText: 'big output' }] }),
      t({ role: 'assistant', text: 'a2' }),
    ]
    const units = groupQaUnits(turns)
    expect(units).toHaveLength(1)
    expect(units[0].answers).toHaveLength(3)
  })

  test('trailing unanswered user question still forms a unit', () => {
    const units = groupQaUnits([t({ role: 'user', text: 'q1' })])
    expect(units).toHaveLength(1)
    expect(units[0].answers).toHaveLength(0)
  })
})

describe('formatQaFile', () => {
  test('renders style-B markdown: Q + A + tools summary, tool_result excluded', () => {
    const unit = {
      q: t({ role: 'user', text: '버그 고쳐줘', timestamp: '2026-06-10T15:22:01Z' }),
      answers: [
        t({ role: 'assistant', text: '원인은 X입니다. 고쳤습니다.', toolCalls: [
          { name: 'Edit', input: { file_path: 'src/a.ts' } },
          { name: 'Bash', input: { command: 'pnpm vitest run src/a.test.ts' }, isError: true },
          { name: 'tool_result', resultText: 'NOISE-MUST-NOT-APPEAR' },
        ] }),
      ],
    }
    const out = formatQaFile(unit)
    expect(out).toContain('## Q (user, 2026-06-10T15:22:01Z)')
    expect(out).toContain('버그 고쳐줘')
    expect(out).toContain('## A (assistant)')
    expect(out).toContain('원인은 X입니다')
    expect(out).toContain('### tools')
    expect(out).toContain('- Edit src/a.ts')
    expect(out).toContain('- Bash: pnpm vitest run src/a.test.ts (error)')
    expect(out).not.toContain('NOISE-MUST-NOT-APPEAR')
    expect(out).not.toContain('tool_result')
  })

  test('omits timestamp when absent; truncates long Bash commands to 80 chars', () => {
    const unit = {
      q: t({ role: 'user', text: 'q' }),
      answers: [t({ role: 'assistant', text: 'a', toolCalls: [{ name: 'Bash', input: { command: 'x'.repeat(200) } }] })],
    }
    const out = formatQaFile(unit)
    expect(out).toContain('## Q (user)\n')
    expect(out).toContain(`- Bash: ${'x'.repeat(80)}`)
    expect(out).not.toContain('x'.repeat(81))
  })

  test('unanswered unit renders the no-answer marker and no tools section', () => {
    const out = formatQaFile({ q: t({ role: 'user', text: 'q' }), answers: [] })
    expect(out).toContain('## A (no answer recorded)')
    expect(out).not.toContain('### tools')
  })

  test('unknown tool names render as bare name', () => {
    const unit = { q: t({ role: 'user', text: 'q' }), answers: [t({ role: 'assistant', text: 'a', toolCalls: [{ name: 'WebSearch' }] })] }
    expect(formatQaFile(unit)).toContain('- WebSearch')
  })
})

const sess = (over: Partial<NormalizedSession>): NormalizedSession => ({
  id: 's1', agentType: 'claude', turns: [], filesTouched: [],
  sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
  ...over,
})

describe('sessionMatchesProject', () => {
  test('matches Windows path against WSL path (C:\\ ↔ /mnt/c/)', () => {
    expect(sessionMatchesProject(sess({ repoPath: 'C:\\Users\\me\\proj' }), ['/mnt/c/Users/me/proj'])).toBe(true)
    expect(sessionMatchesProject(sess({ repoPath: '/mnt/c/users/me/proj' }), ['C:\\Users\\Me\\proj\\'])).toBe(true)
  })
  test('matches a session run in a subdirectory of the repo', () => {
    expect(sessionMatchesProject(sess({ repoPath: '/mnt/c/u/proj/apps/desktop' }), ['/mnt/c/u/proj'])).toBe(true)
  })
  test('rejects unrelated paths and prefix-lookalikes', () => {
    expect(sessionMatchesProject(sess({ repoPath: '/mnt/c/u/other' }), ['/mnt/c/u/proj'])).toBe(false)
    expect(sessionMatchesProject(sess({ repoPath: '/mnt/c/u/proj2' }), ['/mnt/c/u/proj'])).toBe(false)
  })
  test('skips ssh:// repoPaths and sessions without any path', () => {
    expect(sessionMatchesProject(sess({ repoPath: '/home/me/proj' }), ['ssh://me@host:22/home/me/proj'])).toBe(false)
    expect(sessionMatchesProject(sess({}), ['/mnt/c/u/proj'])).toBe(false)
  })
  test('falls back to worktreePath when repoPath is absent', () => {
    expect(sessionMatchesProject(sess({ worktreePath: '/mnt/c/u/proj/.worktrees/x' }), ['/mnt/c/u/proj'])).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/app-services/src/conversation-materializer.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/app-services/src/conversation-materializer.ts` 생성 (Task 2에서 materializer가 추가될 파일 — 이번 태스크는 순수 함수 3개와 타입만):

```ts
import type { NormalizedSession, NormalizedTurn, NormalizedToolCall } from '@apc/shared'

export type QaUnit = { q: NormalizedTurn; answers: NormalizedTurn[] }
export type ConversationManifest = { sessions: number; files: number; skipped: string[] }

/**
 * 시간순 turn들을 Q&A 단위로 묶는다. 새 단위는 "텍스트가 있는 user turn"에서만 시작한다 —
 * claude jsonl에서 tool_result는 user role 메시지(빈 text + toolCalls)로 도착하므로,
 * 빈 텍스트 user turn은 새 질문이 아니라 현재 단위의 answers에 합류시킨다.
 * 첫 질문 이전의 turn(system 프리앰블 등)은 위키 근거가 아니므로 버린다.
 */
export function groupQaUnits(turns: NormalizedTurn[]): QaUnit[] {
  const units: QaUnit[] = []
  let current: QaUnit | null = null
  for (const turn of turns) {
    if (turn.role === 'user' && turn.text.trim()) {
      current = { q: turn, answers: [] }
      units.push(current)
    } else if (current) {
      current.answers.push(turn)
    }
  }
  return units
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read'])

/** 툴콜 1개를 "무엇을 했는지" 한 줄로. tool_result(원 호출에 이미 표시됨)는 null → 제외. */
function summarizeToolCall(call: NormalizedToolCall): string | null {
  if (call.name === 'tool_result') return null
  const input = (call.input ?? {}) as Record<string, unknown>
  let line: string
  if (FILE_TOOLS.has(call.name) && typeof input.file_path === 'string') line = `${call.name} ${input.file_path}`
  else if (call.name === 'Bash' && typeof input.command === 'string') line = `Bash: ${input.command.slice(0, 80)}`
  else line = call.name
  return call.isError ? `${line} (error)` : line
}

/** 스타일 B: Q 전문 + A 텍스트 + `### tools` 요약. tool_result 본문(노이즈)은 싣지 않는다. */
export function formatQaFile(unit: QaUnit): string {
  const qHeader = unit.q.timestamp ? `## Q (user, ${unit.q.timestamp})` : '## Q (user)'
  const parts: string[] = [qHeader, '', unit.q.text.trim(), '']
  if (unit.answers.length === 0) {
    parts.push('## A (no answer recorded)', '')
    return parts.join('\n')
  }
  const aTexts = unit.answers.map((a) => a.text.trim()).filter(Boolean)
  parts.push('## A (assistant)', '', aTexts.length ? aTexts.join('\n\n') : '(no text)', '')
  const tools = unit.answers.flatMap((a) => a.toolCalls.map(summarizeToolCall)).filter((l): l is string => l !== null)
  if (tools.length) parts.push('### tools', ...tools.map((l) => `- ${l}`), '')
  return parts.join('\n')
}

/** 드라이브 표기(C:\)·역슬래시·대소문자·트레일링 슬래시를 정규화해 비교 가능하게. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/^([a-z]):\//, '/mnt/$1/').replace(/\/+$/, '')
}

/** 세션의 작업 디렉터리(repoPath, 없으면 worktreePath)가 프로젝트 repoPath와 같거나 그 하위면 매칭. */
export function sessionMatchesProject(session: NormalizedSession, repoPaths: string[]): boolean {
  const candidate = session.repoPath ?? session.worktreePath
  if (!candidate) return false
  const c = normalizePath(candidate)
  for (const repoPath of repoPaths) {
    if (repoPath.startsWith('ssh://')) continue
    const r = normalizePath(repoPath)
    if (c === r || c.startsWith(`${r}/`)) return true
  }
  return false
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/app-services/src/conversation-materializer.test.ts`
Expected: 13/13 PASS.

- [ ] **Step 5: 타입체크 + 커밋**

Run: `pnpm run typecheck` → exit 0.

```bash
git add packages/app-services/src/conversation-materializer.ts packages/app-services/src/conversation-materializer.test.ts
git commit -m "feat(app-services): Q&A grouping/formatting/path-matching for conversation chunking"
```

---

### Task 2: materializeConversations

**Files:**
- Modify: `packages/app-services/src/conversation-materializer.ts` (함수 추가)
- Modify: `packages/app-services/src/conversation-materializer.test.ts` (describe 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

테스트 파일 상단 import에 추가:

```ts
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource } from '@apc/shared'
import { materializeConversations } from './conversation-materializer.js'
```

파일 끝에 describe 추가:

```ts
function fakeAdapter(kind: 'claude' | 'codex', sessions: NormalizedSession[]): AgentIngestAdapter {
  const sources = sessions.map((s, i) => ({
    id: `${kind}:${i}`, agentKind: kind, kind: 'jsonl-file', locator: `/fake/${i}`, discoveredAt: '2026-06-11T00:00:00Z',
  } as AgentSource))
  return {
    agentKind: kind,
    discoverSources: async () => sources,
    parseSource: async (src) => ({ session: sessions[Number(src.id.split(':')[1])], position: '' }),
  }
}

describe('materializeConversations', () => {
  const repo = '/mnt/c/u/proj'
  const mkSession = (id: string, over: Partial<NormalizedSession> = {}): NormalizedSession => sess({
    id, repoPath: repo, endedAt: '2026-06-10T00:00:00Z',
    turns: [t({ role: 'user', text: `q-${id}` }), t({ role: 'assistant', text: `a-${id}` })],
    ...over,
  })

  test('writes NNNq_a.txt only for sessions matching the project', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'conv-'))
    const adapter = fakeAdapter('claude', [
      mkSession('match-1'),
      mkSession('other', { repoPath: '/mnt/c/u/elsewhere' }),
    ])
    const m = await materializeConversations({ adapters: [adapter], repoPaths: [repo], vaultRoot: vault })
    expect(m.sessions).toBe(1)
    expect(m.files).toBe(1)
    const file = join(vault, 'raw', 'conversations', 'claude', 'match-1', '001q_a.txt')
    expect(readFileSync(file, 'utf8')).toContain('q-match-1')
    expect(existsSync(join(vault, 'raw', 'conversations', 'claude', 'other'))).toBe(false)
  })

  test('numbers multiple Q&A units 001, 002 in turn order', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'conv-'))
    const s = mkSession('s1', { turns: [
      t({ role: 'user', text: 'first' }), t({ role: 'assistant', text: 'a1' }),
      t({ role: 'user', text: 'second' }), t({ role: 'assistant', text: 'a2' }),
    ] })
    await materializeConversations({ adapters: [fakeAdapter('claude', [s])], repoPaths: [repo], vaultRoot: vault })
    const dir = join(vault, 'raw', 'conversations', 'claude', 's1')
    expect(readdirSync(dir).sort()).toEqual(['001q_a.txt', '002q_a.txt'])
    expect(readFileSync(join(dir, '001q_a.txt'), 'utf8')).toContain('first')
    expect(readFileSync(join(dir, '002q_a.txt'), 'utf8')).toContain('second')
  })

  test('is idempotent: previous output is removed on re-run', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'conv-'))
    await materializeConversations({ adapters: [fakeAdapter('claude', [mkSession('old')])], repoPaths: [repo], vaultRoot: vault })
    await materializeConversations({ adapters: [fakeAdapter('claude', [mkSession('new')])], repoPaths: [repo], vaultRoot: vault })
    const root = join(vault, 'raw', 'conversations', 'claude')
    expect(readdirSync(root)).toEqual(['new'])
  })

  test('keeps only the newest maxSessions sessions by endedAt', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'conv-'))
    const sessions = [
      mkSession('oldest', { endedAt: '2026-06-01T00:00:00Z' }),
      mkSession('newest', { endedAt: '2026-06-10T00:00:00Z' }),
      mkSession('middle', { endedAt: '2026-06-05T00:00:00Z' }),
    ]
    const m = await materializeConversations({ adapters: [fakeAdapter('claude', sessions)], repoPaths: [repo], vaultRoot: vault, maxSessions: 2 })
    expect(m.sessions).toBe(2)
    expect(readdirSync(join(vault, 'raw', 'conversations', 'claude')).sort()).toEqual(['middle', 'newest'])
  })

  test('adapter failures are recorded as skipped, never thrown', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'conv-'))
    const broken: AgentIngestAdapter = {
      agentKind: 'codex',
      discoverSources: async () => { throw new Error('db locked') },
      parseSource: async () => { throw new Error('unreachable') },
    }
    const m = await materializeConversations({ adapters: [broken, fakeAdapter('claude', [mkSession('ok')])], repoPaths: [repo], vaultRoot: vault })
    expect(m.skipped.some((s) => s.includes('db locked'))).toBe(true)
    expect(m.files).toBe(1)
  })

  test('sanitizes unsafe session ids for directory names', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'conv-'))
    await materializeConversations({ adapters: [fakeAdapter('claude', [mkSession('a/b:c d')])], repoPaths: [repo], vaultRoot: vault })
    expect(readdirSync(join(vault, 'raw', 'conversations', 'claude'))).toEqual(['a_b_c_d'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/app-services/src/conversation-materializer.test.ts`
Expected: 신규 6개 FAIL (`materializeConversations` 미정의), 기존 13개 PASS.

- [ ] **Step 3: 구현**

`conversation-materializer.ts` 상단 import 교체/추가:

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentIngestAdapter } from '@apc/agents'
import type { NormalizedSession, NormalizedTurn, NormalizedToolCall } from '@apc/shared'
```

파일 끝에 추가:

```ts
/**
 * 현재 프로젝트에서 진행된 에이전트 세션을 Q&A 단위 파일로 materialize한다:
 * `<vaultRoot>/raw/conversations/<engine>/<sessionId>/NNNq_a.txt`.
 * 멱등(시작 시 conversations/ 전체 삭제 — materializeProjectDocs와 동일 패턴),
 * 어댑터/세션/파일 단위 실패는 skipped에 기록하고 계속한다(절대 run을 죽이지 않음).
 * 인제스트 커서와 독립적으로 항상 전체 세션을 보도록 cursorFor는 undefined를 돌려준다.
 * SourceReader가 raw/ 전체를 LLM 입력으로 넣으므로 최신 maxSessions개만 유지한다.
 */
export async function materializeConversations(opts: {
  adapters: AgentIngestAdapter[]
  repoPaths: string[]
  vaultRoot: string
  maxSessions?: number
}): Promise<ConversationManifest> {
  const destRoot = join(opts.vaultRoot, 'raw', 'conversations')
  rmSync(destRoot, { recursive: true, force: true })
  const skipped: string[] = []
  const matched: NormalizedSession[] = []
  for (const adapter of opts.adapters) {
    let sources
    try { sources = await adapter.discoverSources(() => undefined) }
    catch (e) { skipped.push(`${adapter.agentKind}: discover failed: ${String(e)}`); continue }
    for (const source of sources) {
      try {
        const { session } = await adapter.parseSource(source)
        if (sessionMatchesProject(session, opts.repoPaths)) matched.push(session)
      } catch (e) { skipped.push(`${source.id}: parse failed: ${String(e)}`) }
    }
  }
  matched.sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
  const taken = matched.slice(0, opts.maxSessions ?? 10)
  let files = 0
  const usedDirs = new Set<string>()
  for (const session of taken) {
    const safeId = session.id.replace(/[^A-Za-z0-9._-]/g, '_')
    let dirName = safeId
    for (let n = 2; usedDirs.has(`${session.agentType}/${dirName}`); n++) dirName = `${safeId}-${n}`
    usedDirs.add(`${session.agentType}/${dirName}`)
    const dir = join(destRoot, session.agentType, dirName)
    groupQaUnits(session.turns).forEach((unit, i) => {
      const abs = join(dir, `${String(i + 1).padStart(3, '0')}q_a.txt`)
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(abs, formatQaFile(unit))
        files++
      } catch (e) { skipped.push(`${abs}: write failed: ${String(e)}`) }
    })
  }
  return { sessions: taken.length, files, skipped }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/app-services/src/conversation-materializer.test.ts`
Expected: 19/19 PASS.

- [ ] **Step 5: 타입체크 + 커밋**

Run: `pnpm run typecheck` → exit 0.

```bash
git add packages/app-services/src/conversation-materializer.ts packages/app-services/src/conversation-materializer.test.ts
git commit -m "feat(app-services): materializeConversations writes project sessions as Q&A raw files"
```

---

### Task 3: HarnessService 배선

**Files:**
- Modify: `packages/app-services/src/harness-service.ts`
- Modify: `packages/app-services/src/harness-service.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`harness-service.test.ts` — 상단 import에 추가 (기존 import와 병합, 중복 금지):

```ts
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession } from '@apc/shared'
```

파일 끝에 describe 추가:

```ts
describe('HarnessService conversation materialization', () => {
  test('materialize:true with conversationAdapters writes raw/conversations Q&A files', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-conv-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const repo = join(tmp, 'repo'); mkdirSync(repo, { recursive: true })
    const session: NormalizedSession = {
      id: 'sess-1', agentType: 'claude', repoPath: repo, endedAt: '2026-06-11T00:00:00Z',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
      turns: [
        { role: 'user', text: '질문', toolCalls: [], uuid: undefined, timestamp: undefined },
        { role: 'assistant', text: '답변', toolCalls: [], uuid: undefined, timestamp: undefined },
      ],
      filesTouched: [],
    }
    const adapter: AgentIngestAdapter = {
      agentKind: 'claude',
      discoverSources: async () => [{ id: 'claude:0', agentKind: 'claude', kind: 'jsonl-file', locator: '/x', discoveredAt: '2026-06-11T00:00:00Z' } as AgentSource],
      parseSource: async () => ({ session, position: '' }),
    }
    const svc = new HarnessService({ runner: new FakeAgentRunner([]), vaultRoot, runsRoot: join(tmp, 'runs'), conversationAdapters: [adapter] })
    await svc.run({ projectId: 'p1', engine: 'codex', materialize: true, repoPaths: [repo] })
    const file = join(vaultRoot, 'raw', 'conversations', 'claude', 'sess-1', '001q_a.txt')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('질문')
  })

  test('materialize:true without adapters still works (backward compatible)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-noconv-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const repo = join(tmp, 'repo'); mkdirSync(repo, { recursive: true })
    const svc = new HarnessService({ runner: new FakeAgentRunner([]), vaultRoot, runsRoot: join(tmp, 'runs') })
    const res = await svc.run({ projectId: 'p1', engine: 'codex', materialize: true, repoPaths: [repo] })
    expect(res.runId).toBeTruthy()
    expect(existsSync(join(vaultRoot, 'raw', 'conversations'))).toBe(false)
  })
})
```

(이 테스트 파일에는 `mkdtempSync`/`mkdirSync`/`existsSync`/`readFileSync`/`tmpdir`/`join`/`FakeAgentRunner`/`HarnessService`가 이미 import돼 있음 — 확인 후 없는 것만 추가.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/app-services/src/harness-service.test.ts`
Expected: 신규 1번 테스트 FAIL (`conversationAdapters`가 deps 타입에 없음 — 타입 에러로 먼저 드러날 수 있음).

- [ ] **Step 3: 구현**

`harness-service.ts`:

(a) import 추가:

```ts
import type { AgentIngestAdapter } from '@apc/agents'
import { materializeConversations } from './conversation-materializer.js'
```

(b) `HarnessServiceDeps`에 필드 추가 (`runner: AgentRunner` 아래):

```ts
  /** 대화 세션 → Q&A raw 청킹에 쓸 인제스트 어댑터들 (없으면 청킹 생략). */
  conversationAdapters?: AgentIngestAdapter[]
```

(c) `run()`의 materialize 블록을 다음으로 교체:

```ts
    if (input.materialize && input.repoPaths?.length) {
      materializeProjectDocs(input.repoPaths, this.deps.vaultRoot)
      if (this.deps.conversationAdapters?.length) {
        await materializeConversations({
          adapters: this.deps.conversationAdapters,
          repoPaths: input.repoPaths,
          vaultRoot: this.deps.vaultRoot,
        })
      }
    }
```

- [ ] **Step 4: 테스트 통과 + 패키지 회귀**

Run: `pnpm vitest run packages/app-services` → 전부 PASS.

- [ ] **Step 5: 타입체크 + 커밋**

Run: `pnpm run typecheck` → exit 0.

```bash
git add packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.test.ts
git commit -m "feat(app-services): chunk project conversations into raw/ during harness materialize"
```

---

### Task 4: 데스크톱 컨테이너 주입 + 전체 회귀 + push

**Files:**
- Modify: `apps/desktop/src/main/container.ts`

- [ ] **Step 1: 컨테이너 주입**

`container.ts`의 HarnessService 생성부(현재 ~205행):

```ts
  const harness = new HarnessService({
    runner: opts.agentRunner ?? new RoutingAgentRunner(),
    vaultRoot: opts.vaultRoot,
    runsRoot: opts.harnessRunsRoot ?? join(opts.vaultRoot, '..', 'apc-harness-runs'),
  })
```

를 다음으로 교체 (`ingestAdapters`는 153행에서 이미 정의됨 — 선언 순서상 HarnessService보다 앞):

```ts
  const harness = new HarnessService({
    runner: opts.agentRunner ?? new RoutingAgentRunner(),
    vaultRoot: opts.vaultRoot,
    runsRoot: opts.harnessRunsRoot ?? join(opts.vaultRoot, '..', 'apc-harness-runs'),
    // "전 문서로 위키 생성"의 materialize 단계가 이 프로젝트의 에이전트 대화도 Q&A 단위로 청킹하도록.
    conversationAdapters: ingestAdapters,
  })
```

- [ ] **Step 2: 전체 회귀**

Run: `pnpm vitest run` (루트, packages 전체) → 전부 PASS.
Run: `pnpm --filter @apc/desktop exec vitest run` → 전부 PASS.
Run: `pnpm run typecheck` → exit 0.

- [ ] **Step 3: 커밋 + push**

```bash
git add apps/desktop/src/main/container.ts
git commit -m "feat(desktop): wire ingest adapters into harness conversation chunking"
git push origin main
```

- [ ] **Step 4: 수동 검증 (사용자)**

앱 재시작 → "전 문서로 위키 생성" 클릭 → `<vault>/raw/conversations/claude/<session>/001q_a.txt`들이 생기고, 위키 evidence가 해당 파일 경로를 인용하는지 확인.
