import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KhState } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
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
  })
})
