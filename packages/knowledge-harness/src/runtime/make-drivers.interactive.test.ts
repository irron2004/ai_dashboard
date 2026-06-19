import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from './run-artifact-store.js'
import { makeDrivers, ARTIFACTS } from './make-drivers.js'
import { FakeAgentRunner } from '@apc/llm-wiki'
import type { RunnerContext } from './harness-runner.js'

function ctxWith(store: RunArtifactStore, seed: Array<{ state: string; name: string; data: unknown }>): RunnerContext {
  const artifacts: Record<string, string[]> = {}
  for (const s of seed) (artifacts[s.state] ??= []).push(store.writeArtifact(s.state as never, s.name, s.data))
  const runState = { runId: 'R', projectId: 'p', engine: 'claude', state: 'LEAD_MERGED', history: [], artifacts } as never
  return { runId: 'R', projectId: 'p', engine: 'claude', store, runState } as RunnerContext
}

describe('interactive WRITE_PLAN_CREATED gating', () => {
  let dir: string, store: RunArtifactStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-int-')); store = new RunArtifactStore(join(dir, 'run')); store.init() })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('interactive run with no approved-nodes pauses', async () => {
    const drivers = makeDrivers({ runner: new FakeAgentRunner([]), vaultRoot: dir, stagingRoot: dir, preamble: '', interactive: true })
    const ctx = ctxWith(store, [{ state: 'LEAD_MERGED', name: ARTIFACTS.leadWritePlan, data: { operations: [] } }])
    const res = await drivers.WRITE_PLAN_CREATED!(ctx)
    expect(res.status).toBe('paused')
    expect(res.awaiting).toBe('node-confirmation')
  })

  test('interactive run with approved-nodes proceeds (no pause)', async () => {
    const drivers = makeDrivers({ runner: new FakeAgentRunner([]), vaultRoot: dir, stagingRoot: dir, preamble: '', interactive: true })
    const ctx = ctxWith(store, [
      { state: 'LEAD_MERGED', name: ARTIFACTS.leadWritePlan, data: { operations: [] } },
      { state: 'LEAD_MERGED', name: ARTIFACTS.approvedNodes, data: { nodes: [{ id: 'a', title: 'A' }] } },
    ])
    const res = await drivers.WRITE_PLAN_CREATED!(ctx)
    expect(res.status ?? 'ok').toBe('ok')
  })
})

describe('STAGING_WRITTEN consumes approved-nodes', () => {
  let dir: string, store: RunArtifactStore, stagingDir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kh-stg-'))
    stagingDir = mkdtempSync(join(tmpdir(), 'kh-stg-out-'))
    store = new RunArtifactStore(join(dir, 'run'))
    store.init()
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(stagingDir, { recursive: true, force: true }) })

  const proposal = (id: string, title: string) => ({
    proposal_id: `pp-${id}`, proposed_by: 'x', created_at: '2026-01-01T00:00:00Z',
    node: { id, type: 'ConceptNode', title, scope: 'project' },
    evidence: [{ evidence_id: `ev-${id}`, source_id: `s-${id}`, source_path: `raw/${id}.md`, evidence_type: 'decision' as const, quote_or_summary: `evidence for ${id}` }],
    claims: [{ claim_id: `cl-${id}`, text: `claim for ${id}`, evidence_ids: [`ev-${id}`] }],
  })

  test('removing a node from the approved list drops its rendered doc', async () => {
    const drivers = makeDrivers({ runner: new FakeAgentRunner([]), vaultRoot: dir, stagingRoot: stagingDir, preamble: '', interactive: true })
    const ctx = ctxWith(store, [
      { state: 'NODE_PROPOSALS_CREATED', name: ARTIFACTS.nodeProposals, data: { proposals: [proposal('a', 'A'), proposal('b', 'B')] } },
      { state: 'LEAD_MERGED', name: ARTIFACTS.graphUpdatePlan, data: { node_ops: [], edge_ops: [] } },
      { state: 'WRITE_PLAN_CREATED', name: ARTIFACTS.writePlan, data: { write_plan_id: 'WP-test', created_by: 'test', operations: [] } },
      { state: 'LEAD_MERGED', name: ARTIFACTS.approvedNodes, data: { nodes: [{ id: 'a', title: 'A', source_proposal_id: 'pp-a' }] } },
    ])
    const res = await drivers.STAGING_WRITTEN!(ctx)
    const applied = res.artifacts.find((a) => a.name === ARTIFACTS.appliedWriteReport)!.data as { applied: string[] }
    const nodePaths = applied.applied.filter((p) => /nodes\/.+\.md$/.test(p))
    expect(nodePaths.some((p) => p.includes('a.md'))).toBe(true)
    expect(nodePaths.some((p) => p.includes('b.md'))).toBe(false)  // b removed by the user
  })
})
