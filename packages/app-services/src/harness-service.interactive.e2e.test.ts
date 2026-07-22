import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import type { WikiRunEvent } from '@apc/shared'
import { HarnessService } from './harness-service.js'

// repo root from packages/app-services/src/
const root = fileURLToPath(new URL('../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

/**
 * Build canned outputs for a fake LLM runner that proposes two nodes: a (id='a', proposal_id='pp-a')
 * and b (id='b', proposal_id='pp-b').  Both have verifiable evidence under raw/src-a and raw/src-b.
 * The lead's write_plan carries no node ops (they are generated deterministically from proposals by
 * renderNodeDoc inside the STAGING_WRITTEN driver — node-targeting ops in the lead plan are replaced).
 */
function cannedOutputs(): string[] {
  const proposals = {
    proposals: [
      {
        proposal_id: 'pp-a',
        proposed_by: 'extractor',
        created_at: '2026-06-19T00:00:00Z',
        node: { id: 'a', type: 'ConceptNode', title: 'A' },
        evidence: [{ evidence_id: 'EV-A1', source_id: 's-a', source_path: 'raw/src-a', evidence_type: 'direct' }],
        claims: [{ claim_id: 'CL-A1', text: 'claim about a', evidence_ids: ['EV-A1'] }],
      },
      {
        proposal_id: 'pp-b',
        proposed_by: 'extractor',
        created_at: '2026-06-19T00:00:00Z',
        node: { id: 'b', type: 'ConceptNode', title: 'B' },
        evidence: [{ evidence_id: 'EV-B1', source_id: 's-b', source_path: 'raw/src-b', evidence_type: 'direct' }],
        claims: [{ claim_id: 'CL-B1', text: 'claim about b', evidence_ids: ['EV-B1'] }],
      },
    ],
  }

  const lead = {
    graph_update_plan: {
      created_by: 'lead',
      node_ops: [
        { op: 'create', node_id: 'a', based_on_proposals: ['pp-a'], note: '', narrative: 'Node A narrative.' },
        { op: 'create', node_id: 'b', based_on_proposals: ['pp-b'], note: '', narrative: 'Node B narrative.' },
      ],
      edge_ops: [],
    },
    shared_promotion_plan: { created_by: 'lead' },
    stale_doc_report: { generated_by: 'lead' },
    write_plan: {
      write_plan_id: 'WP-E2E',
      created_by: 'lead',
      // No node ops here: the STAGING_WRITTEN driver replaces node-targeting ops with deterministically
      // rendered docs.  We only add a non-node canonical file to exercise the lead op passthrough.
      operations: [{ op: 'create_file', path: 'index.md', content: '# Index\n' }],
    },
  }

  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
    JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'raw/src-a', intent: 'canonical' }, { path: 'raw/src-b', intent: 'canonical' }] }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

/** Return the absolute paths of every *.md file under <runsRoot>/<runId>/vault-staging/nodes/ */
function listStagedNodeFiles(runsRoot: string, runId: string): string[] {
  const nodesDir = join(runsRoot, runId, 'vault-staging', 'nodes')
  if (!existsSync(nodesDir)) return []
  return readdirSync(nodesDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(nodesDir, f))
}

describe('interactive node-confirmation e2e', () => {
  let ws: string
  let runsRoot: string
  let vaultRoot: string

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-e2e-'))
    vaultRoot = join(ws, 'vault')
    runsRoot = join(ws, 'runs')
    // Create the vault with raw/ evidence files that the two proposals cite.
    mkdirSync(join(vaultRoot, 'raw'), { recursive: true })
    writeFileSync(join(vaultRoot, 'README.md'), '# v\n')
    writeFileSync(join(vaultRoot, 'raw', 'src-a'), 'evidence for a\nclaim about a\n')
    writeFileSync(join(vaultRoot, 'raw', 'src-b'), 'evidence for b\nclaim about b\n')
  })

  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  test('non-interactive run is unchanged (no pause, reaches review)', async () => {
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot, runsRoot, gatesPath, preamble: 'RULES',
      now: () => '2026-06-19T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok, r.reason).toBe(true)
    expect(['HUMAN_REVIEW_REQUIRED', 'MERGED']).toContain(r.finalState)
    // No pause: the run must reach a terminal (review/merged) state without awaiting anything.
    expect((r as { awaiting?: unknown }).awaiting ?? null).toBeNull()
  })

  test('interactive run pauses, and dropping a node removes it from staging', async () => {
    const activity: WikiRunEvent[] = []
    // ── Phase 1: the interactive run pauses at LEAD_MERGED waiting for node confirmation ──
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot, runsRoot, gatesPath, preamble: 'RULES',
      now: () => '2026-06-19T00:00:00Z',
    })
    const run = await svc.run(
      { projectId: 'p1', engine: 'claude', interactive: true },
      undefined,
      undefined,
      undefined,
      (event) => { activity.push(event) },
    )
    expect(run.finalState, run.reason).toBe('LEAD_MERGED')
    expect(svc.getProgress({ runId: run.runId })).toMatchObject({
      ok: true,
      active: false,
      summary: { status: 'waiting', health: 'interrupted' },
    })
    const pauseSeq = activity.at(-1)?.seq ?? 0

    // ── Phase 2: user approves only node 'a', dropping node 'b' ──
    // confirmNodes writes the approved list under LEAD_MERGED and resumes with an empty runner
    // (no further LLM calls are needed — WRITE_PLAN_CREATED and STAGING_WRITTEN are deterministic).
    const resumeSvc = new HarnessService({
      runner: new FakeAgentRunner([]),      // no more LLM outputs
      vaultRoot, runsRoot, gatesPath, preamble: 'RULES',
      now: () => '2026-06-19T00:00:00Z',
    })
    const done = await resumeSvc.confirmNodes(
      {
        runId: run.runId,
        approvedNodes: {
          nodes: [{ id: 'a', title: 'A', source_proposal_id: 'pp-a' }],
        },
      },
      (event) => { activity.push(event) },
    )
    expect(done.finalState, done.reason).toBe('HUMAN_REVIEW_REQUIRED')
    expect(activity.some((event) => event.seq > pauseSeq)).toBe(true)
    expect(activity.map((event) => event.seq)).toEqual([...activity.map((event) => event.seq)].sort((a, b) => a - b))
    expect(activity.some((event) => event.kind === 'node_accepted')).toBe(true)
    expect(activity.some((event) => event.kind === 'node_dropped')).toBe(true)
    expect(activity.at(-1)?.kind).toBe('run_completed')

    // ── Phase 3: verify staging contains a.md but NOT b.md ──
    const staged = listStagedNodeFiles(runsRoot, run.runId)
    expect(staged.some((p) => p.endsWith('a.md')), `expected a.md in ${staged.join(', ')}`).toBe(true)
    expect(staged.some((p) => p.endsWith('b.md')), `expected b.md to be absent; staged: ${staged.join(', ')}`).toBe(false)
  })
})
