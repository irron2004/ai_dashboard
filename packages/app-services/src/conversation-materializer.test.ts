import { describe, expect, test } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NormalizedTurn, NormalizedSession } from '@apc/shared'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource } from '@apc/shared'
import { groupQaUnits, formatQaFile, sessionMatchesProject, materializeConversations } from './conversation-materializer.js'

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

  test('redacts secrets in tool input summaries', () => {
    const unit = {
      q: t({ role: 'user', text: 'q' }),
      answers: [t({ role: 'assistant', text: 'a', toolCalls: [{ name: 'Bash', input: { command: 'curl -H "Authorization: Bearer abc123SECRETtoken"' } }] })],
    }
    const out = formatQaFile(unit)
    expect(out).not.toContain('abc123SECRETtoken')
  })

  test('collapses multi-line commands into a single list line', () => {
    const unit = {
      q: t({ role: 'user', text: 'q' }),
      answers: [t({ role: 'assistant', text: 'a', toolCalls: [{ name: 'Bash', input: { command: 'line1\nline2' } }] })],
    }
    expect(formatQaFile(unit)).toContain('- Bash: line1 line2')
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
