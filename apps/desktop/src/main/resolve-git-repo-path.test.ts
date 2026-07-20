import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildContainer } from './container.js'
import { resolveGitRepoPath } from './ipc.js'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'APC Test',
  GIT_AUTHOR_EMAIL: 'apc@example.test',
  GIT_COMMITTER_NAME: 'APC Test',
  GIT_COMMITTER_EMAIL: 'apc@example.test',
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
}

describe('resolveGitRepoPath', () => {
  let base: string
  let vault: string
  let repo: string
  let worktree: string
  let container: ReturnType<typeof buildContainer>

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'apc-resolve-wt-'))
    vault = mkdtempSync(join(tmpdir(), 'apc-resolve-vault-'))
    repo = join(base, 'repo')
    worktree = join(base, 'feature')
    git(base, ['init', '-b', 'main', repo])
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    git(repo, ['add', 'a.txt'])
    git(repo, ['commit', '-m', 'initial'])
    git(repo, ['worktree', 'add', '-b', 'feature', worktree])
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vault })
    container.registry.register({
      id: 'p1', name: 'Project', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: [repo], vaultPaths: [], sourcePaths: [],
    })
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
    rmSync(vault, { recursive: true, force: true })
  })

  test('falls back to the registered root and accepts a real linked worktree', async () => {
    expect(await resolveGitRepoPath(container, 'p1')).toEqual({ ok: true, repoPath: repo })
    expect(await resolveGitRepoPath(container, 'p1', worktree)).toEqual({ ok: true, repoPath: worktree })
  })

  test('rejects unknown projects and arbitrary caller paths', async () => {
    expect((await resolveGitRepoPath(container, 'missing')).ok).toBe(false)
    const rejected = await resolveGitRepoPath(container, 'p1', join(base, 'not-a-worktree'))
    expect(rejected).toMatchObject({ ok: false })
  })
})
