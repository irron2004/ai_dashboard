import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner } from './harness-runner.js'
import { makeDrivers } from './make-drivers.js'

// E1 (#10/#32): drive full runs whose AGENT OUTPUT simulates plausible LLM misbehavior, and assert the
// deterministic gates catch each — exercising the unwrap/parse chain + gates end-to-end, not just unit-level.

const ALL_OPEN = {
  enable_conversation_history_reader: true, auto_classify_documents: true,
  auto_create_node_proposals: true, auto_create_write_plan: true, auto_write_to_staging: true,
}

const discovery = JSON.stringify({ project_id: 'p1', generated_by: 'discovery' })
const reader = JSON.stringify({ generated_by: 'reader', session_id: 's1' })
const classifier = JSON.stringify({ generated_by: 'classifier', documents: [] })

function proposalsJson(sourcePath = 'raw/a'): string {
  return JSON.stringify({ proposals: [{
    proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: sourcePath, evidence_type: 'd' }],
    claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
  }] })
}

function leadJson(operations: unknown[]): string {
  return JSON.stringify({
    graph_update_plan: { created_by: 'lead', node_ops: [{ op: 'create', node_id: 'n1' }] },
    shared_promotion_plan: { created_by: 'lead', candidates: [] },
    stale_doc_report: { generated_by: 'lead', stale: [] },
    write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations },
  })
}

describe('makeDrivers — adversarial agent output', () => {
  let ws: string
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-adv-'))
    mkdirSync(join(ws, 'vault', 'raw'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'current.md'), '# current\n')
    writeFileSync(join(ws, 'vault', 'raw', 'a'), 'evidence source\n')
  })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function drive(outputs: string[], engine: 'claude' | 'codex' = 'claude') {
    const store = new RunArtifactStore(join(ws, 'runs', 'RUN-1'))
    const drivers = makeDrivers({ runner: new FakeAgentRunner(outputs), vaultRoot: join(ws, 'vault'), stagingRoot: join(ws, 'staging'), preamble: 'RULES' })
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now: () => '2026-06-02T00:00:00Z' })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine })
    return { store, runner }
  }

  test('claude-envelope-wrapped + fenced extractor output still drives to HUMAN_REVIEW_REQUIRED', async () => {
    // the extractor output is wrapped in a claude --output-format json envelope AND fenced + prose-prefixed
    const wrapped = JSON.stringify({ type: 'result', is_error: false, result: 'Here is the JSON:\n```json\n' + proposalsJson() + '\n```' })
    const { store, runner } = drive([discovery, reader, classifier, wrapped, leadJson([{ op: 'create_file', path: 'concepts/n1.md', content: '# T\n' }])])
    expect((await runner.advance(store)).state).toBe('HUMAN_REVIEW_REQUIRED')
  })

  test('a canonical op with mode:"apply" is routed to .proposal.md (never overwrites canonical)', async () => {
    const lead = leadJson([{ op: 'create_file', path: 'current.md', mode: 'apply', content: '# hijacked\n' }])
    const { store, runner } = drive([discovery, reader, classifier, proposalsJson(), lead])
    const rs = await runner.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    const applied = store.readArtifact<{ applied: string[]; proposals: string[] }>(
      rs.artifacts['STAGING_WRITTEN'].find(p => p.endsWith('applied-write-report.json'))!)
    expect(applied.applied).not.toContain('current.md')
    expect(applied.proposals).toContain('current.proposal.md')
  })

  // #26: a write op under raw/ is a hard block at the pre-staging gate (the run FAILS) — not merely
  // skipped by the writer. The writer's skip remains as defense-in-depth (unit-tested separately), but a
  // plan that even ATTEMPTS a raw write is LLM misbehavior the pipeline must refuse, not silently absorb.
  test('a write op under raw/ blocks the run before staging (#26)', async () => {
    const lead = leadJson([
      { op: 'create_file', path: 'concepts/n1.md', content: '# T\n' },
      { op: 'create_file', path: 'raw/should-not-write.md', content: 'nope\n' },
    ])
    const { store, runner } = drive([discovery, reader, classifier, proposalsJson(), lead])
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.error).toContain('raw_write')
    expect(existsSync(join(ws, 'staging', 'concepts', 'n1.md'))).toBe(false)  // nothing authored on a blocked plan
  })

  // #21/#22: a secret in a write-op BODY is caught BEFORE the staging write happens (scan-before-staging),
  // so the secret is never authored into the staging vault and the run FAILs.
  test('a write op carrying a secret blocks the run before staging (#21/#22)', async () => {
    const lead = leadJson([{ op: 'create_file', path: 'concepts/n1.md', content: 'AWS_KEY=AKIAIOSFODNN7EXAMPLE\n' }])
    const { store, runner } = drive([discovery, reader, classifier, proposalsJson(), lead])
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.error).toContain('secret_in_write')
    expect(existsSync(join(ws, 'staging', 'concepts', 'n1.md'))).toBe(false)  // secret never written
  })

  // #24: a write op authoring a non-.md file blocks the run before staging.
  test('a non-.md write op blocks the run before staging (#24)', async () => {
    const lead = leadJson([{ op: 'create_file', path: 'config/app.env', content: 'plain config\n' }])
    const { store, runner } = drive([discovery, reader, classifier, proposalsJson(), lead])
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    expect(rs.error).toContain('non_markdown_write')
  })

  test('evidence citing a nonexistent raw source is PRUNED, not run-fatal (EvidenceVerifier)', async () => {
    // its only evidence is un-sourced → the proposal is excluded; the run continues (here to an empty wiki).
    const emptyLead = JSON.stringify({
      graph_update_plan: { created_by: 'lead', node_ops: [] },
      shared_promotion_plan: { created_by: 'lead', candidates: [] },
      stale_doc_report: { generated_by: 'lead', stale: [] },
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [] },
    })
    const { store, runner } = drive([discovery, reader, classifier, proposalsJson('raw/ghost.jsonl'), emptyLead])
    const rs = await runner.advance(store)
    expect(rs.error ?? '').not.toContain('EvidenceVerifier') // pruned, not blocked
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
  })

  test('malformed (truncated) JSON from an agent fails the run with a parse error', async () => {
    const truncated = '{"proposals": [ {"proposal_id": "NP-1"'  // never closed
    const { store, runner } = drive([discovery, reader, classifier, truncated, leadJson([])])
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
  })
})
