import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { GateService } from './gate-service.js'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'APC Test', GIT_AUTHOR_EMAIL: 'apc@example.test',
  GIT_COMMITTER_NAME: 'APC Test', GIT_COMMITTER_EMAIL: 'apc@example.test',
  GIT_TERMINAL_PROMPT: '0',
}

function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env } })
}

const roots: string[] = []
function makeRepo(): { root: string; repo: string; remote: string } {
  const root = mkdtempSync(join(tmpdir(), 'apc-gate-'))
  roots.push(root)
  const repo = join(root, 'repo')
  const remote = join(root, 'remote.git')
  git(root, ['init', '--bare', remote])
  git(root, ['init', '-b', 'main', repo])
  git(repo, ['remote', 'add', 'origin', remote])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-m', 'initial'])
  git(repo, ['push', '-u', 'origin', 'main'])
  return { root, repo, remote }
}

function commit(repo: string, body: string): string {
  writeFileSync(join(repo, 'a.txt'), `${body}\n`)
  git(repo, ['add', 'a.txt'])
  git(repo, ['commit', '-m', body])
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('GateService', () => {
  test('install activates a fail-closed hook; a reviewed tip passes and a newer tip is blocked', async () => {
    const { repo } = makeRepo()
    const service = new GateService()
    expect(await service.installHook(repo)).toEqual({ ok: true })
    expect(await service.status(repo)).toMatchObject({ enabled: true, hookInstalled: true, reviewedCount: 0, headCovered: false })

    const second = commit(repo, 'second')
    expect(() => git(repo, ['push'])).toThrow()
    expect(await service.recordReviewedSha(repo, second)).toEqual({ ok: true })
    git(repo, ['push'])

    commit(repo, 'third')
    expect(() => git(repo, ['push'])).toThrow()
    expect((await service.status(repo)).headCovered).toBe(false)
  })

  test('APC_GATE_SKIP passes with a reason and the drain returns it once', async () => {
    const { repo } = makeRepo()
    const service = new GateService()
    await service.installHook(repo)
    commit(repo, 'hotfix')

    git(repo, ['push'], { APC_GATE_SKIP: '긴급 핫픽스' })

    expect(await service.readAndClearSkips(repo)).toEqual([
      expect.objectContaining({ reason: '긴급 핫픽스' }),
    ])
    expect(await service.readAndClearSkips(repo)).toEqual([])
  })

  test('honors core.hooksPath and chains a pre-existing hook without overwriting it', async () => {
    const { root, repo } = makeRepo()
    const hooks = join(repo, '.githooks')
    const marker = join(root, 'original-ran')
    mkdirSync(hooks, { recursive: true })
    git(repo, ['config', 'core.hooksPath', '.githooks'])
    const existing = join(hooks, 'pre-push')
    writeFileSync(existing, `#!/bin/sh\nprintf 'ran\\n' >> '${marker}'\nexit 0\n`)
    execFileSync('chmod', ['755', existing])

    const service = new GateService()
    expect((await service.installHook(repo)).ok).toBe(true)
    expect(existsSync(`${existing}.apc-original`)).toBe(true)
    const head = commit(repo, 'second')
    await service.recordReviewedSha(repo, head)
    git(repo, ['push'])

    expect(readFileSync(marker, 'utf8')).toContain('ran')
    expect(readFileSync(existing, 'utf8')).toContain('apc-learning-gate')
  })

  test('linked worktrees share common gate state', async () => {
    const { root, repo } = makeRepo()
    const worktree = join(root, 'feature')
    git(repo, ['worktree', 'add', '-b', 'feature', worktree])
    const service = new GateService()
    await service.installHook(worktree)
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    await service.recordReviewedSha(worktree, head)

    expect(await service.status(repo)).toMatchObject({ enabled: true, hookInstalled: true, reviewedCount: 1, headCovered: true })
    expect(await service.status(worktree)).toMatchObject({ enabled: true, hookInstalled: true, reviewedCount: 1, headCovered: true })
  })
})
