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
  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), 'kh-svc-')); mkdirSync(join(ws, 'vault', 'raw'), { recursive: true }); writeFileSync(join(ws, 'vault', 'README.md'), '# v\n'); writeFileSync(join(ws, 'vault', 'raw', 'a'), 'evidence source\n') })
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

  // A2 (#1/#7/#34): a proposal citing a source_path that doesn't exist under raw/ fails the run.
  test('fabricated evidence (source_path not in raw/) → run FAILED', async () => {
    const proposals = { proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/ghost.jsonl', evidence_type: 'd' }],
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    }] }
    const svc = new HarnessService({
      runner: new FakeAgentRunner([
        JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
        JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
        JSON.stringify({ generated_by: 'classifier', documents: [] }),
        JSON.stringify(proposals),
      ]),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'), gatesPath, preamble: 'RULES',
      now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(false)
    expect(r.finalState).toBe('FAILED')
    expect(r.reason).toContain('EvidenceVerifier')
  })

  // D1: a bundled Electron app cannot reach harness/ via import.meta.url path-walking. Constructing the
  // service with NO gatesPath/preamble must boot from the compiled-in defaults and run end-to-end.
  test('boots and runs with NO gatesPath/preamble (packaged-app, fs-free defaults)', async () => {
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      now: () => '2026-06-02T00:00:00Z',
      // intentionally omit gatesPath + preamble → embedded DEFAULT_GATES_YAML / DEFAULT_PREAMBLE
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')
  })

  // A stale/unreadable override path must not block boot — it falls back to the embedded defaults.
  test('falls back to embedded defaults when gatesPath points at a missing file', async () => {
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath: join(ws, 'does-not-exist', 'feature-gates.yml'),
      now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')
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

  test('run({ materialize: true }) copies project docs into raw/project-docs before running', async () => {
    // Build `harness` + `vaultRoot` exactly as the other tests in this file do (reuse their setup/helpers).
    const harness = service()
    const vaultRoot = join(ws, 'vault')
    const repo = join(ws, 'repo')              // `ws` = the temp root the other tests use
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'GUIDE.md'), '# guide')

    await harness.run({ projectId: 'p1', engine: 'claude', materialize: true, repoPaths: [repo] })

    expect(existsSync(join(vaultRoot, 'raw', 'project-docs', '0', 'GUIDE.md'))).toBe(true)
  })

  test('runs the engine CLI with the project repoPath as cwd', async () => {
    const runner = new FakeAgentRunner(cannedOutputs())
    const harness = new HarnessService({
      runner, vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const repo = join(ws, 'repo')
    await harness.run({ projectId: 'p1', engine: 'claude', repoPaths: [repo] })
    expect(runner.calls.length).toBeGreaterThan(0)
    expect(runner.calls[0].cwd).toBe(repo)
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

  const proposalsWith = () => ({ proposals: [{
    proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
    claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
  }] })

  test('a secret in a write-op body FAILS the run before staging (#21/#22)', async () => {
    const lead = {
      graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
      // the op body carries an AWS key — caught at the pre-staging gate, so it is never authored
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# T\nkey AKIAIOSFODNN7EXAMPLE\n' }] },
    }
    const outs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify(proposalsWith()), JSON.stringify(lead),
    ]
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outs), vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.finalState).toBe('FAILED')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('secret_in_write')
    expect(existsSync(join(ws, 'vault-staging', 'concepts', 'n1.md'))).toBe(false)  // never authored
  })

  test('run forwards per-stage progress to onProgress', async () => {
    const stages: string[] = []
    await service().run({ projectId: 'p1', engine: 'claude' }, (rs) => stages.push(rs.state))
    expect(stages.length).toBeGreaterThan(0)
    expect(stages[stages.length - 1]).toBe('HUMAN_REVIEW_REQUIRED')
  })

  test('a secret that reaches staged content (pre-existing, merged by append) BLOCKS promotion; allowSecrets overrides', async () => {
    // The op body itself is clean, so the pre-staging gate lets the run finish — but appending to a
    // pre-existing vault doc that already holds a secret surfaces it in the authored staged file, where
    // the VALIDATED scan catches it and the promote gate refuses (unless a human passes allowSecrets).
    mkdirSync(join(ws, 'vault', 'notes'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'notes', 'log.md'), '# Log\nleftover key AKIAIOSFODNN7EXAMPLE\n')
    const lead = {
      graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'append_section', path: 'notes/log.md', content: '\n## update\nclean appended note\n', mode: 'apply' }] },
    }
    const outs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify(proposalsWith()), JSON.stringify(lead),
    ]
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outs), vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')  // op body clean → run completes for review
    expect(svc.promote({ runId: r.runId }).ok).toBe(false)                 // ...but the merged secret blocks promotion
    expect(svc.promote({ runId: r.runId, allowSecrets: true }).ok).toBe(true)  // explicit human override
  })
})
