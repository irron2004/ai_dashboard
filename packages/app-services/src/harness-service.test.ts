import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { RunLock, RunArtifactStore } from '@apc/knowledge-harness'
import { HarnessService } from './harness-service.js'

// repo root from packages/app-services/src/
const root = fileURLToPath(new URL('../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

function cannedOutputs(): string[] {
  const proposals = { proposals: [{
    proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
    claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
  }] }
  const lead = {
    graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
    write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# T\n' }] },
  }
  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
    JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'current.md', intent: 'canonical' }] }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

describe('HarnessService', () => {
  let ws: string
  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), 'kh-svc-')); mkdirSync(join(ws, 'vault'), { recursive: true }); writeFileSync(join(ws, 'vault', 'README.md'), '# v\n') })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function service() {
    return new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
  }

  test('run → show → promote round-trips: run completes, show returns state, promote writes vault', async () => {
    const svc = service()
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')

    const shown = svc.show({ runId: r.runId })
    expect(shown.ok).toBe(true)
    if (shown.ok) expect(shown.runState.state).toBe('HUMAN_REVIEW_REQUIRED')

    const promoted = svc.promote({ runId: r.runId })
    expect(promoted.ok).toBe(true)
    if (promoted.ok) expect(promoted.promoted).toContain('concepts/n1.md')
    expect(existsSync(join(ws, 'vault', 'concepts', 'n1.md'))).toBe(true)
  })

  test('show reports an unknown run', () => {
    expect(service().show({ runId: 'NOPE' })).toEqual({ ok: false, reason: 'run not found: NOPE' })
  })

  test('resume continues a run paused by a closed gate after the gate is reopened (acceptance #6)', async () => {
    const gatesFile = join(ws, 'gates.yml')
    const writeGates = (proposalsGate: boolean) => writeFileSync(gatesFile, [
      'features:',
      '  enable_conversation_history_reader: true',
      '  auto_classify_documents: true',
      `  auto_create_node_proposals: ${proposalsGate}`,
      '  auto_create_write_plan: true',
      '  auto_write_to_staging: true',
    ].join('\n'))
    const mk = (runner: FakeAgentRunner) => new HarnessService({
      runner, vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath: gatesFile, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })

    // gate CLOSED → run stops at DOCUMENTS_CLASSIFIED (discovery/reader/classifier only = 3 LLM calls)
    writeGates(false)
    const first = await mk(new FakeAgentRunner([
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
    ])).run({ projectId: 'p1', engine: 'claude' })
    expect(first.finalState).toBe('DOCUMENTS_CLASSIFIED')

    // operator reopens the gate, then resumes — a FRESH runner seeded only with the states that re-run
    writeGates(true)
    const lead = { graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' }, write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# T\n' }] } }
    const resumed = await mk(new FakeAgentRunner([
      JSON.stringify({ proposals: [{ proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z', node: { id: 'n1', type: 'ConceptNode', title: 'T' }, evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }], claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }] }] }),
      JSON.stringify(lead),
    ])).resume({ runId: first.runId })
    expect(resumed.finalState).toBe('HUMAN_REVIEW_REQUIRED')
  })

  test('resume reports an unknown run', async () => {
    const r = await service().resume({ runId: 'NOPE' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('run not found')
  })

  test('resume of an already-terminal run says "nothing to resume" (not a generic failure)', async () => {
    const svc = service()
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })  // completes to HUMAN_REVIEW_REQUIRED
    // simulate a human merge → terminal MERGED
    const store = new RunArtifactStore(join(ws, 'runs', r.runId))
    const rs = store.loadRunState()
    store.saveRunState({ ...rs, state: 'MERGED', history: [...rs.history, { state: 'MERGED', at: '2026-06-02T00:00:00Z' }] })
    const resumed = await svc.resume({ runId: r.runId })
    expect(resumed.ok).toBe(false)
    expect(resumed.finalState).toBe('MERGED')
    expect(resumed.reason).toMatch(/already MERGED — nothing to resume/)
  })

  test('a concurrent run for the same project returns a structured failure, not an unhandled throw', async () => {
    // someone else already holds the project lock
    new RunLock(join(ws, 'runs', '.locks'), 'p1').acquire('OTHER')
    const r = await service().run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/already in progress/)
  })

  test('a PolicyGuard block surfaces as FAILED with a reason (not dropped)', async () => {
    // evidence-less proposal → PolicyGuard blocks → run FAILED
    const proposals = { proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' }, evidence: [], claims: [],
    }] }
    const outs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify(proposals),
    ]
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outs), vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(false)
    expect(r.finalState).toBe('FAILED')
    expect(r.reason).toContain('PolicyGuard blocked')  // error message preserved end-to-end
  })

  test('a secret in staged content lets the run finish but BLOCKS promotion (allowSecrets overrides)', async () => {
    const proposals = { proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    }] }
    const lead = {
      graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
      // the staged file body carries an AWS key
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# T\nkey AKIAIOSFODNN7EXAMPLE\n' }] },
    }
    const outs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify(proposals), JSON.stringify(lead),
    ]
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outs), vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')  // secret is warn-level: run completes for review
    expect(svc.promote({ runId: r.runId }).ok).toBe(false)                 // ...but promotion is blocked
    expect(svc.promote({ runId: r.runId, allowSecrets: true }).ok).toBe(true)  // explicit human override
  })
})
