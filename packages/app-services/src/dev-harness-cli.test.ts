import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { DevHarnessCli } from './dev-harness-cli.js'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; kill: (s?: unknown) => boolean; killed?: unknown
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = (s?: unknown) => { child.killed = s ?? true; return true }
  return child
}

test('builds entry/argv/env from CLI contract', async () => {
  let captured: { cmd: string; args: string[]; opts: { cwd?: string; env?: NodeJS.ProcessEnv } } | undefined
  const child = fakeChild()
  const cli = new DevHarnessCli(((cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => { captured = { cmd, args, opts }; return child }) as never)
  const p = cli.run({ root: '/proj', taskId: 'T2', workflow: 'wf', graphProfile: 'gp' })
  child.emit('close', 0); await p
  expect(captured!.cmd).toBe(join('/proj', 'agents_up.sh'))
  expect(captured!.args).toEqual(['T2', '--workflow', 'wf', '--graph-profile', 'gp'])
  expect(captured!.opts.env?.ROOT).toBe('/proj')
  expect(captured!.opts.cwd).toBe('/proj')
})

test('omits optional flags when not provided', async () => {
  let captured: { args: string[] } | undefined
  const child = fakeChild()
  const cli = new DevHarnessCli(((_cmd: string, args: string[]) => { captured = { args }; return child }) as never)
  const p = cli.run({ root: '/r', taskId: 'T' })
  child.emit('close', 0); await p
  expect(captured!.args).toEqual(['T'])
})

test('streams stdout/stderr and resolves exit code', async () => {
  const child = fakeChild()
  const cli = new DevHarnessCli((() => child) as never)
  const chunks: string[] = []
  const p = cli.run({ root: '/r', taskId: 'T', onChunk: (s, t) => chunks.push(`${s}:${t}`) })
  child.stdout.emit('data', Buffer.from('hi'))
  child.stderr.emit('data', Buffer.from('warn'))
  child.emit('close', 0)
  const res = await p
  expect(res).toMatchObject({ exitCode: 0, stdout: 'hi', stderr: 'warn' })
  expect(chunks).toEqual(['stdout:hi', 'stderr:warn'])
})

test('non-zero exit code is reported', async () => {
  const child = fakeChild()
  const cli = new DevHarnessCli((() => child) as never)
  const p = cli.run({ root: '/r', taskId: 'T' })
  child.emit('close', 3)
  expect(await p).toMatchObject({ exitCode: 3 })
})

test('reassembles a multibyte char split across chunk boundaries', async () => {
  const child = fakeChild()
  const cli = new DevHarnessCli((() => child) as never)
  const chunks: string[] = []
  const p = cli.run({ root: '/r', taskId: 'T', onChunk: (_s, t) => chunks.push(t) })
  const buf = Buffer.from('가') // 3 UTF-8 bytes
  child.stdout.emit('data', buf.subarray(0, 2)) // partial — must be buffered, not emitted as garbage
  child.stdout.emit('data', buf.subarray(2))
  child.emit('close', 0)
  const res = await p
  expect(res.stdout).toBe('가')
  expect(chunks.join('')).toBe('가')
})

test('spawn error → exitCode null + error', async () => {
  const child = fakeChild()
  const cli = new DevHarnessCli((() => child) as never)
  const p = cli.run({ root: '/r', taskId: 'T' })
  child.emit('error', new Error('ENOENT agents_up.sh'))
  const res = await p
  expect(res.exitCode).toBeNull()
  expect(res.error).toContain('ENOENT')
})

test('abort signal kills child → cancelled', async () => {
  const child = fakeChild()
  const cli = new DevHarnessCli((() => child) as never)
  const ac = new AbortController()
  const p = cli.run({ root: '/r', taskId: 'T', signal: ac.signal })
  ac.abort()
  const res = await p
  expect(res.error).toBe('cancelled')
  expect(child.killed).toBe('SIGTERM')
})

test('already-aborted signal cancels immediately', async () => {
  const child = fakeChild()
  const cli = new DevHarnessCli((() => child) as never)
  const res = await cli.run({ root: '/r', taskId: 'T', signal: AbortSignal.abort() })
  expect(res.error).toBe('cancelled')
})
