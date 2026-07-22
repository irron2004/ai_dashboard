import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ParsedFileReference, Project } from '@apc/shared'
import type { SshExec } from './ssh-exec.js'
import {
  REMOTE_PREVIEW_END_MARKER,
  REMOTE_PREVIEW_MARKER,
  RemoteFilePreviewService,
  parseRemotePreviewBlocks,
} from './remote-file-preview.js'

function candidate(path: string): ParsedFileReference {
  return { raw: path, path, form: 'bare', start: 0, end: path.length }
}

function project(repoPath: string): Project {
  return {
    id: 'remote', name: 'Remote', status: 'active', projectType: 'git', domain: 'project-docs',
    repoPaths: [repoPath], vaultPaths: [], sourcePaths: [],
  }
}

function localBashExecutor(onScript?: (script: string) => void): SshExec {
  return async (_ssh, command, options) => {
    expect(command).toBe('bash -s')
    const script = options?.stdin ?? ''
    onScript?.(script)
    try {
      const stdout = execFileSync('bash', ['-s'], {
        input: script, encoding: 'utf8', timeout: options?.timeoutMs ?? 20_000,
      })
      return { ok: true, stdout, stderr: '', exitCode: 0 }
    } catch (error) {
      return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1 }
    }
  }
}

describe('parseRemotePreviewBlocks', () => {
  test('decodes framed metadata, multiline base64, and Hangul content', () => {
    const text = '# 한글 문서'
    const metadata = Buffer.from(JSON.stringify({
      id: '4', ok: true, canonicalPath: '/원격/문서.md', workspaceRoot: '/원격',
      size: Buffer.byteLength(text), kind: 'markdown',
    }), 'utf8').toString('base64')
    const content = Buffer.from(text, 'utf8').toString('base64').replace(/(.{5})/gu, '$1\n')
    const blocks = parseRemotePreviewBlocks([
      `noise before ${REMOTE_PREVIEW_MARKER}`,
      `${REMOTE_PREVIEW_MARKER}${metadata}`,
      content,
      REMOTE_PREVIEW_END_MARKER,
    ].join('\r\n'))

    expect(blocks).toEqual([{
      id: '4', ok: true, canonicalPath: '/원격/문서.md', workspaceRoot: '/원격',
      size: Buffer.byteLength(text), kind: 'markdown', content: text,
    }])
  })
})

describe('RemoteFilePreviewService', () => {
  let root: string
  let outside: string
  let repoUrl: string
  let currentProject: Project
  let nowMs: number

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apc-remote-preview-'))
    outside = mkdtempSync(join(tmpdir(), 'apc-remote-outside-'))
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', '한글 문서.md'), '# remote 한글')
    writeFileSync(join(root, 'app.py'), 'print("remote")')
    writeFileSync(join(outside, 'secret.md'), '# secret')
    repoUrl = `ssh://dev@example.test:2222${root.split('/').map((part) => encodeURIComponent(part)).join('/')}`
    currentProject = project(repoUrl)
    nowMs = 10
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  function service(exec: SshExec = localBashExecutor()) {
    return new RemoteFilePreviewService({
      getProject: (id) => id === 'remote' ? currentProject : undefined,
      exec,
      now: () => nowMs,
      createToken: (() => { let id = 0; return () => `remote-token-${++id}` })(),
    })
  }

  test('resolves and reads registered-root relative, absolute, and Hangul paths', async () => {
    const previews = service()
    const result = await previews.resolve({
      projectId: 'remote',
      candidates: [candidate('docs/한글 문서.md'), candidate(join(root, 'app.py'))],
    })
    expect(result.unresolved).toEqual([])
    expect(result.resolved).toMatchObject([
      { displayPath: 'docs/한글 문서.md', kind: 'markdown', workspaceRoot: root },
      { displayPath: 'app.py', kind: 'python', workspaceRoot: root },
    ])
    expect(await previews.read({ projectId: 'remote', token: result.resolved[0]!.token })).toMatchObject({
      ok: true, content: '# remote 한글',
    })
  })

  test('keeps quotes, newlines, shell operators, and command substitutions inside base64 input', async () => {
    const dangerous = "docs/$(touch SHOULD_NOT_EXIST);'줄\n바꿈.md"
    writeFileSync(join(root, dangerous), '# safely named')
    let captured = ''
    const previews = service(localBashExecutor((script) => { captured = script }))
    const result = await previews.resolve({ projectId: 'remote', candidates: [candidate(dangerous)] })

    expect(result.resolved).toHaveLength(1)
    expect(captured).not.toContain(dangerous)
    expect(captured).toContain('APC_PREVIEW_PAYLOAD_B64=')
  })

  test('rejects traversal, symlink escape, unsupported files, oversize, and invalid UTF-8 remotely', async () => {
    writeFileSync(join(root, 'large.md'), Buffer.alloc(1024 * 1024 + 1, 0x61))
    writeFileSync(join(root, 'bad.md'), Buffer.from([0xc3, 0x28]))
    writeFileSync(join(root, 'not.txt'), 'no')
    const requests = [
      candidate('../' + outside.split('/').at(-1) + '/secret.md'),
      candidate(join(outside, 'secret.md')),
      candidate('large.md'), candidate('bad.md'), candidate('not.txt'),
    ]
    try {
      symlinkSync(join(outside, 'secret.md'), join(root, 'link.md'))
      requests.push(candidate('link.md'))
    } catch { /* symlink may be unavailable on Windows */ }

    const result = await service().resolve({ projectId: 'remote', candidates: requests })
    expect(result.resolved).toEqual([])
    expect(result.unresolved).toHaveLength(requests.length)
    expect(result.unresolved.map((entry) => entry.reason).join(' ')).toMatch(/범위|1 MiB|UTF-8|확장자/)
  })

  test('rejects a renderer-supplied SSH host or workspace outside the registered root', async () => {
    const exec = vi.fn<SshExec>(localBashExecutor())
    const previews = service(exec)
    const otherHost = await previews.resolve({
      projectId: 'remote',
      sessionWorkspacePath: 'ssh://dev@other.test:2222/tmp',
      candidates: [candidate('docs/한글 문서.md')],
    })
    expect(otherHost.resolved).toEqual([])
    expect(otherHost.unresolved[0]?.reason).toMatch(/등록된 SSH host/i)
    expect(exec).not.toHaveBeenCalled()

    const otherRoot = await previews.resolve({
      projectId: 'remote', sessionWorkspacePath: outside,
      candidates: [candidate('docs/한글 문서.md')],
    })
    expect(otherRoot.resolved).toEqual([])
    expect(otherRoot.unresolved[0]?.reason).toMatch(/workspace|범위/i)
  })

  test('revalidates the remote canonical path and project registration on every read', async () => {
    const inside = join(root, 'inside.md')
    const link = join(root, 'current.md')
    writeFileSync(inside, '# inside')
    try { symlinkSync(inside, link) } catch { return }
    const previews = service()
    const resolved = await previews.resolve({ projectId: 'remote', candidates: [candidate('current.md')] })
    expect(resolved.resolved).toHaveLength(1)

    unlinkSync(link)
    symlinkSync(join(outside, 'secret.md'), link)
    expect((await previews.read({ projectId: 'remote', token: resolved.resolved[0]!.token })).ok).toBe(false)

    currentProject = project(`ssh://dev@other.test:2222${root}`)
    const changedProject = await previews.read({ projectId: 'remote', token: resolved.resolved[0]!.token })
    expect(changedProject.ok).toBe(false)
  })

  test('turns timeout and connection failures into sanitized reasons', async () => {
    const previews = service(async () => ({
      ok: false,
      stdout: '',
      stderr: `timeout SUPERSECRET full-command ${root}`,
      exitCode: null,
    }))
    const result = await previews.resolve({ projectId: 'remote', candidates: [candidate('app.py')] })
    const reason = result.unresolved[0]!.reason
    expect(reason).toMatch(/시간|연결/)
    expect(reason).not.toContain('SUPERSECRET')
    expect(reason).not.toContain(root)
  })

  test('expires opaque remote tokens', async () => {
    const previews = service()
    const result = await previews.resolve({ projectId: 'remote', candidates: [candidate('app.py')] })
    nowMs += 60_001
    const read = await previews.read({ projectId: 'remote', token: result.resolved[0]!.token })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.reason).toMatch(/만료/)
  })
})
