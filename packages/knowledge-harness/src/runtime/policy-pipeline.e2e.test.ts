import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner } from './harness-runner.js'
import { makeDrivers } from './make-drivers.js'

const ALL_OPEN = {
  enable_conversation_history_reader: true, auto_classify_documents: true,
  auto_create_node_proposals: true, auto_create_write_plan: true, auto_write_to_staging: true,
}

function outputs(proposalsEvidence: boolean): string[] {
  const proposals = {
    proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: proposalsEvidence ? [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }] : [],
      claims: proposalsEvidence ? [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }] : [],
    }],
  }
  const lead = {
    graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' },
    stale_doc_report: { generated_by: 'lead' },
    write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '---\nnode_id: n1\n---\n# T\n' }] },
  }
  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
    JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'current.md', intent: 'canonical' }] }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

describe('phase-3 e2e — policy/verify/eval wired into the pipeline', () => {
  let ws: string
  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), 'kh-e2e3-')); mkdirSync(join(ws, 'vault', 'raw'), { recursive: true }); writeFileSync(join(ws, 'vault', 'current.md'), '# current\n'); writeFileSync(join(ws, 'vault', 'raw', 'a'), 'evidence source\n') })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function driveWith(evidence: boolean) {
    const store = new RunArtifactStore(join(ws, 'runs', 'RUN-1'))
    const drivers = makeDrivers({ runner: new FakeAgentRunner(outputs(evidence)), vaultRoot: join(ws, 'vault'), stagingRoot: join(ws, 'vault-staging'), preamble: 'RULES' })
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now: () => '2026-06-02T00:00:00Z' })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    return { store, runner }
  }

  test('a clean run reaches HUMAN_REVIEW_REQUIRED with validation reports + an eval report', async () => {
    const { store, runner } = driveWith(true)
    const rs = await runner.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')

    // the verifier ran over staging: the freshly-written, not-yet-linked node is (correctly) an orphan
    const graphReport = store.readArtifact<{ orphan_nodes: string[] }>(rs.artifacts['VALIDATED'].find(p => p.endsWith('graph-validation-report.json'))!)
    expect(graphReport.orphan_nodes).toContain(join('concepts', 'n1.md'))
    const evalReport = store.readArtifact<{ safety: { raw_modified: boolean }, evidence_quality: { node_proposals_total: number } }>(
      rs.artifacts['HUMAN_REVIEW_REQUIRED'].find(p => p.endsWith('eval-report.json'))!)
    expect(evalReport.safety.raw_modified).toBe(false)
    expect(evalReport.evidence_quality.node_proposals_total).toBe(1)
  })

  test('an evidence-less proposal is blocked by PolicyGuard → run FAILED', async () => {
    const { store, runner } = driveWith(false)
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.error).toContain('PolicyGuard blocked')
  })
})
