import { describe, expect, test, vi } from 'vitest'
import type { AgentIngestAdapter } from '@apc/agents'
import {
  fetchWslConversations,
  parseWslDistros,
  toWslProjectTarget,
} from './wsl-conversations.js'

function emptyAdapter(): AgentIngestAdapter {
  return {
    agentKind: 'codex',
    discoverSources: async () => [],
    parseSource: async () => { throw new Error('unused') },
  }
}

describe('WSL conversation discovery', () => {
  test('maps Windows drive and WSL UNC project paths to Linux paths', () => {
    expect(toWslProjectTarget('C:\\Users\\Me\\work\\apc')).toEqual({ path: '/mnt/c/Users/Me/work/apc' })
    expect(toWslProjectTarget('/mnt/c/Users/Me/work/apc')).toEqual({ path: '/mnt/c/Users/Me/work/apc' })
    expect(toWslProjectTarget('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\work\\apc')).toEqual({
      distro: 'Ubuntu-24.04',
      path: '/home/me/work/apc',
    })
    expect(toWslProjectTarget('ssh://me@host/home/me/work/apc')).toBeNull()
  })

  test('decodes wsl.exe NUL-separated output and excludes infrastructure distros', () => {
    const utf16ish = `\ufeff${['Ubuntu-24.04', 'docker-desktop', 'Debian']
      .map((name) => `${[...name].join('\0')}\0\r\n`)
      .join('')}`
    expect(parseWslDistros(utf16ish)).toEqual(['Ubuntu-24.04', 'Debian'])
  })

  test('queries every user distro for the selected engine', async () => {
    const calls: Array<{ repoPath: string; destDir: string; agents: readonly string[] | undefined }> = []
    const listDistros = vi.fn(async () => ['Ubuntu-24.04', 'Debian'])
    const runBashFor = vi.fn(() => async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }))

    const adapters = await fetchWslConversations(
      'C:\\Users\\Me\\work\\apc',
      'C:\\cache\\wsl',
      ['codex'],
      {},
      {
        listDistros,
        runBashFor,
        fetchWithRunner: async (repoPath, destDir, _runner, agents) => {
          calls.push({ repoPath, destDir, agents })
          return [emptyAdapter()]
        },
      },
    )

    expect(adapters).toHaveLength(2)
    expect(calls.map((call) => call.repoPath)).toEqual(['/mnt/c/Users/Me/work/apc', '/mnt/c/Users/Me/work/apc'])
    expect(calls.map((call) => call.agents)).toEqual([['codex'], ['codex']])
    expect(runBashFor).toHaveBeenCalledTimes(2)
  })

  test('pins a WSL UNC project to its named distro', async () => {
    const listDistros = vi.fn(async () => ['Ubuntu-24.04', 'Debian'])
    const calls: string[] = []

    await fetchWslConversations(
      '\\\\wsl$\\Ubuntu-24.04\\home\\me\\work\\apc',
      'C:\\cache\\wsl',
      ['claude'],
      {},
      {
        listDistros,
        runBashFor: () => async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }),
        fetchWithRunner: async (repoPath) => { calls.push(repoPath); return [] },
      },
    )

    expect(listDistros).not.toHaveBeenCalled()
    expect(calls).toEqual(['/home/me/work/apc'])
  })
})
