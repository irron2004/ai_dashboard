import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { KhState } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner, type Driver } from './harness-runner.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

function fakeDrivers(): Partial<Record<KhState, Driver>> {
  const states: KhState[] = ['PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
    'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED']
  const map: Partial<Record<KhState, Driver>> = {}
  for (const s of states) map[s] = async () => ({ artifacts: [{ name: 'out', data: { state: s } }] })
  return map
}

describe('pipeline e2e with shipped gates', () => {
  let workspace: string
  beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'kh-ws-')) })
  afterEach(() => { rmSync(workspace, { recursive: true, force: true }) })

  test('a run reaches HUMAN_REVIEW_REQUIRED and persists run.json + artifacts', async () => {
    const store = new RunArtifactStore(join(workspace, 'runs', 'RUN-1'))
    const runner = new HarnessRunner({ gates: FeatureGate.fromFile(gatesPath), drivers: fakeDrivers(), now: () => '2026-06-02T00:00:00Z' })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)

    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(existsSync(join(workspace, 'runs', 'RUN-1', 'run.json'))).toBe(true)
    expect(existsSync(join(workspace, 'runs', 'RUN-1', 'artifacts', 'VALIDATED', 'out.json'))).toBe(true)

    // run.json on disk is loadable and self-consistent (resumability contract).
    const reloaded = new RunArtifactStore(join(workspace, 'runs', 'RUN-1')).loadRunState()
    expect(reloaded.state).toBe('HUMAN_REVIEW_REQUIRED')
    expect(Object.keys(reloaded.artifacts)).toContain('NODE_PROPOSALS_CREATED')
  })
})
