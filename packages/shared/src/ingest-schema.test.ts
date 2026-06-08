import { describe, expect, test } from 'vitest'
import { NormalizedSessionSchema, AgentSourceSchema, SourceCursorSchema } from './ingest-schema.js'

describe('NormalizedSessionSchema', () => {
  test('parses a session with turns and tool calls', () => {
    const s = NormalizedSessionSchema.parse({
      id: 'sess-1',
      agentType: 'claude',
      repoPath: '/mnt/c/work/apc',
      sourceDirPath: '/home/me/.claude/projects/-mnt-c-work-apc',
      sourceMeta: {
        provider: 'claude',
        sourceKind: 'jsonl-file',
        rawLocator: '/home/me/.claude/projects/-mnt-c-work-apc/s1.jsonl',
        sourceDirPath: '/home/me/.claude/projects/-mnt-c-work-apc',
        discoveredAt: '2026-06-01T10:00:00Z',
        sessionHeader: { sessionId: 'sess-1' },
      },
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
    expect(s.sourceMeta.provider).toBe('claude')
    expect(s.sourceMeta.sourceKind).toBe('jsonl-file')
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
      locator: '/a/b.jsonl', sourceDirPath: '/a', mtimeMs: 123, sizeBytes: 456,
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
