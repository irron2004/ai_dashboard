import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SshExec, SshExecResult, SshTarget } from './ssh-exec.js'
import { DOC_MARKER, END_MARKER } from './remote-docs.js'
import { pullDir, pushDir, SshWorkspaceVault } from './remote-vault.js'

const ssh: SshTarget = { user: 'u', host: 'h', port: 22, path: '/remote/repo' }
const ok = (stdout = ''): SshExecResult => ({ ok: true, stdout, stderr: '', exitCode: 0 })

describe('pushDir', () => {
  let local: string
  beforeEach(() => { local = mkdtempSync(join(tmpdir(), 'rv-push-')) })
  afterEach(() => { rmSync(local, { recursive: true, force: true }) })

  test('emits a script that base64-restores each file and mirror-clears (keeping raw/)', async () => {
    mkdirSync(join(local, 'projects', 'p1'), { recursive: true })
    writeFileSync(join(local, 'projects', 'p1', 'current.md'), '# Hello 한글')
    let script = ''
    const exec: SshExec = vi.fn(async (_t, _cmd, opts) => { script = opts?.stdin ?? ''; return ok() })

    await pushDir(ssh, local, '/remote/repo/.apc-wiki', ['projects/p1/current.md'], { mirror: true, exec })

    // mirror clears existing contents but preserves a remote raw/ (never transferred)
    expect(script).toContain(`find '/remote/repo/.apc-wiki' -mindepth 1 -maxdepth 1 -not -name raw`)
    expect(script).toContain(`base64 -d > '/remote/repo/.apc-wiki/projects/p1/current.md'`)
    // the heredoc body decodes back to the exact (utf-8) file content
    const b64 = script.split('APC_B64_EOF')[1].replace(/\s+/g, '')
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('# Hello 한글')
  })

  test('throws on ssh failure so the sync is not silently lost', async () => {
    writeFileSync(join(local, 'f.md'), 'x')
    const exec: SshExec = async () => ({ ok: false, stdout: '', stderr: 'boom', exitCode: 1 })
    await expect(pushDir(ssh, local, '/remote/x', ['f.md'], { exec })).rejects.toThrow('boom')
  })
})

describe('pullDir', () => {
  let local: string
  beforeEach(() => { local = mkdtempSync(join(tmpdir(), 'rv-pull-')) })
  afterEach(() => { rmSync(local, { recursive: true, force: true }) })

  test('writes framed files into localRoot and mirrors away stale local files', async () => {
    writeFileSync(join(local, 'stale.md'), 'old')
    const body = (rel: string, content: string) =>
      `${DOC_MARKER}${rel}\n${Buffer.from(content).toString('base64')}\n${END_MARKER}\n`
    const exec: SshExec = async () => ok(body('graph/g.json', '{"v":1}') + body('projects/p1/current.md', '# C'))

    await pullDir(ssh, '/remote/repo/.apc-wiki', local, exec)

    expect(readFileSync(join(local, 'graph', 'g.json'), 'utf8')).toBe('{"v":1}')
    expect(readFileSync(join(local, 'projects', 'p1', 'current.md'), 'utf8')).toBe('# C')
    expect(existsSync(join(local, 'stale.md'))).toBe(false) // mirrored
  })

  test('a missing remote dir (empty output) is not an error', async () => {
    const exec: SshExec = async () => ok('')
    await expect(pullDir(ssh, '/remote/none', local, exec)).resolves.toBeUndefined()
  })
})

describe('SshWorkspaceVault', () => {
  let cache: string
  beforeEach(() => { cache = mkdtempSync(join(tmpdir(), 'rv-wv-')) })
  afterEach(() => { rmSync(cache, { recursive: true, force: true }) })

  test('localRoot is cacheRoot/<projectId>; pull/push target <repo>/.apc-wiki', async () => {
    const cmds: Array<{ stdin: string }> = []
    const exec: SshExec = async (_t, _c, opts) => { cmds.push({ stdin: opts?.stdin ?? '' }); return ok('') }
    const wv = new SshWorkspaceVault('ssh://u@h:22/remote/repo', 'p1', cache, exec)
    expect(wv.localRoot).toBe(join(cache, 'p1'))

    await wv.pull()
    expect(cmds[0].stdin).toContain(`DIR='/remote/repo/.apc-wiki'`)

    mkdirSync(join(wv.localRoot, 'graph'), { recursive: true })
    writeFileSync(join(wv.localRoot, 'graph', 'g.json'), '{}')
    await wv.pushInternal()
    expect(cmds[1].stdin).toContain(`base64 -d > '/remote/repo/.apc-wiki/graph/g.json'`)
  })

  test('exportWiki publishes root-level readable docs to the remote wiki/ dir', async () => {
    const wv = new SshWorkspaceVault('ssh://u@h:22/remote/repo', 'p1', cache, async () => ok(''))
    const root = join(cache, 'p1')
    mkdirSync(join(root, 'raw'), { recursive: true })
    writeFileSync(join(root, 'current.md'), '# C')
    writeFileSync(join(root, 'draft.proposal.md'), '# D') // excluded
    writeFileSync(join(root, 'raw', 'src.md'), '# S') // excluded

    const r = await wv.exportWiki()
    expect(r).toEqual({ ok: true, target: 'ssh:/remote/repo/wiki', files: 1 })
  })

  test('exportWiki refuses when nothing was generated', async () => {
    const wv = new SshWorkspaceVault('ssh://u@h:22/remote/repo', 'p1', cache, async () => ok(''))
    expect(await wv.exportWiki()).toEqual({ ok: false, reason: 'no generated wiki to export (run a generation first)' })
  })

  test('pushRuns additively pushes only runs/ transcripts (no mirror-clear of the wiki)', async () => {
    let script = ''
    const exec: SshExec = async (_t, _c, opts) => { script = opts?.stdin ?? ''; return ok('') }
    const wv = new SshWorkspaceVault('ssh://u@h:22/remote/repo', 'p1', cache, exec)
    mkdirSync(join(cache, 'p1', 'runs'), { recursive: true })
    mkdirSync(join(cache, 'p1', 'concepts'), { recursive: true })
    writeFileSync(join(cache, 'p1', 'runs', 'RUN-1.jsonl'), '{"seq":1}\n')
    writeFileSync(join(cache, 'p1', 'concepts', 'n.md'), '# n') // wiki — must NOT be pushed by pushRuns

    await wv.pushRuns()
    expect(script).toContain(`base64 -d > '/remote/repo/.apc-wiki/runs/RUN-1.jsonl'`)
    expect(script).not.toContain('concepts/n.md')
    expect(script).not.toContain('-mindepth 1 -maxdepth 1') // additive: no mirror-clear
  })
})
