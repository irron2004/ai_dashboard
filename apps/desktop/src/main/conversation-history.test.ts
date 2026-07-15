import { describe, expect, test } from 'vitest'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession } from '@apc/shared'
import { loadConversationHistory, toConversationSession } from './conversation-history.js'

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
        { role: 'user', text: '첫 질문', uuid: 'q1', toolCalls: [] },
        { role: 'assistant', text: '첫 답', toolCalls: [] },
        {
          role: 'user',
          text: '# Knowledge Harness Rules\n\n## Role: wiki-graph-lead\n\n## Input\n{}\n\n## Output\nRespond with ONLY a single JSON object',
          toolCalls: [],
        },
        { role: 'assistant', text: '{"internal":true}', toolCalls: [] },
        { role: 'user', text: '둘째 질문', uuid: 'q2', toolCalls: [] },
        { role: 'assistant', text: '둘째 답', toolCalls: [] },
      ],
    })

    expect(view?.exchanges).toEqual([
      { id: 'q1', askedAt: '2026-07-15T10:00:00Z', question: '첫 질문', answer: '첫 답' },
      { id: 'q2', askedAt: '2026-07-15T10:00:00Z', question: '둘째 질문', answer: '둘째 답' },
    ])
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
      adapters: [claude, adapter(rows)], projectId: 'p1', repoPaths: ['/work/apc'], agent: 'codex', limit: 1,
    })
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].id).toBe('two')
    expect(result.truncated).toBe(true)
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
    })

    expect(result.sessions.map((item) => item.id)).toEqual(['wsl', 'windows'])
    expect(result.scannedSources).toBe(2)
  })
})
