import { test, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevHarnessService } from './dev-harness-service.js'
import type { DevHarnessCli, DevHarnessCliInput, DevHarnessCliResult } from './dev-harness-cli.js'

function fakeRuns() {
  const rows = new Map<string, Record<string, unknown>>()
  const store = {
    create: (r: Record<string, unknown>) => { rows.set(r.id as string, { ...r }) },
    complete: (id: string, p: Record<string, unknown>) => { Object.assign(rows.get(id)!, { status: 'completed', ...p }) },
    fail: (id: string, p: Record<string, unknown>) => { Object.assign(rows.get(id)!, { status: 'failed', ...p }) },
  }
  return { store, rows }
}
const runsRoot = () => mkdtempSync(join(tmpdir(), 'devharness-'))
const okRegistry = { get: () => ({ repoPaths: ['/proj'] }) }
const cliOf = (run: (i: DevHarnessCliInput) => Promise<DevHarnessCliResult>) => ({ run }) as unknown as DevHarnessCli

test('records running→completed on exit 0 and fans out logs + transcript', async () => {
  const { store, rows } = fakeRuns()
  const root = runsRoot()
  const cli = cliOf(async (i) => { i.onChunk?.('stdout', 'hi'); return { exitCode: 0, stdout: 'hi', stderr: '' } })
  const logs: unknown[] = []
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: root })
  const res = await svc.run({ projectId: 'P', taskId: 'req:P:s1' }, (e) => logs.push(e))
  expect(res.ok).toBe(true)
  const row = [...rows.values()][0]
  expect(row).toMatchObject({ status: 'completed', agent: 'harness', taskId: 'req:P:s1', repoPath: '/proj' })
  expect(String(row.transcriptPath)).toContain('.agent-runs')
  expect(logs[0]).toMatchObject({ stream: 'stdout', chunk: 'hi', label: 'harness' })
  expect(existsSync(String(row.transcriptPath))).toBe(true)
  expect(readFileSync(String(row.transcriptPath), 'utf8')).toBe('hi')
})

test('records failed on non-zero exit with reason', async () => {
  const { store, rows } = fakeRuns()
  const cli = cliOf(async () => ({ exitCode: 2, stdout: '', stderr: 'boom' }))
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  const res = await svc.run({ projectId: 'P', taskId: 'T' })
  expect(res.ok).toBe(false)
  expect(res.exitCode).toBe(2)
  expect(res.reason).toContain('2')
  expect([...rows.values()][0].status).toBe('failed')
})

test('passes workflow/graphProfile through to the cli', async () => {
  const { store } = fakeRuns()
  let seen: DevHarnessCliInput | undefined
  const cli = cliOf(async (i) => { seen = i; return { exitCode: 0, stdout: '', stderr: '' } })
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  await svc.run({ projectId: 'P', taskId: 'T', workflow: 'wf', graphProfile: 'gp' })
  expect(seen).toMatchObject({ root: '/proj', taskId: 'T', workflow: 'wf', graphProfile: 'gp' })
})

test('guards missing project (no run record, no cli call)', async () => {
  const { store, rows } = fakeRuns()
  let called = false
  const cli = cliOf(async () => { called = true; return { exitCode: 0, stdout: '', stderr: '' } })
  const svc = new DevHarnessService({ cli, runs: store as never, registry: { get: () => undefined }, runsRoot: runsRoot() })
  const res = await svc.run({ projectId: 'X', taskId: 'T' })
  expect(res.ok).toBe(false)
  expect(rows.size).toBe(0)
  expect(called).toBe(false)
})

test('cancel aborts an active run → failed/cancelled', async () => {
  const { store, rows } = fakeRuns()
  const cli = cliOf((i) => new Promise<DevHarnessCliResult>((resolve) => {
    i.signal?.addEventListener('abort', () => resolve({ exitCode: null, stdout: '', stderr: '', error: 'cancelled' }))
  }))
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  const p = svc.run({ projectId: 'P', taskId: 'T' })
  await new Promise((r) => setTimeout(r, 0))
  const runId = [...rows.keys()][0]
  expect(svc.cancel({ runId }).ok).toBe(true)
  const res = await p
  expect(res.ok).toBe(false)
  expect(res.reason).toBe('cancelled')
  expect(rows.get(runId)!.status).toBe('failed')
})

test('transcript dir segment is filesystem-safe (no colons — Windows)', async () => {
  const { store, rows } = fakeRuns()
  const cli = cliOf(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: '/runs' })
  await svc.run({ projectId: 'P', taskId: 'T' })
  const tp = String([...rows.values()][0].transcriptPath)
  // the path segment(s) under .agent-runs must not contain ':' (illegal in a Windows path component)
  expect(tp.split('.agent-runs')[1]).not.toContain(':')
})

test('two same-project runs in the same millisecond get distinct ids (no clobber)', async () => {
  const { store, rows } = fakeRuns()
  const cli = cliOf(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
  const now = () => '2026-07-01T00:00:00.000Z' // identical timestamp for both runs
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: runsRoot(), now })
  await svc.run({ projectId: 'P', taskId: 'T' })
  await svc.run({ projectId: 'P', taskId: 'T' })
  expect(rows.size).toBe(2)
})

test('cancel of unknown/ended run is a no-op', () => {
  const { store } = fakeRuns()
  const cli = cliOf(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  expect(svc.cancel({ runId: 'nope' }).ok).toBe(false)
})
