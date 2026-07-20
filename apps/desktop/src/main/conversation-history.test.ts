import { describe, expect, test } from 'vitest'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession } from '@apc/shared'
import { latestConversationQuestion, loadConversationHistory, toConversationSession } from './conversation-history.js'

function session(id: string, repoPath: string, endedAt: string, question = `질문 ${id}`): NormalizedSession {
  return {
    id,
    agentType: 'codex',
    repoPath,
    startedAt: endedAt,
    endedAt,
    sourceMeta: { provider: 'codex', sourceKind: 'jsonl-file', rawLocator: `/sessions/${id}.jsonl`, sessionHeader: {} },
    turns: [
      { role: 'user', text: question, timestamp: endedAt, toolCalls: [] },
      { role: 'assistant', text: `${id} 첫 답변`, toolCalls: [] },
      { role: 'assistant', text: `${id} 둘째 답변`, toolCalls: [] },
    ],
    filesTouched: [],
  }
}

function adapter(rows: Array<{ source: AgentSource; session?: NormalizedSession; error?: Error }>): AgentIngestAdapter {
  return {
    agentKind: 'codex',
    async discoverSources() { return rows.map((row) => row.source) },
    async parseSource(source) {
      const row = rows.find((candidate) => candidate.source.id === source.id)!
      if (row.error) throw row.error
      return { session: row.session!, position: '{}' }
    },
  }
}

describe('conversation history', () => {
  test('groups assistant messages under a human question and detaches internal prompt responses', () => {
    const view = toConversationSession({
      ...session('s1', '/work/apc', '2026-07-15T10:00:00Z', '첫 질문'),
      turns: [
        { role: 'user', text: '첫 질문', uuid: 'q1', timestamp: '2026-07-15T10:01:00Z', toolCalls: [] },
        { role: 'assistant', text: '첫 답', toolCalls: [] },
        {
          role: 'user',
          text: '# Knowledge Harness Rules\n\n## Role: wiki-graph-lead\n\n## Input\n{}\n\n## Output\nRespond with ONLY a single JSON object',
          toolCalls: [],
        },
        { role: 'assistant', text: '{"internal":true}', toolCalls: [] },
        { role: 'user', text: '둘째 질문', uuid: 'q2', timestamp: '2026-07-15T10:05:00Z', toolCalls: [] },
        { role: 'assistant', text: '둘째 답', toolCalls: [] },
      ],
    })

    expect(view.exchanges).toEqual([
      { id: 'q2', askedAt: '2026-07-15T10:05:00Z', question: '둘째 질문', answer: '둘째 답' },
      { id: 'q1', askedAt: '2026-07-15T10:01:00Z', question: '첫 질문', answer: '첫 답' },
    ])
    expect(view.preview).toBe('둘째 질문')
  })

  test('keeps resume-visible sessions even when they contain no human question', () => {
    const view = toConversationSession({
      ...session('internal', '/work/apc', '2026-07-15T10:00:00Z'),
      turns: [
        {
          role: 'user',
          text: '# Knowledge Harness Rules\n\n## Role: wiki-graph-lead\n\n## Input\n{}\n\n## Output\nRespond with ONLY a single JSON object',
          toolCalls: [],
        },
        { role: 'assistant', text: '{"ok":true}', toolCalls: [] },
      ],
    })

    expect(view.preview).toBe('사용자 질문 없음')
    expect(view.exchanges).toEqual([])
  })

  test('selects the newest transcript question globally or for an exact resume session', () => {
    const history = {
      sessions: [
        { id: 'new', agent: 'codex' as const, preview: 'newest', exchanges: [{ id: 'q-new', question: 'newest', answer: null }] },
        { id: 'target', agent: 'codex' as const, preview: 'target', exchanges: [{ id: 'q-target', askedAt: '2026-07-15T10:00:00Z', question: 'target question', answer: null }] },
      ],
    }
    expect(latestConversationQuestion(history)).toEqual({ sessionId: 'new', exchangeId: 'q-new', text: 'newest', askedAt: undefined })
    expect(latestConversationQuestion(history, 'target')).toEqual({
      sessionId: 'target', exchangeId: 'q-target', text: 'target question', askedAt: '2026-07-15T10:00:00Z',
    })
    expect(latestConversationQuestion(history, 'missing')).toBeUndefined()
  })

  test('reads the selected agent live sources, filters the project, and sorts sessions newest-first', async () => {
    const rows = [
      {
        source: { id: 'new', agentKind: 'codex', kind: 'jsonl-file', locator: '/new', mtimeMs: 30 },
        session: session('new', '/work/apc/subdir', '2026-07-15T12:00:00Z'),
      },
      {
        source: { id: 'old', agentKind: 'codex', kind: 'jsonl-file', locator: '/old', repoPath: '/work/apc', mtimeMs: 20 },
        session: session('old', '/work/apc', '2026-07-14T12:00:00Z'),
      },
      {
        source: { id: 'other', agentKind: 'codex', kind: 'jsonl-file', locator: '/other', repoPath: '/work/other', mtimeMs: 40 },
        session: session('other', '/work/other', '2026-07-16T12:00:00Z'),
      },
      {
        source: { id: 'broken', agentKind: 'codex', kind: 'jsonl-file', locator: '/broken', mtimeMs: 10 },
        error: new Error('bad jsonl'),
      },
    ] satisfies Array<{ source: AgentSource; session?: NormalizedSession; error?: Error }>

    const result = await loadConversationHistory({
      adapters: [adapter(rows)],
      projectId: 'p1',
      repoPaths: ['/work/apc'],
      agent: 'codex',
      includeOlder: true,
    })

    expect(result.sessions.map((item) => item.id)).toEqual(['new', 'old'])
    expect(result.sessions[0].exchanges[0].answer).toBe('new 첫 답변\n\nnew 둘째 답변')
    expect(result.scannedSources).toBe(3)
    expect(result.skippedSources).toBe(1)
    expect(result.truncated).toBe(false)
  })

  test('caps returned sessions without mixing in another agent', async () => {
    const rows = ['one', 'two'].map((id, index) => ({
      source: { id, agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: `/${id}`, mtimeMs: index + 1 },
      session: session(id, '/work/apc', `2026-07-1${index + 1}T12:00:00Z`),
    }))
    const claude: AgentIngestAdapter = { agentKind: 'claude', discoverSources: async () => [], parseSource: async () => { throw new Error('unused') } }
    const result = await loadConversationHistory({
      adapters: [claude, adapter(rows)], projectId: 'p1', repoPaths: ['/work/apc'], agent: 'codex', includeOlder: true, limit: 1,
    })
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].id).toBe('two')
    expect(result.truncated).toBe(true)
  })

  test('shows only the recent three days first, then returns every older matching session', async () => {
    const rows = [
      {
        source: { id: 'recent', agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: '/recent', mtimeMs: Date.parse('2026-07-15T12:00:00Z') },
        session: session('recent', '/work/apc', '2026-07-15T12:00:00Z'),
      },
      {
        source: { id: 'boundary', agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: '/boundary', mtimeMs: Date.parse('2026-07-13T12:00:00Z') },
        session: session('boundary', '/work/apc', '2026-07-13T12:00:00Z'),
      },
      {
        source: { id: 'older', agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: '/older', mtimeMs: Date.parse('2026-07-12T12:00:00Z') },
        session: session('older', '/work/apc', '2026-07-12T12:00:00Z'),
      },
    ]
    const base = {
      adapters: [adapter(rows)], projectId: 'p1', repoPaths: ['/work/apc'], agent: 'codex' as const,
      nowMs: Date.parse('2026-07-16T12:00:00Z'),
    }

    const recent = await loadConversationHistory(base)
    expect(recent.sessions.map((item) => item.id)).toEqual(['recent', 'boundary'])
    expect(recent.truncated).toBe(true)

    const all = await loadConversationHistory({ ...base, includeOlder: true })
    expect(all.sessions.map((item) => item.id)).toEqual(['recent', 'boundary', 'older'])
    expect(all.truncated).toBe(false)
  })

  test('sorts by transcript time instead of the local cache write time', async () => {
    const rows = [
      {
        source: {
          id: 'newer-session', agentKind: 'codex' as const, kind: 'jsonl-file' as const,
          locator: '/newer-session', mtimeMs: Date.parse('2026-07-16T11:00:00Z'),
        },
        session: session('newer-session', '/work/apc', '2026-07-15T12:00:00Z'),
      },
      {
        source: {
          id: 'older-session', agentKind: 'codex' as const, kind: 'jsonl-file' as const,
          locator: '/older-session', mtimeMs: Date.parse('2026-07-16T12:00:00Z'),
        },
        session: session('older-session', '/work/apc', '2026-07-14T12:00:00Z'),
      },
    ]

    const result = await loadConversationHistory({
      adapters: [adapter(rows)], projectId: 'p1', repoPaths: ['/work/apc'], agent: 'codex', includeOlder: true,
    })

    expect(result.sessions.map((item) => item.id)).toEqual(['newer-session', 'older-session'])
  })

  test('does not cap the full resume-compatible result at 200 sources', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      source: {
        id: `session-${index}`, agentKind: 'codex' as const, kind: 'jsonl-file' as const,
        locator: `/session-${index}`, repoPath: '/work/apc', mtimeMs: index,
      },
      session: session(`session-${index}`, '/work/apc', '2026-07-15T12:00:00Z'),
    }))

    const result = await loadConversationHistory({
      adapters: [adapter(rows)], projectId: 'p1', repoPaths: ['/work/apc'], agent: 'codex', includeOlder: true,
    })

    expect(result.sessions).toHaveLength(205)
    expect(result.scannedSources).toBe(205)
    expect(result.truncated).toBe(false)
  })

  test('merges the same agent sessions from Windows and WSL stores', async () => {
    const windows = adapter([{
      source: {
        id: 'windows', agentKind: 'codex', kind: 'jsonl-file', locator: 'C:\\sessions\\windows.jsonl',
        repoPath: 'C:\\Users\\Me\\work\\apc', mtimeMs: 10,
      },
      session: session('windows', 'C:\\Users\\Me\\work\\apc', '2026-07-14T12:00:00Z'),
    }])
    const wsl = adapter([{
      source: {
        id: 'wsl', agentKind: 'codex', kind: 'jsonl-file', locator: '/tmp/wsl.jsonl',
        repoPath: '/mnt/c/Users/Me/work/apc/apps/desktop', mtimeMs: 20,
      },
      session: session('wsl', '/mnt/c/Users/Me/work/apc/apps/desktop', '2026-07-15T12:00:00Z'),
    }])

    const result = await loadConversationHistory({
      adapters: [windows, wsl],
      projectId: 'p1',
      repoPaths: ['C:\\Users\\me\\work\\apc'],
      agent: 'codex',
      includeOlder: true,
    })

    expect(result.sessions.map((item) => item.id)).toEqual(['wsl', 'windows'])
    expect(result.scannedSources).toBe(2)
  })

  test('matches the Codex resume picker by excluding subagent and exec sessions', async () => {
    const withCodexMeta = (
      value: NormalizedSession,
      sessionMeta: Record<string, unknown>,
    ): NormalizedSession => ({
      ...value,
      sourceMeta: {
        ...value.sourceMeta,
        sessionHeader: { ...value.sourceMeta.sessionHeader, sessionMeta },
      },
    })
    const rows = [
      {
        source: { id: 'interactive', agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: '/interactive', mtimeMs: 40 },
        session: withCodexMeta(session('interactive', '/work/apc', '2026-07-16T12:00:00Z'), {
          source: 'cli', thread_source: 'user', originator: 'codex-tui',
        }),
      },
      {
        source: { id: 'subagent', agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: '/subagent', mtimeMs: 30 },
        session: withCodexMeta(session('subagent', '/work/apc', '2026-07-16T11:00:00Z'), {
          source: { subagent: { thread_spawn: { parent_thread_id: 'interactive' } } },
          thread_source: 'subagent', originator: 'codex-tui',
        }),
      },
      {
        source: { id: 'exec', agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: '/exec', mtimeMs: 20 },
        session: withCodexMeta(session('exec', '/work/apc', '2026-07-16T10:00:00Z'), {
          source: 'exec', thread_source: 'user', originator: 'codex_exec',
        }),
      },
      {
        source: { id: 'legacy', agentKind: 'codex' as const, kind: 'jsonl-file' as const, locator: '/legacy', mtimeMs: 10 },
        session: session('legacy', '/work/apc', '2026-07-16T09:00:00Z'),
      },
    ]

    const result = await loadConversationHistory({
      adapters: [adapter(rows)], projectId: 'p1', repoPaths: ['/work/apc'], agent: 'codex', includeOlder: true,
    })

    expect(result.sessions.map((item) => item.id)).toEqual(['interactive', 'legacy'])
  })
})
