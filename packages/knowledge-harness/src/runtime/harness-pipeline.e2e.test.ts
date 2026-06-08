import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner } from './harness-runner.js'
import { makeDrivers } from './make-drivers.js'
import { loadPreamble } from '../agents/preamble.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

function cannedOutputs(): string[] {
  const proposals = {
    proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'DecisionNode', title: 'Use staging vault' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's1', source_path: 'raw/sess.jsonl', evidence_type: 'decision' }],
      claims: [{ claim_id: 'CL-1', text: 'Writers only touch staging', evidence_ids: ['EV-1'] }],
    }],
  }
  const lead = {
    graph_update_plan: { created_by: 'lead', node_ops: [{ op: 'create', node_id: 'n1' }] },
    shared_promotion_plan: { created_by: 'lead', candidates: [] },
    stale_doc_report: { generated_by: 'lead', stale: [] },
    write_plan: {
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [
        { op: 'create_file', path: 'decisions/n1.md', content: '# Use staging vault\n' },
        { op: 'create_file', path: 'current.md', content: '# proposed current\n', mode: 'proposal_only' },
      ],
    },
  }
  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1', work_summary: 'shipped staging vault' }),
    JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'current.md', intent: 'canonical' }] }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

describe('phase-2 e2e — LLM agents (faked) with shipped gates', () => {
  let ws: string
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-e2e2-'))
    mkdirSync(join(ws, 'vault', 'raw'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'current.md'), '# current\n')
    writeFileSync(join(ws, 'vault', 'raw', 'sess.jsonl'), 'shipped staging vault\n')  // A2: evidence source must exist
  })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  test('completes the pipeline; canonical doc is proposed (not overwritten), real vault untouched', async () => {
    const store = new RunArtifactStore(join(ws, 'runs', 'RUN-1'))
    const drivers = makeDrivers({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), stagingRoot: join(ws, 'vault-staging'), preamble: loadPreamble(),
    })
    const runner = new HarnessRunner({ gates: FeatureGate.fromFile(gatesPath), drivers, now: () => '2026-06-02T00:00:00Z' })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)

    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')

    // every proposal carries evidence (design §6.6)
    const np = store.readArtifact<{ proposals: { evidence: unknown[] }[] }>(rs.artifacts['NODE_PROPOSALS_CREATED'][0])
    expect(np.proposals.every(p => p.evidence.length >= 1)).toBe(true)

    // writer wrote the concept into staging, routed canonical to a .proposal.md, never overwrote current.md
    expect(existsSync(join(ws, 'vault-staging', 'decisions', 'n1.md'))).toBe(true)
    expect(existsSync(join(ws, 'vault-staging', 'current.proposal.md'))).toBe(true)
    // real vault current.md is the original, untouched
    expect(existsSync(join(ws, 'vault', 'decisions', 'n1.md'))).toBe(false)

    const applied = store.readArtifact<{ applied: string[]; proposals: string[] }>(
      rs.artifacts['STAGING_WRITTEN'].find(p => p.endsWith('applied-write-report.json'))!,
    )
    expect(applied.applied).toContain('decisions/n1.md')
    expect(applied.proposals).toContain('current.proposal.md')

    // coverage-report artifact is emitted at HUMAN_REVIEW_REQUIRED
    const artifacts = Object.values(rs.artifacts).flat()
    const coverageArtifact = artifacts.find((a) => a.endsWith('coverage-report.json'))
    expect(coverageArtifact).toBeDefined()
    const coverage = store.readArtifact<{ totals: { sourcesTotal: number; covered: number; unmapped: number } }>(coverageArtifact!)
    expect(typeof coverage.totals.sourcesTotal).toBe('number')
    expect(coverage.totals.covered + coverage.totals.unmapped).toBe(coverage.totals.sourcesTotal)
  })
})
