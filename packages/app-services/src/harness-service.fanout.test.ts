import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { HarnessService } from './harness-service.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

/** A proposal whose single evidence cites `path` (no quote → EvidenceVerifier only checks the file exists). */
const proposalFor = (id: string, path: string) => ({
  proposal_id: id, proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
  node: { id: `n_${id}`, type: 'ConceptNode', title: id },
  evidence: [{ evidence_id: `EV_${id}`, source_id: path, source_path: path, evidence_type: 'd' }],
  claims: [{ claim_id: `CL_${id}`, text: 'x', evidence_ids: [`EV_${id}`] }],
})
const lead = {
  graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
  write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [] },
}

describe('HarnessService — folder worker fan-out', () => {
  let ws: string, vault: string
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-fan-'))
    vault = join(ws, 'vault')
    // two project-doc folders, each materialized under raw/project-docs/0/<folder>/
    mkdirSync(join(vault, 'raw', 'project-docs', '0', 'A'), { recursive: true })
    mkdirSync(join(vault, 'raw', 'project-docs', '0', 'B'), { recursive: true })
    writeFileSync(join(vault, 'raw', 'project-docs', '0', 'A', 'a.md'), 'evidence source A\n')
    writeFileSync(join(vault, 'raw', 'project-docs', '0', 'B', 'b.md'), 'evidence source B\n')
  })
  afterEach(() => rmSync(ws, { recursive: true, force: true }))

  test('runs one worker per folder unit and merges their proposals', async () => {
    // discovery, reader, classifier, extractor(unit A), extractor(unit B), lead
    const outputs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify({ proposals: [proposalFor('A1', 'raw/project-docs/0/A/a.md')] }),
      JSON.stringify({ proposals: [proposalFor('B1', 'raw/project-docs/0/B/b.md')] }),
      JSON.stringify(lead),
    ]
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outputs),
      vaultRoot: vault, runsRoot: join(ws, 'runs'),
      maxPromptChars: 200, // small → folders A and B become separate work units (not merged)
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })

    const liveNodes: Array<{ runId: string; folder: string; nodes: { id: string; title: string }[] }> = []
    const activityKinds: string[] = []
    const r = await svc.run({ projectId: 'p1', engine: 'claude' }, undefined, undefined,
      (e) => liveNodes.push({ runId: e.runId, folder: e.folder, nodes: e.nodes.map((n) => ({ id: n.id, title: n.title })) }),
      (event) => { activityKinds.push(event.kind) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.finalState).toBe('HUMAN_REVIEW_REQUIRED')

    // the live stream emitted each folder worker's nodes mid-run, stamped with this run's id
    expect(liveNodes.length).toBe(2)
    expect(liveNodes.every((e) => e.runId === r.runId)).toBe(true)
    expect(liveNodes.map((e) => e.folder).sort()).toEqual(['A', 'B'])
    expect(liveNodes.flatMap((e) => e.nodes.map((n) => n.id)).sort()).toEqual(['n_A1', 'n_B1'])
    expect(activityKinds).toContain('work_planned')
    expect(activityKinds.filter((kind) => kind === 'worker_started')).toHaveLength(2)
    expect(activityKinds.filter((kind) => kind === 'node_discovered')).toHaveLength(2)
    expect(activityKinds.at(-1)).toBe('run_completed')

    const shown = svc.show({ runId: r.runId })
    if (!shown.ok) throw new Error('show failed')
    const proposals = shown.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals: unknown[] }
    expect(proposals.proposals.length).toBe(2) // merged from both folder workers

    const fan = shown.artifacts.find((a) => a.name === 'fanout-report')?.data as { units: number; ran: number; skipped: unknown[]; provenance: Array<{ proposalId: string; folder: string }> }
    expect(fan).toMatchObject({ units: 2, ran: 2 })
    expect(fan.skipped.length).toBe(0)
    // folder provenance (phase 3) — each proposal tagged with the folder it came from, for the lead's
    // cross-folder reduce.
    expect([...fan.provenance].sort((a, b) => a.proposalId.localeCompare(b.proposalId))).toEqual([
      { proposalId: 'A1', folder: 'A' }, { proposalId: 'B1', folder: 'B' },
    ])
  })

  test('the reader is scoped to conversation sources, not project docs', async () => {
    mkdirSync(join(vault, 'raw', 'conversations', 'codex', 's1'), { recursive: true })
    writeFileSync(join(vault, 'raw', 'conversations', 'codex', 's1', '001q_a.txt'), 'Q: hi\nA: hello\n')
    const fake = new FakeAgentRunner([
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify({ proposals: [proposalFor('A1', 'raw/project-docs/0/A/a.md'), proposalFor('B1', 'raw/project-docs/0/B/b.md')] }),
      JSON.stringify(lead),
    ])
    const svc = new HarnessService({
      runner: fake, vaultRoot: vault, runsRoot: join(ws, 'runs'),
      maxPromptChars: 1_000_000, // folders merge into one unit; not the point of this test
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok, r.reason).toBe(true)
    const readerPrompt = fake.calls[1].prompt // call 0 = discovery, call 1 = reader (SOURCES_EXTRACTED)
    expect(readerPrompt).toContain('raw/conversations/codex/s1/001q_a.txt')
    expect(readerPrompt).not.toContain('raw/project-docs/0/A/a.md')
  })

  test('out-of-repo context (raw/context) is shared to every folder worker', async () => {
    // bigger folder docs so the two folders don't merge at budget 700, but folder+context still fits
    writeFileSync(join(vault, 'raw', 'project-docs', '0', 'A', 'a.md'), 'A'.repeat(400))
    writeFileSync(join(vault, 'raw', 'project-docs', '0', 'B', 'b.md'), 'B'.repeat(400))
    mkdirSync(join(vault, 'raw', 'context', 'home', 'h'), { recursive: true })
    writeFileSync(join(vault, 'raw', 'context', 'home', 'h', 'CLAUDE.md'), 'gov')

    const fake = new FakeAgentRunner([
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify({ proposals: [proposalFor('A1', 'raw/project-docs/0/A/a.md')] }),
      JSON.stringify({ proposals: [proposalFor('B1', 'raw/project-docs/0/B/b.md')] }),
      JSON.stringify(lead),
    ])
    const svc = new HarnessService({
      runner: fake, vaultRoot: vault, runsRoot: join(ws, 'runs'),
      maxPromptChars: 900, // one folder (~566) + context (~173) fits; two folders (~1132) do not → split
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok, r.reason).toBe(true)
    // calls 3 and 4 are the two folder workers — both must see the shared context file
    expect(fake.calls[3].prompt).toContain('raw/context/home/h/CLAUDE.md')
    expect(fake.calls[4].prompt).toContain('raw/context/home/h/CLAUDE.md')
  })

  test('colliding ids from two workers are de-duplicated, and provenance tracks the FINAL ids', async () => {
    // both workers emit proposal_id "DUP" (node n_DUP) → dedupe must split them, provenance stays aligned
    const outputs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify({ proposals: [proposalFor('DUP', 'raw/project-docs/0/A/a.md')] }),
      JSON.stringify({ proposals: [proposalFor('DUP', 'raw/project-docs/0/B/b.md')] }),
      JSON.stringify(lead),
    ]
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outputs), vaultRoot: vault, runsRoot: join(ws, 'runs'),
      maxPromptChars: 200, gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok, r.reason).toBe(true)
    const shown = svc.show({ runId: r.runId })
    if (!shown.ok) throw new Error('show failed')
    const proposals = (shown.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals: { proposal_id: string }[] }).proposals
    expect(proposals.map((p) => p.proposal_id).sort()).toEqual(['DUP', 'DUP-2'])
    const fan = shown.artifacts.find((a) => a.name === 'fanout-report')?.data as { provenance: { proposalId: string; folder: string }[] }
    // provenance references the de-duplicated ids (DUP / DUP-2), one per folder
    expect(fan.provenance.map((x) => x.proposalId).sort()).toEqual(['DUP', 'DUP-2'])
    expect(fan.provenance.map((x) => x.folder).sort()).toEqual(['A', 'B'])
  })

  test('a failed worker is skipped; the run still completes from the others', async () => {
    // unit A returns INVALID json → that worker throws (parse fail) → skipped; unit B succeeds.
    const outputs = [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      'NOT JSON — worker A fails',
      JSON.stringify({ proposals: [proposalFor('B1', 'raw/project-docs/0/B/b.md')] }),
      JSON.stringify(lead),
    ]
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outputs),
      vaultRoot: vault, runsRoot: join(ws, 'runs'),
      maxPromptChars: 200,
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })

    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const shown = svc.show({ runId: r.runId })
    if (!shown.ok) throw new Error('show failed')
    const fan = shown.artifacts.find((a) => a.name === 'fanout-report')?.data as { units: number; ran: number; skipped: { unit: string }[] }
    expect(fan).toMatchObject({ units: 2, ran: 1 })
    expect(fan.skipped.length).toBe(1)
    const proposals = shown.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals: unknown[] }
    expect(proposals.proposals.length).toBe(1) // only worker B's proposal survived
  })
})
