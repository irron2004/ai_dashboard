import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStateSchema } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'

describe('RunArtifactStore', () => {
  let dir: string
  let store: RunArtifactStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-run-')); store = new RunArtifactStore(dir) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('init creates the run subdirectories', () => {
    store.init()
    for (const d of ['inputs', 'artifacts', 'proposals', 'validation']) {
      expect(existsSync(join(dir, d))).toBe(true)
    }
  })

  test('saveRunState / loadRunState round-trips via schema', () => {
    const rs = RunStateSchema.parse({ runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED' })
    store.saveRunState(rs)
    expect(store.loadRunState()).toEqual(rs)
  })

  test('writeArtifact persists JSON under artifacts/<STATE>/ and returns its relative path; readArtifact reads it back', () => {
    const rel = store.writeArtifact('PROJECT_SCANNED', 'report', { hello: 'world' })
    expect(rel).toBe(join('artifacts', 'PROJECT_SCANNED', 'report.json'))
    expect(store.readArtifact(rel)).toEqual({ hello: 'world' })
  })

  test('exists reflects whether run.json is present', () => {
    expect(store.exists()).toBe(false)
    store.saveRunState(RunStateSchema.parse({ runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED' }))
    expect(store.exists()).toBe(true)
  })

  test('writes leave no .tmp residue (atomic temp+rename)', () => {
    store.saveRunState(RunStateSchema.parse({ runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED' }))
    store.writeArtifact('PROJECT_SCANNED', 'report', { hello: 'world' })
    const stray = readdirSync(dir, { recursive: true }) as string[]
    expect(stray.filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  test('missingArtifacts flags indexed artifact paths absent on disk (resume validation)', () => {
    const rel = store.writeArtifact('PROJECT_SCANNED', 'report', { a: 1 })
    const rs = RunStateSchema.parse({
      runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'PROJECT_SCANNED',
      artifacts: { PROJECT_SCANNED: [rel, join('artifacts', 'PROJECT_SCANNED', 'ghost.json')] },
    })
    expect(store.missingArtifacts(rs)).toEqual([join('artifacts', 'PROJECT_SCANNED', 'ghost.json')])
  })

  test('serializes concurrent progress appends and continues monotonic seq after restart', async () => {
    store = new RunArtifactStore(dir, { eventId: (seq) => `event-${seq}` })
    const base = { runId: 'RUN-1', projectId: 'p1' }
    const appended = await Promise.all([
      store.appendProgressEvent({ ...base, at: '2026-07-20T10:00:00Z', kind: 'run_started' }),
      store.appendProgressEvent({ ...base, at: '2026-07-20T10:00:01Z', kind: 'work_planned', total: 1 }),
      store.appendProgressEvent({
        ...base, at: '2026-07-20T10:00:02Z', kind: 'worker_started', workerId: 'w1', folder: 'src', attempt: 1,
      }),
    ])
    expect(appended.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(store.readProgressEvents().map((event) => event.eventId)).toEqual(['event-1', 'event-2', 'event-3'])

    const restarted = new RunArtifactStore(dir, { eventId: (seq) => `restart-${seq}` })
    const completed = await restarted.appendProgressEvent({
      ...base, at: '2026-07-20T10:00:03Z', kind: 'worker_completed', workerId: 'w1', folder: 'src', attempt: 1,
    })
    expect(completed.seq).toBe(4)
    expect(restarted.loadProgressSummary()).toMatchObject({
      runId: 'RUN-1', work: { total: 1, completed: 1, inProgress: 0, failed: 0, retries: 0 },
    })
  })

  test('replays through the last complete JSONL event and repairs a truncated crash tail on append', async () => {
    const base = { runId: 'RUN-1', projectId: 'p1' }
    await store.appendProgressEvent({ ...base, at: '2026-07-20T10:00:00Z', kind: 'run_started' })
    await store.appendProgressEvent({ ...base, at: '2026-07-20T10:00:01Z', kind: 'phase_started', phase: 'PROJECT_SCANNED' })
    appendFileSync(join(dir, 'progress.jsonl'), '{"version":1,"seq":3')

    expect(store.readProgressEvents().map((event) => event.seq)).toEqual([1, 2])
    const restarted = new RunArtifactStore(dir)
    const next = await restarted.appendProgressEvent({
      ...base, at: '2026-07-20T10:00:02Z', kind: 'phase_completed', phase: 'PROJECT_SCANNED',
    })
    expect(next.seq).toBe(3)
    expect(restarted.readProgressEvents().map((event) => event.seq)).toEqual([1, 2, 3])
  })

  test('does not silently ignore a malformed complete line in the middle of the journal', async () => {
    await store.appendProgressEvent({
      runId: 'RUN-1', projectId: 'p1', at: '2026-07-20T10:00:00Z', kind: 'run_started',
    })
    appendFileSync(join(dir, 'progress.jsonl'), 'not-json\n')
    expect(() => store.readProgressEvents()).toThrow('Invalid progress journal line 2')
  })

  test('atomically rebuilds progress-summary.json from the journal without temp residue', async () => {
    const base = { runId: 'RUN-1', projectId: 'p1' }
    await store.appendProgressEvent({ ...base, at: '2026-07-20T10:00:00Z', kind: 'run_started' })
    await store.appendProgressEvent({ ...base, at: '2026-07-20T10:00:01Z', kind: 'work_planned', total: 2 })
    rmSync(join(dir, 'progress-summary.json'))

    expect(store.loadProgressSummary()).toBeUndefined()
    expect(store.rebuildProgressSummary()).toMatchObject({ runId: 'RUN-1', work: { total: 2 } })
    expect(existsSync(join(dir, 'progress-summary.json'))).toBe(true)
    expect(readdirSync(dir).filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })
})
