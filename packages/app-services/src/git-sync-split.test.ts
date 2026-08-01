import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { GitSyncService } from './git-sync-service.js'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'APC Test',
  GIT_AUTHOR_EMAIL: 'apc@example.test',
  GIT_COMMITTER_NAME: 'APC Test',
  GIT_COMMITTER_EMAIL: 'apc@example.test',
  GIT_TERMINAL_PROMPT: '0',
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
}

function configureGitIdentity(repo: string): void {
  git(repo, ['config', '--local', 'user.name', 'APC Test'])
  git(repo, ['config', '--local', 'user.email', 'apc@example.test'])
}

const roots: string[] = []
function makeRepoWithRemote(): { root: string; repo: string; remote: string } {
  const root = mkdtempSync(join(tmpdir(), 'apc-git-split-'))
  roots.push(root)
  const repo = join(root, 'repo')
  const remote = join(root, 'remote.git')
  git(root, ['init', '--bare', remote])
  git(root, ['init', '-b', 'main', repo])
  configureGitIdentity(repo)
  git(repo, ['remote', 'add', 'origin', remote])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-m', 'initial'])
  git(repo, ['push', '-u', 'origin', 'main'])
  return { root, repo, remote }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('GitSyncService commit/push split', () => {
  test('commit creates a local commit without pushing it', async () => {
    const { repo, remote } = makeRepoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')

    const result = await new GitSyncService().commit(repo, ['a.txt'], 'feat: local only')

    expect(result.ok).toBe(true)
    expect(result.committedSha).toMatch(/^[0-9a-f]{40}$/)
    expect(git(remote, ['rev-list', '--count', 'main']).trim()).toBe('1')
  })

  test('push invokes the final-head verifier after synchronization and before push', async () => {
    const { repo, remote } = makeRepoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    const service = new GitSyncService()
    await service.commit(repo, ['a.txt'], 'feat: local only')
    const seen: string[] = []

    const result = await service.push(repo, {
      beforePush: async (finalRepoPath) => {
        seen.push(git(finalRepoPath, ['rev-parse', 'HEAD']).trim())
        return { ok: true }
      },
    })

    expect(result.ok).toBe(true)
    expect(seen).toEqual([git(repo, ['rev-parse', 'HEAD']).trim()])
    expect(git(remote, ['rev-list', '--count', 'main']).trim()).toBe('2')
  })

  test('a final-head verifier can block without updating the remote', async () => {
    const { repo, remote } = makeRepoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    const service = new GitSyncService()
    await service.commit(repo, ['a.txt'], 'feat: blocked')

    const result = await service.push(repo, {
      beforePush: async () => ({ ok: false, reason: 'review required' }),
    })

    expect(result).toMatchObject({ ok: false, reason: 'review required' })
    expect(git(remote, ['rev-list', '--count', 'main']).trim()).toBe('1')
  })
})
