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

// Canned outputs in pipeline call order: discovery, reader, classifier, extractor, lead.
function cannedOutputs(): string[] {
  const proposals = {
    proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'Grid backtester' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's1', source_path: 'raw/sess.jsonl', evidence_type: 'decision' }],
      claims: [{ claim_id: 'CL-1', text: 'Chose grid strategy', evidence_ids: ['EV-1'] }],
    }],
  }
  const lead = {
    graph_update_plan: { created_by: 'lead', node_ops: [{ op: 'create', node_id: 'n1' }] },
    shared_promotion_plan: { created_by: 'lead', candidates: [] },
    stale_doc_report: { generated_by: 'lead', stale: [] },
    write_plan: {
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# Grid backtester\n' }],
    },
  }
  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery', repos: [{ path: '/r' }] }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1', work_summary: 'did stuff' }),
    JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'current.md', intent: 'canonical' }] }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

describe('makeDrivers (real agents, faked LLM)', () => {
  let ws: string
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-md-'))
    mkdirSync(join(ws, 'vault'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'README.md'), '# vault\n')
  })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  test('drives CREATED → HUMAN_REVIEW_REQUIRED, producing evidence-bearing proposals and a staging diff', async () => {
    const store = new RunArtifactStore(join(ws, 'runs', 'RUN-1'))
    const drivers = makeDrivers({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), stagingRoot: join(ws, 'vault-staging'), preamble: 'RULES',
    })
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now: () => '2026-06-02T00:00:00Z' })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const rs = await runner.advance(store)

    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')

    // real NodeProposal[] with evidence
    const proposals = store.readArtifact<{ proposals: { node: { id: string }, evidence: unknown[] }[] }>(rs.artifacts['NODE_PROPOSALS_CREATED'][0])
    expect(proposals.proposals[0].node.id).toBe('n1')
    expect(proposals.proposals[0].evidence).toHaveLength(1)

    // staging diff mentions the newly written concept file; real vault untouched
    const diff = store.readArtifact<{ patch: string }>(
      rs.artifacts['STAGING_WRITTEN'].find(p => p.endsWith('git-diff-report.json'))!,
    )
    expect(diff.patch).toContain('n1.md')
  })
})
