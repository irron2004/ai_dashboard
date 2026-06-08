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
    writeSession(base, '-mnt-c-work-apc/nested/session-a', 's1.jsonl', [
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
    expect(sources[0].sourceDirPath).toContain('session-a')
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
    expect(session.sourceDirPath).toContain('session-a')
    expect(session.sourceMeta.provider).toBe('claude')
    expect(session.sourceMeta.sourceKind).toBe('jsonl-file')
    expect(session.sourceMeta.sessionHeader.sourceLocator).toContain('s1.jsonl')
    expect(session.startedAt).toBe('2026-06-01T10:00:00Z')
    expect(session.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user'])
    expect(session.turns[1].toolCalls[0].name).toBe('Edit')
    expect(session.filesTouched).toContain('src/a.ts')
    expect(JSON.parse(position).sizeBytes).toBeGreaterThan(0)
  })
})
