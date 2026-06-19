import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner, type AgentRunner } from '@apc/llm-wiki'
import { RunLock, RunArtifactStore, readPolicy, resolveProjectPreamble, writeProposedPolicy, approvePolicy } from '@apc/knowledge-harness'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession } from '@apc/shared'
import { KhProjectPolicyProposalSchema, RunStateSchema } from '@apc/shared'
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

  // I2: the headline safety wiring — an APPROVED policy reaches every agent prompt during a real run,
  // with the governance base preamble preserved AND the tailoring appended (never the other way round).
  test('an approved policy injects base preamble + tailoring into every run agent prompt', async () => {
    const vaultRoot = join(ws, 'vault')
    writeProposedPolicy(vaultRoot, 'p1', KhProjectPolicyProposalSchema.parse({
      project_id: 'p1', generated_by: 'a', node_type_priorities: [{ node_type: 'ExperimentNode', rationale: 'r' }],
    }), () => '2026-06-02T00:00:00Z')
    approvePolicy(vaultRoot, 'p1', () => '2026-06-02T00:00:00Z')

    const prompts: string[] = []
    const inner = new FakeAgentRunner(cannedOutputs())
    const runner: AgentRunner = { run: (req) => { prompts.push(req.prompt); return inner.run(req) } }
    const svc = new HarnessService({ runner, vaultRoot, runsRoot: join(ws, 'runs'), gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z' })

    await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(prompts.length).toBeGreaterThan(0)
    // base governance ('RULES') and the approved tailoring both ride in EVERY agent prompt
    expect(prompts.every((p) => p.includes('RULES') && p.includes('ExperimentNode'))).toBe(true)
  })

  // M1: latestDiscovery reuses an existing PROJECT_SCANNED artifact instead of running discovery again.
  // We queue ONLY the advisor output (1) — if discovery were re-run it would consume it and the advisor
  // would get nothing (→ ok:false). ok:true proves the prior artifact was reused.
  test('proposeWikiPolicy reuses a prior run\'s PROJECT_SCANNED artifact', async () => {
    const runDir = join(ws, 'runs', 'RUN-2026-01-01T00-00-00-000Z')
    const store = new RunArtifactStore(runDir)
    store.init()
    const rel = store.writeArtifact('PROJECT_SCANNED', 'discovery', { project_id: 'p1', generated_by: 'discovery', topics: ['reuse-me'] })
    store.saveRunState(RunStateSchema.parse({ runId: 'RUN-2026-01-01T00-00-00-000Z', projectId: 'p1', engine: 'claude', state: 'PROJECT_SCANNED', artifacts: { PROJECT_SCANNED: [rel] } }))

    const svc = new HarnessService({
      runner: new FakeAgentRunner([JSON.stringify({ project_id: 'p1', generated_by: 'wiki-policy-advisor', node_type_priorities: [{ node_type: 'ExperimentNode', rationale: 'r' }] })]),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'), gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const res = await svc.proposeWikiPolicy({ projectId: 'p1', engine: 'claude' })
    expect(res.ok).toBe(true)   // single queued output sufficed → discovery was reused, not re-run
    expect(res.proposal?.node_type_priorities[0].node_type).toBe('ExperimentNode')
  })

  // A2 (#1/#7/#34): a proposal citing a source_path that doesn't exist under raw/ fails the run.
  test('fabricated evidence (source_path not in raw/) is PRUNED, not run-fatal', async () => {
    const proposals = { proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/ghost.jsonl', evidence_type: 'd' }],
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    }] }
    const lead = {
      graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [] },
    }
    const svc = new HarnessService({
      runner: new FakeAgentRunner([
        JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
        JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
        JSON.stringify({ generated_by: 'classifier', documents: [] }),
        JSON.stringify(proposals),
        JSON.stringify(lead),
      ]),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'), gatesPath, preamble: 'RULES',
      now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    // The run is NOT killed; the un-sourced proposal is excluded and recorded.
    expect(r.ok, r.reason).toBe(true)
    expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')
    const shown = svc.show({ runId: r.runId })
    if (!shown.ok) throw new Error('show failed')
    const nodeProps = shown.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals: unknown[] }
    expect(nodeProps.proposals).toEqual([]) // pruned (its only evidence was unverifiable)
    const ev = shown.artifacts.find((a) => a.name === 'evidence-verification-report')?.data as { unverifiable: { reason: string }[] }
    expect(ev.unverifiable[0].reason).toBe('source_not_found') // still recorded for visibility
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

  test('a PolicyGuard block (forbidden write op) surfaces as FAILED with a reason', async () => {
    // a well-sourced proposal survives, but the lead's write plan has a forbidden delete op → PolicyGuard
    // blocks before staging and the error propagates end-to-end as FAILED.
    const proposals = { proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    }] }
    const lead = {
      graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'delete_file', path: 'old.md' }] },
    }
    const outs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify(proposals),
      JSON.stringify(lead),
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

  test('confirmNodes writes approved-nodes and resumes a paused interactive run', async () => {
    // interactive run pauses at WRITE_PLAN_CREATED (approved-nodes not present yet)
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const run = await svc.run({ projectId: 'p1', engine: 'claude', interactive: true })
    expect(run.finalState).toBe('LEAD_MERGED')   // paused before write

    // confirmNodes writes approved-nodes under LEAD_MERGED key and resumes — no further LLM calls needed
    const resumeSvc = new HarnessService({
      runner: new FakeAgentRunner([]),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'),
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const res = await resumeSvc.confirmNodes({ runId: run.runId, approvedNodes: { nodes: [{ id: 'n1', title: 'N1', source_proposal_id: 'pp1' }] } })
    expect(res.finalState).toBe('HUMAN_REVIEW_REQUIRED')
  })
})

describe('HarnessService engine logging', () => {
  test('a failed first step still leaves prompt/meta logs in runs/<id>/logs', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-log-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const runsRoot = join(tmp, 'runs')
    const svc = new HarnessService({ runner: new FakeAgentRunner([]), vaultRoot, runsRoot })
    const res = await svc.run({ projectId: 'p1', engine: 'codex' })
    expect(res.ok).toBe(false)
    const logRoot = join(runsRoot, res.runId, 'logs')
    const dirs = readdirSync(logRoot)
    expect(dirs).toEqual(['01-PROJECT_SCANNED-project-discovery'])
    expect(existsSync(join(logRoot, dirs[0], 'prompt.txt'))).toBe(true)
    const meta = JSON.parse(readFileSync(join(logRoot, dirs[0], 'meta.json'), 'utf8'))
    expect(meta.ok).toBe(false)
    // 실패 메시지가 로그 위치를 가리킨다
    expect(res.reason).toContain('full logs:')
  })

  test('onEngineLog receives streamed chunks with the call label', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-chunk-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const streaming: AgentRunner = {
      run: async (i) => { i.onChunk?.('stdout', 'scanning…'); return { ok: false, output: '', raw: 'dead' } },
    }
    const svc = new HarnessService({ runner: streaming, vaultRoot, runsRoot: join(tmp, 'runs') })
    const events: Array<{ label: string; stream: string; chunk: string }> = []
    await svc.run({ projectId: 'p1', engine: 'codex' }, undefined, (e) => events.push(e))
    expect(events).toEqual([{ label: 'PROJECT_SCANNED-project-discovery', stream: 'stdout', chunk: 'scanning…' }])
  })
})

describe('HarnessService conversation materialization', () => {
  test('materialize:true with conversationAdapters writes raw/conversations Q&A files', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-conv-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const repo = join(tmp, 'repo'); mkdirSync(repo, { recursive: true })
    const session: NormalizedSession = {
      id: 'sess-1', agentType: 'claude', repoPath: repo, endedAt: '2026-06-11T00:00:00Z',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} },
      turns: [
        { role: 'user', text: '질문', toolCalls: [] },
        { role: 'assistant', text: '답변', toolCalls: [] },
      ],
      filesTouched: [],
    }
    const adapter: AgentIngestAdapter = {
      agentKind: 'claude',
      discoverSources: async () => [{ id: 'claude:0', agentKind: 'claude', kind: 'jsonl-file', locator: '/x', discoveredAt: '2026-06-11T00:00:00Z' } as AgentSource],
      parseSource: async () => ({ session, position: '' }),
    }
    const svc = new HarnessService({ runner: new FakeAgentRunner([]), vaultRoot, runsRoot: join(tmp, 'runs'), conversationAdapters: [adapter] })
    await svc.run({ projectId: 'p1', engine: 'codex', materialize: true, repoPaths: [repo] })
    const file = join(vaultRoot, 'raw', 'conversations', 'claude', 'sess-1', '001q_a.txt')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('질문')
  })

  test('materialize:true without adapters still works (backward compatible)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-noconv-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const repo = join(tmp, 'repo'); mkdirSync(repo, { recursive: true })
    const svc = new HarnessService({ runner: new FakeAgentRunner([]), vaultRoot, runsRoot: join(tmp, 'runs') })
    const res = await svc.run({ projectId: 'p1', engine: 'codex', materialize: true, repoPaths: [repo] })
    expect(res.runId).toBeTruthy()
    expect(existsSync(join(vaultRoot, 'raw', 'conversations'))).toBe(false)
  })
})

describe('HarnessService wiki policy', () => {
  // FakeAgentRunner returns queued outputs in order. proposeWikiPolicy with no prior
  // PROJECT_SCANNED artifact runs discovery first, then the advisor — so queue 2 outputs.
  function svc(outputs: string[]) {
    const ws = mkdtempSync(join(tmpdir(), 'hs-wp-'))
    const service = new HarnessService({
      runner: new FakeAgentRunner(outputs),
      vaultRoot: join(ws, 'vault'),
      runsRoot: join(ws, 'runs'),
      preamble: 'BASE-RULES',
      now: () => '2026-06-13T00:00:00Z',
    })
    return { service, ws, vaultRoot: join(ws, 'vault') }
  }

  test('proposeWikiPolicy runs discovery+advisor and writes a proposed policy', async () => {
    const discovery = JSON.stringify({ project_id: 'p1', generated_by: 'discovery', topics: ['backtesting'] })
    const proposal = JSON.stringify({
      project_id: 'p1', generated_by: 'wiki-policy-advisor', project_character: 'quant research',
      node_type_priorities: [{ node_type: 'ExperimentNode', rationale: 'backtests' }],
    })
    const { service, vaultRoot } = svc([discovery, proposal])
    const res = await service.proposeWikiPolicy({ projectId: 'p1', engine: 'claude' })
    expect(res.ok).toBe(true)
    expect(res.proposal?.project_character).toBe('quant research')
    expect(res.effectivePreview).toContain('BASE-RULES')          // governance on top
    expect(res.effectivePreview).toContain('ExperimentNode')      // tailoring appended
    expect(readPolicy(vaultRoot, 'p1')?.status).toBe('proposed')
  })

  test('approveWikiPolicy makes resolveProjectPreamble inject the tailoring for that project', async () => {
    const discovery = JSON.stringify({ project_id: 'p1', generated_by: 'discovery' })
    const proposal = JSON.stringify({
      project_id: 'p1', generated_by: 'wiki-policy-advisor',
      node_type_priorities: [{ node_type: 'ExperimentNode', rationale: 'r' }],
    })
    const { service, vaultRoot } = svc([discovery, proposal])
    await service.proposeWikiPolicy({ projectId: 'p1', engine: 'claude' })
    const ap = service.approveWikiPolicy({ projectId: 'p1' })
    expect(ap.ok).toBe(true)
    expect(readPolicy(vaultRoot, 'p1')?.status).toBe('approved')
    // The actual contract: once approved, resolveProjectPreamble injects the tailoring on top of base.
    const eff = resolveProjectPreamble(vaultRoot, 'p1', 'BASE-RULES')
    expect(eff.startsWith('BASE-RULES')).toBe(true)
    expect(eff).toContain('ExperimentNode')
  })

  test('proposeWikiPolicy surfaces an agent failure as { ok:false, reason } without writing', async () => {
    const { service, vaultRoot } = svc([])   // empty queue → FakeAgentRunner not-ok
    const res = await service.proposeWikiPolicy({ projectId: 'p1', engine: 'claude' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBeTruthy()
    expect(readPolicy(vaultRoot, 'p1')).toBeNull()
  })
})

describe('HarnessService readStagedDoc', () => {
  function svc(runsRoot: string) {
    return new HarnessService({ runner: new FakeAgentRunner([]), vaultRoot: join(runsRoot, '..', 'vault'), runsRoot, preamble: 'RULES' })
  }

  test('reads a markdown draft from a run vault-staging dir', () => {
    const ws = mkdtempSync(join(tmpdir(), 'hs-staged-'))
    const dir = join(ws, 'runs', 'RUN-1', 'vault-staging', 'concepts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'x.md'), '# Concept X\nbody')
    const res = svc(join(ws, 'runs')).readStagedDoc({ runId: 'RUN-1', relPath: 'concepts/x.md' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.content).toContain('Concept X')
  })

  test('missing staged file → ok:false (never throws)', () => {
    const ws = mkdtempSync(join(tmpdir(), 'hs-staged-'))
    const res = svc(join(ws, 'runs')).readStagedDoc({ runId: 'RUN-1', relPath: 'concepts/missing.md' })
    expect(res.ok).toBe(false)
  })

  test('path escape via relPath or runId is rejected', () => {
    const ws = mkdtempSync(join(tmpdir(), 'hs-staged-'))
    const s = svc(join(ws, 'runs'))
    expect(s.readStagedDoc({ runId: 'RUN-1', relPath: '../../../etc/passwd.md' }).ok).toBe(false)
    expect(s.readStagedDoc({ runId: '../../..', relPath: 'x.md' }).ok).toBe(false)
  })

  test('non-text extension is refused', () => {
    const ws = mkdtempSync(join(tmpdir(), 'hs-staged-'))
    expect(svc(join(ws, 'runs')).readStagedDoc({ runId: 'RUN-1', relPath: 'concepts/x.json' }).ok).toBe(false)
  })
})
