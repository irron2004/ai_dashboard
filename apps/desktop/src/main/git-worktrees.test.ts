import { afterEach, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listGitWorktrees, parseGitWorktreesPorcelain } from './git-worktrees.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('parseGitWorktreesPorcelain', () => {
  test('parses branches, detached heads, spaces, and worktree metadata', () => {
    const result = parseGitWorktreesPorcelain([
      'worktree C:/work/My Project',
      'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree C:/work/My Project-auth',
      'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'branch refs/heads/feat/auth',
      'locked in use',
      '',
      'worktree C:/work/detached',
      'HEAD cccccccccccccccccccccccccccccccccccccccc',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\r\n'))

    expect(result).toEqual([
      {
        path: 'C:/work/My Project', branch: 'main', head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        detached: false, isMain: true,
      },
      {
        path: 'C:/work/My Project-auth', branch: 'feat/auth', head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        detached: false, isMain: false, locked: 'in use',
      },
      {
        path: 'C:/work/detached', branch: null, head: 'cccccccccccccccccccccccccccccccccccccccc',
        detached: true, isMain: false, prunable: 'gitdir file points to non-existent location',
      },
    ])
  })

  test('lists real linked worktrees from any registered repository root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'apc-worktrees-'))
    cleanup.push(root)
    const repo = join(root, 'repo')
    const linked = join(root, 'auth-worktree')
    mkdirSync(repo)
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'APC Test'], { cwd: repo })
    execFileSync('git', ['config', 'user.email', 'apc@example.test'], { cwd: repo })
    writeFileSync(join(repo, 'README.md'), '# fixture\n')
    execFileSync('git', ['add', 'README.md'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['branch', '-M', 'main'], { cwd: repo })
    execFileSync('git', ['worktree', 'add', '-b', 'feat/auth', linked], { cwd: repo, stdio: 'ignore' })

    const result = await listGitWorktrees(repo)

    expect(result.ok).toBe(true)
    expect(result.worktrees).toHaveLength(2)
    expect(result.worktrees.map((worktree) => worktree.path.replace(/\\/g, '/')))
      .toEqual([repo, linked].map((path) => path.replace(/\\/g, '/')))
    expect(result.worktrees.map((worktree) => ({ branch: worktree.branch, isMain: worktree.isMain })))
      .toEqual([{ branch: 'main', isMain: true }, { branch: 'feat/auth', isMain: false }])
  })
})
