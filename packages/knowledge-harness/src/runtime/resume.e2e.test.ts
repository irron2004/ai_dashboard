import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner } from './harness-runner.js'
import { makeDrivers } from './make-drivers.js'

const lead = {
  graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
  write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# T\n' }] },
}
const proposals = { proposals: [{
  proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
  node: { id: 'n1', type: 'ConceptNode', title: 'T' },
  evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
  claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
}] }

describe('resume mid-pipeline with REAL drivers (cross-step on-disk artifact reload)', () => {
  let ws: string
  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), 'kh-resume-')); mkdirSync(join(ws, 'vault', 'raw'), { recursive: true }); writeFileSync(join(ws, 'vault', 'README.md'), '#\n'); writeFileSync(join(ws, 'vault', 'raw', 'a'), 'evidence source\n') })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  test('a run stopped by a closed gate resumes via a NEW runner+runner-backend, reusing on-disk artifacts', async () => {
    const store = new RunArtifactStore(join(ws, 'runs', 'RUN-1'))
    const driverDeps = { vaultRoot: join(ws, 'vault'), stagingRoot: join(ws, 'runs', 'RUN-1', 'vault-staging'), preamble: 'RULES' }

    // First runner: gate auto_create_node_proposals CLOSED. Only discovery/reader/classifier run (3 LLM calls),
    // then the walk stops at DOCUMENTS_CLASSIFIED.
    const closed = new FeatureGate({ enable_conversation_history_reader: true, auto_classify_documents: true, auto_create_node_proposals: false, auto_create_write_plan: true, auto_write_to_staging: true })
    const r1 = new HarnessRunner({ gates: closed, now: () => '2026-06-02T00:00:00Z', drivers: makeDrivers({
      runner: new FakeAgentRunner([
        JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
        JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
        JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'current.md', intent: 'canonical' }] }),
      ]), ...driverDeps }) })
    r1.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
    const stopped = await r1.advance(store)
    expect(stopped.state).toBe('DOCUMENTS_CLASSIFIED')

    // Second runner: a FRESH FakeAgentRunner seeded ONLY with the outputs for the states that re-execute
    // from startIdx+1 (extractor + lead). discovery/reader/classifier artifacts are reloaded from disk.
    const open = new FeatureGate({ enable_conversation_history_reader: true, auto_classify_documents: true, auto_create_node_proposals: true, auto_create_write_plan: true, auto_write_to_staging: true })
    const fresh = new FakeAgentRunner([JSON.stringify(proposals), JSON.stringify(lead)])
    const r2 = new HarnessRunner({ gates: open, now: () => '2026-06-02T00:00:00Z', drivers: makeDrivers({ runner: fresh, ...driverDeps }) })
    const done = await r2.advance(new RunArtifactStore(join(ws, 'runs', 'RUN-1')))

    expect(done.state).toBe('HUMAN_REVIEW_REQUIRED')
    // The extractor (first call of the fresh runner) was fed the CONTENT of the SOURCES_EXTRACTED /
    // DOCUMENTS_CLASSIFIED artifacts the FIRST runner wrote to disk — proving cross-step reload across
    // runner instances. The reader report had session_id 's1'; the classifier doc had intent 'canonical'.
    expect(fresh.calls).toHaveLength(2)
    expect(fresh.calls[0].prompt).toContain('"session_id": "s1"')
    expect(fresh.calls[0].prompt).toContain('canonical')
  })
})
