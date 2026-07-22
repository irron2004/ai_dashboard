import { describe, expect, test } from 'vitest'
import { buildPtyEnvironment, localPtyEnvironmentKind } from './pty-environment.js'

describe('buildPtyEnvironment', () => {
  test.each(['local', 'wsl'] as const)('preserves an existing UTF-8 locale and sets tmux-capable colors for %s', (kind) => {
    const result = buildPtyEnvironment({
      kind,
      env: { LANG: 'ko_KR.UTF-8', LC_CTYPE: 'C.UTF-8', TERM: 'dumb', COLORTERM: undefined, KEEP: 'yes' },
    })
    expect(result.env).toMatchObject({
      LANG: 'ko_KR.UTF-8', LC_CTYPE: 'C.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor', KEEP: 'yes',
    })
    expect(result.diagnostic).toMatchObject({ kind, utf8: true, warnings: [] })
  })

  test('changes a non-UTF locale only when an installed UTF-8 locale is known', () => {
    const corrected = buildPtyEnvironment({
      kind: 'local', env: { LANG: 'C', LC_ALL: 'C' }, availableLocales: ['C', 'C.utf8'],
    })
    expect(corrected.env).toMatchObject({ LANG: 'C.utf8', LC_CTYPE: 'C.utf8', LC_ALL: 'C.utf8' })
    expect(corrected.diagnostic.utf8).toBe(true)

    const untouched = buildPtyEnvironment({ kind: 'local', env: { LANG: 'C' }, availableLocales: ['C', 'POSIX'] })
    expect(untouched.env.LANG).toBe('C')
    expect(untouched.env.LC_CTYPE).toBeUndefined()
    expect(untouched.diagnostic.warnings[0]).toContain('UTF-8')
  })

  test('never overwrites SSH locale and provides commands for an unsupported remote charmap', () => {
    const result = buildPtyEnvironment({
      kind: 'ssh', env: { LANG: 'C', LC_CTYPE: 'C' }, remoteCharmap: 'ANSI_X3.4-1968',
    })
    expect(result.env).toMatchObject({ LANG: 'C', LC_CTYPE: 'C', TERM: 'xterm-256color', COLORTERM: 'truecolor' })
    expect(result.diagnostic).toMatchObject({ utf8: false, verified: true, checks: ['locale charmap', 'locale -a'] })
    expect(result.diagnostic.warnings[0]).toContain('서버 locale')
  })

  test('marks an unchecked remote locale as unknown instead of silently claiming UTF-8', () => {
    const result = buildPtyEnvironment({ kind: 'ssh', env: { LANG: 'C.UTF-8' } })
    expect(result.diagnostic).toMatchObject({ utf8: false, verified: false })
    expect(result.diagnostic.warnings[0]).toContain('아직 확인')
  })
})

test('detects a WSL host from its inherited environment', () => {
  expect(localPtyEnvironmentKind({ WSL_DISTRO_NAME: 'Ubuntu' })).toBe('wsl')
  expect(localPtyEnvironmentKind({})).toBe('local')
})
