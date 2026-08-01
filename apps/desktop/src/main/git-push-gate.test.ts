import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CH } from '../shared/ipc-contract.js'
import { buildContainer } from './container.js'
import { handlers } from './ipc.js'

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

function commitFile(repo: string, name: string, content: string, message: string): string {
  writeFileSync(join(repo, name), content)
  git(repo, ['add', name])
  git(repo, ['commit', '-m', message])
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

describe('gitPush Learning Gate re-verification', () => {
  let base: string
  let vault: string
  let repo: string
  let remote: string
  let container: ReturnType<typeof buildContainer>

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'apc-push-gate-'))
    vault = mkdtempSync(join(tmpdir(), 'apc-push-gate-vault-'))
    remote = join(base, 'remote.git')
    repo = join(base, 'repo')
    git(base, ['init', '--bare', remote])
    git(base, ['init', '-b', 'main', repo])
    configureGitIdentity(repo)
    git(repo, ['remote', 'add', 'origin', remote])
    commitFile(repo, 'initial.txt', 'initial\n', 'initial')
    git(repo, ['push', '-u', 'origin', 'main'])

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

  test('blocks an uncovered app push and allows the exact reviewed HEAD', async () => {
    const reviewed = git(repo, ['rev-parse', 'HEAD']).trim()
    await container.gate.recordReviewedSha(repo, reviewed)
    commitFile(repo, 'local.txt', 'local\n', 'local change')

    const push = handlers(container)[CH.gitPush]
    const blocked = await push({ projectId: 'p1' }) as { ok: boolean; reason?: string }
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toContain('리뷰되지 않은')

    await container.gate.recordReviewedSha(repo, git(repo, ['rev-parse', 'HEAD']).trim())
    expect(await push({ projectId: 'p1' })).toMatchObject({ ok: true })
  })

  test('fetches and rebases first, then rejects the newly rewritten unreviewed HEAD', async () => {
    const reviewedLocal = commitFile(repo, 'local.txt', 'local\n', 'local change')
    await container.gate.recordReviewedSha(repo, reviewedLocal)

    const peer = join(base, 'peer')
    git(base, ['clone', '--branch', 'main', remote, peer])
    configureGitIdentity(peer)
    const remoteHead = commitFile(peer, 'remote.txt', 'remote\n', 'remote change')
    git(peer, ['push', 'origin', 'main'])

    const push = handlers(container)[CH.gitPush]
    const blocked = await push({ projectId: 'p1' }) as { ok: boolean; reason?: string }
    const rebasedHead = git(repo, ['rev-parse', 'HEAD']).trim()

    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toContain('리뷰되지 않은')
    expect(rebasedHead).not.toBe(reviewedLocal)
    expect(git(base, ['--git-dir', remote, 'rev-parse', 'main']).trim()).toBe(remoteHead)
    expect((await container.gate.status(repo)).headCovered).toBe(false)

    await container.gate.recordReviewedSha(repo, rebasedHead)
    expect(await push({ projectId: 'p1' })).toMatchObject({ ok: true })
  })
})
