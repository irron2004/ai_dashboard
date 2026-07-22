import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ParsedFileReference, Project } from '@apc/shared'
import {
  LocalFilePreviewService,
  mapFilePreviewPathForPlatform,
  parseWslUncPath,
  windowsPathToWslPath,
  wslPathToWindowsPath,
} from './file-preview.js'

function project(id: string, repoPath: string): Project {
  return {
    id, name: id, status: 'active', projectType: 'git', domain: 'project-docs',
    repoPaths: [repoPath], vaultPaths: [], sourcePaths: [],
  }
}

function candidate(path: string, raw = path): ParsedFileReference {
  return { raw, path, form: 'bare', start: 0, end: raw.length }
}

describe('preview path mapping', () => {
  test('maps Windows drives and WSL mounts without consulting the host platform', () => {
    expect(windowsPathToWslPath('C:\\Users\\홍 길동\\repo\\app.py')).toBe('/mnt/c/Users/홍 길동/repo/app.py')
    expect(windowsPathToWslPath('relative\\app.py')).toBeNull()
    expect(wslPathToWindowsPath('/mnt/c/Users/홍 길동/repo/app.py')).toBe('C:\\Users\\홍 길동\\repo\\app.py')
    expect(wslPathToWindowsPath('/home/me/app.py')).toBeNull()
  })

  test('parses both WSL UNC spellings and preserves the distribution boundary', () => {
    expect(parseWslUncPath('\\\\wsl$\\Ubuntu-24.04\\home\\me\\app.py')).toEqual({
      distro: 'Ubuntu-24.04', path: '/home/me/app.py',
    })
    expect(parseWslUncPath('\\\\wsl.localhost\\Ubuntu\\mnt\\c\\repo\\README.md')).toEqual({
      distro: 'Ubuntu', path: '/mnt/c/repo/README.md',
    })
    expect(parseWslUncPath('\\\\server\\share\\README.md')).toBeNull()
    expect(mapFilePreviewPathForPlatform('\\\\wsl$\\Ubuntu\\home\\me\\app.py', 'linux', 'Ubuntu'))
      .toBe('/home/me/app.py')
    expect(mapFilePreviewPathForPlatform('\\\\wsl$\\Debian\\home\\me\\app.py', 'linux', 'Ubuntu'))
      .toBeNull()
    expect(mapFilePreviewPathForPlatform('/mnt/c/repo/README.md', 'win32'))
      .toBe('C:\\repo\\README.md')
  })
})

describe('LocalFilePreviewService', () => {
  let base: string
  let repo: string
  let worktree: string
  let outside: string
  let projects: Map<string, Project>
  let nowMs: number

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'apc-preview-'))
    repo = join(base, 'repo')
    worktree = join(base, 'worktree')
    outside = join(base, 'outside')
    mkdirSync(join(repo, 'docs'), { recursive: true })
    mkdirSync(join(worktree, 'docs'), { recursive: true })
    mkdirSync(join(worktree, 'session', 'docs'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(repo, 'docs', 'same.md'), '# primary')
    writeFileSync(join(worktree, 'docs', 'same.md'), '# worktree')
    writeFileSync(join(worktree, 'session', 'docs', 'same.md'), '# session')
    writeFileSync(join(outside, 'secret.md'), '# secret')
    projects = new Map([
      ['p1', project('p1', repo)],
      ['p2', project('p2', outside)],
    ])
    nowMs = 1_000
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  function service() {
    return new LocalFilePreviewService({
      getProject: (projectId) => projects.get(projectId),
      listWorktrees: async () => ({
        ok: true,
        worktrees: [
          { path: repo, branch: 'main', head: 'a', detached: false, isMain: true },
          { path: worktree, branch: 'feat', head: 'b', detached: false, isMain: false },
        ],
      }),
      now: () => nowMs,
      createToken: (() => { let id = 0; return () => `token-${++id}` })(),
    })
  }

  test('uses verified session workspace, active worktree, then primary root precedence', async () => {
    const previews = service()
    const session = await previews.resolve({
      projectId: 'p1', activeWorktreePath: worktree, sessionWorkspacePath: join(worktree, 'session'),
      candidates: [candidate('docs/same.md')],
    })
    expect(session.resolved[0]).toMatchObject({ workspaceRoot: join(worktree, 'session'), size: 9 })
    expect((await previews.read({ projectId: 'p1', token: session.resolved[0]!.token }))).toMatchObject({
      ok: true, content: '# session',
    })

    const active = await previews.resolve({
      projectId: 'p1', activeWorktreePath: worktree, candidates: [candidate('docs/same.md')],
    })
    expect(active.resolved[0]?.workspaceRoot).toBe(worktree)
    expect((await previews.read({ projectId: 'p1', token: active.resolved[0]!.token }))).toMatchObject({
      ok: true, content: '# worktree',
    })

    const primary = await previews.resolve({ projectId: 'p1', candidates: [candidate('docs/same.md')] })
    expect(primary.resolved[0]?.workspaceRoot).toBe(repo)
  })

  test('rejects renderer worktree and session hints not present in the actual project worktree set', async () => {
    const previews = service()
    const badWorktree = await previews.resolve({
      projectId: 'p1', activeWorktreePath: outside, candidates: [candidate('docs/same.md')],
    })
    expect(badWorktree.resolved).toEqual([])
    expect(badWorktree.unresolved[0]?.reason).toMatch(/worktree/i)

    const badSession = await previews.resolve({
      projectId: 'p1', sessionWorkspacePath: outside, candidates: [candidate('docs/same.md')],
    })
    expect(badSession.resolved).toEqual([])
    expect(badSession.unresolved[0]?.reason).toMatch(/session workspace/i)
  })

  test('blocks traversal, absolute paths in another project, and symlink escape', async () => {
    const previews = service()
    const requests = [
      candidate('../outside/secret.md'),
      candidate(join(outside, 'secret.md')),
    ]
    try {
      symlinkSync(join(outside, 'secret.md'), join(repo, 'docs', 'link.md'))
      requests.push(candidate('docs/link.md'))
    } catch { /* Windows without symlink permission still exercises traversal and absolute scope. */ }

    const result = await previews.resolve({ projectId: 'p1', candidates: requests })
    expect(result.resolved).toEqual([])
    expect(result.unresolved).toHaveLength(requests.length)
  })

  test('allows only regular md/html/py files up to 1 MiB with strict UTF-8', async () => {
    writeFileSync(join(repo, 'docs', 'page.html'), '<h1>ok</h1>')
    writeFileSync(join(repo, 'docs', 'tool.py'), 'print("ok")')
    writeFileSync(join(repo, 'docs', 'no.txt'), 'no')
    writeFileSync(join(repo, 'docs', 'large.md'), Buffer.alloc(1024 * 1024 + 1, 0x61))
    writeFileSync(join(repo, 'docs', 'invalid.md'), Buffer.from([0xc3, 0x28]))
    mkdirSync(join(repo, 'docs', 'folder.md'))

    const result = await service().resolve({
      projectId: 'p1',
      candidates: [
        candidate('docs/page.html'), candidate('docs/tool.py'), candidate('docs/no.txt'),
        candidate('docs/large.md'), candidate('docs/invalid.md'), candidate('docs/folder.md'),
      ],
    })
    expect(result.resolved.map((reference) => reference.kind)).toEqual(['html', 'python'])
    expect(result.unresolved.map((entry) => entry.reason).join(' ')).toMatch(/확장자|1 MiB|UTF-8|일반 파일/)
  })

  test('revalidates the original path at read time against symlink swaps and file replacement', async () => {
    const inside = join(repo, 'docs', 'inside.md')
    const link = join(repo, 'docs', 'current.md')
    writeFileSync(inside, '# old')
    try { symlinkSync(inside, link) } catch { return }
    const previews = service()
    const resolved = await previews.resolve({ projectId: 'p1', candidates: [candidate('docs/current.md')] })
    expect(resolved.resolved).toHaveLength(1)

    unlinkSync(link)
    symlinkSync(join(outside, 'secret.md'), link)
    const swapped = await previews.read({ projectId: 'p1', token: resolved.resolved[0]!.token })
    expect(swapped.ok).toBe(false)

    const safe = await previews.resolve({ projectId: 'p1', candidates: [candidate('docs/inside.md')] })
    writeFileSync(inside, '# replaced safely')
    expect(await previews.read({ projectId: 'p1', token: safe.resolved[0]!.token })).toMatchObject({
      ok: true, content: '# replaced safely',
    })
  })

  test('keeps identical relative paths and opaque tokens scoped to their project', async () => {
    writeFileSync(join(outside, 'same.md'), '# project two')
    const previews = service()
    const first = await previews.resolve({ projectId: 'p1', candidates: [candidate('docs/same.md')] })
    const second = await previews.resolve({ projectId: 'p2', candidates: [candidate('same.md')] })

    expect((await previews.read({ projectId: 'p1', token: first.resolved[0]!.token }))).toMatchObject({ content: '# primary' })
    expect((await previews.read({ projectId: 'p2', token: second.resolved[0]!.token }))).toMatchObject({ content: '# project two' })
    expect((await previews.read({ projectId: 'p2', token: first.resolved[0]!.token })).ok).toBe(false)
  })

  test('expires short-lived tokens instead of trusting stale resolution metadata', async () => {
    const previews = service()
    const resolved = await previews.resolve({ projectId: 'p1', candidates: [candidate('docs/same.md')] })
    nowMs += 60_001
    const read = await previews.read({ projectId: 'p1', token: resolved.resolved[0]!.token })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toMatch(/만료/)
  })
})
