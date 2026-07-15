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
    expect(sources[0].repoPath).toBe('/mnt/c/work/apc')
  })

  test('parseSource extracts id/cwd/branch and message turns', async () => {
    const a = new CodexAdapter(base)
    const [src] = await a.discoverSources(() => undefined)
    const { session } = await a.parseSource(src)
    expect(session.id).toBe('cx1')
    expect(session.repoPath).toBe('/mnt/c/work/apc')
    expect(session.branch).toBe('feat/x')
    expect(session.sourceDirPath).toContain('01')
    expect(session.sourceMeta.provider).toBe('codex')
    expect(session.sourceMeta.sourceKind).toBe('jsonl-file')
    expect(session.sourceMeta.sessionHeader.sessionMeta).toBeTypeOf('object')
    expect(session.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(session.turns[1].text).toBe('hi there')
  })
})
