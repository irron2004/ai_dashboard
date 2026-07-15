import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchConversationsWithRunner } from './remote-conversations.js'

function framed(path: string, content: string): string {
  return [
    `@@APCDOC@@${path}`,
    Buffer.from(content, 'utf8').toString('base64'),
    '@@APCEND@@',
    '',
  ].join('\n')
}

describe('fetchConversationsWithRunner', () => {
  test('fetches only the requested engine and returns an adapter for its local copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-remote-conversations-'))
    const scripts: string[] = []
    const transcript = [
      JSON.stringify({ timestamp: '2026-07-16T00:00:00Z', type: 'session_meta', payload: { id: 'remote-codex', cwd: '/home/me/work/apc' } }),
      JSON.stringify({ timestamp: '2026-07-16T00:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '원격 질문' }] } }),
      JSON.stringify({ timestamp: '2026-07-16T00:02:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '원격 답변' }] } }),
    ].join('\n')

    try {
      const adapters = await fetchConversationsWithRunner(
        '/home/me/work/apc',
        dir,
        async (script) => {
          scripts.push(script)
          return {
            ok: true,
            stdout: framed('/home/me/.codex/sessions/2026/07/rollout-remote.jsonl', transcript),
            stderr: '',
            exitCode: 0,
          }
        },
        ['codex'],
      )

      expect(adapters.map((adapter) => adapter.agentKind)).toEqual(['codex'])
      expect(scripts).toHaveLength(1)
      expect(scripts[0]).toContain('.codex/sessions')
      expect(scripts[0]).not.toContain('.claude/projects')

      const sources = await adapters[0].discoverSources(() => undefined)
      const parsed = await adapters[0].parseSource(sources[0])
      expect(parsed.session).toMatchObject({ id: 'remote-codex', repoPath: '/home/me/work/apc' })
      expect(parsed.session.turns.map((turn) => turn.text)).toEqual(['원격 질문', '원격 답변'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('uses Claude Code path encoding for punctuation in the project directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-remote-claude-'))
    const scripts: string[] = []
    try {
      await fetchConversationsWithRunner(
        '/mnt/c/Users/Me/work/ai_dashboard-main',
        dir,
        async (script) => {
          scripts.push(script)
          return { ok: true, stdout: '', stderr: '', exitCode: 0 }
        },
        ['claude'],
      )

      expect(scripts).toHaveLength(1)
      expect(scripts[0]).toContain('.claude/projects/-mnt-c-Users-Me-work-ai-dashboard-main/')
      expect(scripts[0]).not.toContain('ai_dashboard-main')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
