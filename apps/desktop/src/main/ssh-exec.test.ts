import { describe, expect, test } from 'vitest'
import { parseSsh } from './ssh-exec.js'

describe('parseSsh', () => {
  test('parses a well-formed ssh url', () => {
    const ssh = parseSsh('ssh://hskim@10.10.100.45:22/home/hskim/work/papers')
    expect(ssh).toEqual({ user: 'hskim', host: '10.10.100.45', port: 22, path: '/home/hskim/work/papers' })
  })

  test('defaults user to root and port to 22', () => {
    expect(parseSsh('ssh://host/srv/app')).toEqual({ user: 'root', host: 'host', port: 22, path: '/srv/app' })
  })

  test('returns null for non-ssh input', () => {
    expect(parseSsh('/local/path')).toBeNull()
    expect(parseSsh('')).toBeNull()
  })

  // Regression: a project repoPath whose authority was doubled when the SSH host was changed —
  // e.g. a new `ssh://user@tailscale-host:22` prefixed onto the existing full URL — parses as
  // host = the OUTER (reachable) host but leaves the inner authority embedded in the pathname,
  // so the remote `cd` got `//user@oldhost:22/home/...` and failed with "No such file or directory".
  // parseSsh must connect to the outer host yet recover the TRUE remote path.
  test('recovers the real path from a doubled-authority url', () => {
    const ssh = parseSsh('ssh://hskim@100.66.232.121:22//hskim@10.10.100.45:22/home/hskim/work/papers')
    expect(ssh).toEqual({ user: 'hskim', host: '100.66.232.121', port: 22, path: '/home/hskim/work/papers' })
  })

  test('leaves a legitimate double-slash unix path untouched', () => {
    // `//foo/bar` has no `@`/`:` authority markers, so it is a real path, not a doubled authority.
    const ssh = parseSsh('ssh://host:22//foo/bar')
    expect(ssh?.path).toBe('//foo/bar')
  })
})
