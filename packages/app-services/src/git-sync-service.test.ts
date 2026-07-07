import { describe, expect, test } from 'vitest'
import { parseGitStatusPorcelainV2 } from './git-sync-service.js'

describe('GitSyncService status parser', () => {
  test('parses branch metadata, ahead/behind, normal files, and untracked files', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 abc abc src/changed file.ts',
      '? docs/new.md',
      '',
    ].join('\0')
    const status = parseGitStatusPorcelainV2(out, '/repo')
    expect(status).toMatchObject({ ok: true, repoPath: '/repo', branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, hasChanges: true })
    expect(status.files).toEqual([
      { path: 'src/changed file.ts', status: 'modified', staged: false, unstaged: true, conflict: false },
      { path: 'docs/new.md', status: 'untracked', staged: false, unstaged: true, conflict: false },
    ])
  })

  test('flags detached head, missing upstream, and conflicts as warnings', () => {
    const out = [
      '# branch.head (detached)',
      'u UU N... 100644 100644 100644 100644 a b c conflicted.md',
      '',
    ].join('\0')
    const status = parseGitStatusPorcelainV2(out)
    expect(status.detached).toBe(true)
    expect(status.upstream).toBeUndefined()
    expect(status.files[0]).toMatchObject({ path: 'conflicted.md', status: 'conflict', conflict: true })
    expect(status.warnings.join('\n')).toContain('detached HEAD')
    expect(status.warnings.join('\n')).toContain('upstream branch')
    expect(status.warnings.join('\n')).toContain('충돌')
  })
})
