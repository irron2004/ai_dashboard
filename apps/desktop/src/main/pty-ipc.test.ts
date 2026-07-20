import { describe, expect, test, vi } from 'vitest'
import {
  authorizePtyStart,
  parsePtyInput,
  parsePtyKill,
  parsePtyResize,
  parsePtyStart,
} from './pty-ipc.js'

const scopedStart = {
  id: 'pane-1',
  command: 'codex',
  args: [],
  cwd: '/repo/worktree',
  agent: 'codex' as const,
  launchId: 'launch-1',
  pane: {
    paneId: 'pane-1',
    projectId: 'project-1',
    worktreePath: '/repo/worktree',
    slotId: 'codex-1',
    agent: 'codex' as const,
  },
}

describe('PTY IPC boundary', () => {
  test('accepts scoped identity and the one-release legacy shape', () => {
    expect(parsePtyStart(scopedStart)).toEqual({ ok: true, value: scopedStart })
    expect(parsePtyStart({ id: 'legacy', command: 'codex', args: [], cwd: '/repo' })).toMatchObject({ ok: true })
  })

  test.each([
    [{ ...scopedStart, id: 'other' }, 'pane id'],
    [{ ...scopedStart, cwd: '/tmp' }, 'worktree'],
    [{ ...scopedStart, command: 'claude' }, 'command'],
    [{ ...scopedStart, agent: 'claude' }, 'agent'],
    [{ ...scopedStart, injected: true }, 'unknown key'],
    [{ ...scopedStart, launchId: undefined }, 'half-scoped'],
  ])('rejects invalid scoped starts: %s (%s)', (payload, _label) => {
    expect(parsePtyStart(payload)).toEqual({ ok: false, reason: 'invalid-start' })
  })

  test('authorizes only a main-verified registered worktree', async () => {
    const resolve = vi.fn(async () => ({ ok: true as const, repoPath: '/repo/worktree' }))
    await expect(authorizePtyStart(scopedStart, resolve)).resolves.toEqual({ ok: true })
    expect(resolve).toHaveBeenCalledWith('project-1', '/repo/worktree')

    await expect(authorizePtyStart(scopedStart, async () => ({ ok: false, reason: 'missing' })))
      .resolves.toEqual({ ok: false, reason: 'unregistered-worktree' })
    await expect(authorizePtyStart(
      scopedStart,
      async () => ({ ok: true, repoPath: '/repo/other' }),
    )).resolves.toEqual({ ok: false, reason: 'unregistered-worktree' })
  })

  test('caps input bytes and optimistic question candidates', () => {
    expect(parsePtyInput({
      id: 'pane-1', data: '테스트\r', launchId: 'launch-1', questionCandidates: ['테스트'],
    })).toMatchObject({ ok: true })
    expect(parsePtyInput({ id: 'pane-1', data: 'x'.repeat(1024 * 1024 + 1) }))
      .toEqual({ ok: false, reason: 'input-too-large' })
    expect(parsePtyInput({
      id: 'pane-1', data: '\r', questionCandidates: Array.from({ length: 9 }, () => 'q'),
    })).toEqual({ ok: false, reason: 'invalid-input' })
    expect(parsePtyInput({ id: 'pane-1', data: '\r', rawClipboard: 'secret' }))
      .toEqual({ ok: false, reason: 'invalid-input' })
  })

  test('enforces resize limits and kill reasons', () => {
    expect(parsePtyResize({ id: 'pane-1', cols: 120, rows: 30, launchId: 'launch-1' }))
      .toMatchObject({ ok: true })
    expect(parsePtyResize({ id: 'pane-1', cols: 501, rows: 30 }))
      .toEqual({ ok: false, reason: 'cols-out-of-range' })
    expect(parsePtyKill({ id: 'pane-1', launchId: 'launch-1', reason: 'restart' }))
      .toMatchObject({ ok: true })
    expect(parsePtyKill({ id: 'pane-1', reason: 'force' }))
      .toEqual({ ok: false, reason: 'invalid-kill' })
  })
})
