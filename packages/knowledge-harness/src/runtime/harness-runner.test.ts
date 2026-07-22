import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KhState } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { RunLock } from './run-lock.js'
import { HarnessRunner, type Driver } from './harness-runner.js'

const ALL_OPEN = {
  enable_conversation_history_reader: true, auto_classify_documents: true,
  auto_create_node_proposals: true, auto_create_write_plan: true, auto_write_to_staging: true,
}

// A driver per pipeline state that emits one named artifact echoing its state.
function fakeDrivers(): Partial<Record<KhState, Driver>> {
  const states: KhState[] = ['PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
    'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED']
  const map: Partial<Record<KhState, Driver>> = {}
  for (const s of states) map[s] = async () => ({ artifacts: [{ name: 'out', data: { state: s } }] })
  return map
}

describe('HarnessRunner', () => {
  let dir: string
  let store: RunArtifactStore
  const now = () => '2026-06-02T00:00:00Z'
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-runner-')); store = new RunArtifactStore(dir) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('createRun persists a CREATED run', () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: {}, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    expect(store.loadRunState().state).toBe('CREATED')
    expect(store.readProgressEvents().map((event) => event.kind)).toEqual(['run_started'])
  })

  test('advance walks the full pipeline to HUMAN_REVIEW_REQUIRED, persisting each artifact', async () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(rs.history.map(h => h.state)).toEqual([
      'CREATED', 'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED', 'NODE_PROPOSALS_CREATED',
      'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED',
    ])
    expect(store.readArtifact(rs.artifacts['NODE_PROPOSALS_CREATED'][0])).toEqual({ state: 'NODE_PROPOSALS_CREATED' })
    const events = store.readProgressEvents()
    expect(events[0].kind).toBe('run_started')
    expect(events.at(-1)?.kind).toBe('run_completed')
    expect(events.filter((event) => event.kind === 'phase_started')).toHaveLength(9)
    expect(events.filter((event) => event.kind === 'phase_completed')).toHaveLength(9)
    expect(store.loadProgressSummary()?.status).toBe('completed')
  })

  test('a closed gate stops the walk at the prior state', async () => {
    const gates = new FeatureGate({ ...ALL_OPEN, auto_create_node_proposals: false })
    const runner = new HarnessRunner({ gates, drivers: fakeDrivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('DOCUMENTS_CLASSIFIED')  // stopped before NODE_PROPOSALS_CREATED
  })

  test('reopening the gate and calling advance again resumes from where it stopped', async () => {
    const closed = new FeatureGate({ ...ALL_OPEN, auto_create_node_proposals: false })
    const r1 = new HarnessRunner({ gates: closed, drivers: fakeDrivers(), now })
    r1.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    await r1.advance(store)
    const r2 = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now })
    const rs = await r2.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
  })

  test('a driver that throws records FAILED with the error message', async () => {
    const drivers = fakeDrivers()
    drivers['LEAD_MERGED'] = async () => { throw new Error('boom') }
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.error).toContain('boom')
    expect(store.readProgressEvents().slice(-2).map((event) => event.kind)).toEqual(['phase_failed', 'run_failed'])
  })

  test('advance is idempotent on terminal states — a FAILED run is not restarted', async () => {
    const drivers = fakeDrivers()
    drivers['LEAD_MERGED'] = async () => { throw new Error('boom') }
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    await runner.advance(store)
    // Re-advancing must NOT re-run the pipeline from the top.
    const healthy = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now })
    const rs = await healthy.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.history.filter(h => h.state === 'PROJECT_SCANNED')).toHaveLength(1)  // not re-walked
  })

  test('advance is idempotent on MERGED and HUMAN_REVIEW_REQUIRED', async () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    await runner.advance(store)
    const before = store.loadRunState()
    expect(before.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(await runner.advance(store)).toEqual(before)  // re-advance is a no-op
    // simulate a human MERGED then re-advance
    store.saveRunState({ ...before, state: 'MERGED', history: [...before.history, { state: 'MERGED', at: now() }] })
    const merged = await runner.advance(store)
    expect(merged.state).toBe('MERGED')
  })

  test('advance acquires and releases the project lock, even when the run FAILs', async () => {
    const drivers = fakeDrivers()
    drivers['LEAD_MERGED'] = async () => { throw new Error('boom') }
    const lock = new RunLock(dir, 'p1')
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now, lock })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    // lock was released in finally → a fresh holder can acquire
    expect(() => new RunLock(dir, 'p1').acquire('RUN-2')).not.toThrow()
  })

  test('advance refuses to run when another holder already owns the project lock', async () => {
    const lock = new RunLock(dir, 'p1')
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now, lock })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    new RunLock(dir, 'p1').acquire('OTHER')  // someone else holds it
    await expect(runner.advance(store)).rejects.toThrow(/already in progress/)
    // the foreign lock must survive — advance must not release a lock it did not acquire
    expect(() => new RunLock(dir, 'p1').acquire('RUN-3')).toThrow(/already in progress/)
  })

  test('advance reports each completed stage to onProgress in order', async () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: fakeDrivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const seen: string[] = []
    const final = await runner.advance(store, (rs) => seen.push(rs.state))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
    // the last reported state equals the run's final state
    expect(seen[seen.length - 1]).toBe(final.state)
  })

  test('a driver returning status:paused stops at the prior state with an awaiting marker (not FAILED)', async () => {
    const drivers: Partial<Record<KhState, Driver>> = {
      PROJECT_SCANNED: async () => ({ artifacts: [{ name: 'out', data: { s: 'PROJECT_SCANNED' } }] }),
      SOURCES_EXTRACTED: async () => ({ artifacts: [], status: 'paused', awaiting: 'node-confirmation' }),
    }
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('PROJECT_SCANNED')        // stayed at the last completed state
    expect(rs.awaiting).toBe('node-confirmation')
    expect(rs.error).toBeUndefined()                 // paused is not a failure
    const kinds = store.readProgressEvents().map((event) => event.kind)
    expect(kinds.at(-1)).toBe('phase_paused')
    expect(kinds).not.toContain('run_completed')
    expect(kinds).not.toContain('run_failed')
  })

  test('resuming a paused run advances once the driver no longer pauses', async () => {
    let pause = true
    const drivers: Partial<Record<KhState, Driver>> = {
      PROJECT_SCANNED: async () => ({ artifacts: [{ name: 'out', data: {} }] }),
      SOURCES_EXTRACTED: async () => pause ? { artifacts: [], status: 'paused', awaiting: 'x' } : { artifacts: [{ name: 'out', data: {} }] },
    }
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    await runner.advance(store)
    expect(store.loadRunState().awaiting).toBe('x')
    pause = false
    const rs = await runner.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(rs.awaiting).toBeUndefined()              // cleared on advance
  })

  test('a driver returning status:failed persists its artifacts then fails the run', async () => {
    const drivers: Partial<Record<KhState, Driver>> = {
      PROJECT_SCANNED: async () => ({ artifacts: [{ name: 'out', data: { state: 'PROJECT_SCANNED' } }] }),
      SOURCES_EXTRACTED: async () => ({
        artifacts: [{ name: 'kernel-lint-report', data: { ok: false, exit_code: 1, issues: ['boom'] } }],
        status: 'failed',
        error: 'lint failed',
      }),
    }
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.error).toBe('lint failed')
    const paths = rs.artifacts['SOURCES_EXTRACTED']
    expect(paths).toHaveLength(1)
    expect(store.readArtifact(paths[0])).toEqual({ ok: false, exit_code: 1, issues: ['boom'] })
  })

  test('writes state before completion/failure events and keeps a throwing live sink diagnostic-only', async () => {
    const observations: Array<{ kind: string; state: string }> = []
    const diagnostics: string[] = []
    const runner = new HarnessRunner({
      gates: new FeatureGate(ALL_OPEN),
      drivers: fakeDrivers(),
      now,
      eventSink: (event) => {
        observations.push({ kind: event.kind, state: store.loadRunState().state })
        throw new Error('live sink unavailable')
      },
      onEventError: (diagnostic) => diagnostics.push(`${diagnostic.stage}:${diagnostic.event.kind}`),
    })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const result = await runner.advance(store)

    expect(result.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(observations.find((item) => item.kind === 'phase_completed')).toEqual({
      kind: 'phase_completed', state: 'PROJECT_SCANNED',
    })
    expect(diagnostics.every((item) => item.startsWith('sink:'))).toBe(true)
    expect(store.readProgressEvents().at(-1)?.kind).toBe('run_completed')
  })
})
