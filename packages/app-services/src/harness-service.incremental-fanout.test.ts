import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import type { SourceLedger } from '@apc/knowledge-harness'
import { HarnessService } from './harness-service.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

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

/** In-memory ledger (mirrors the one used in make-drivers.source-ledger.test). */
class MemoryLedger implements SourceLedger {
  readonly seen = new Map<string, string>()
  private key(p: string, s: string) { return `${p} ${s}` }
  isProcessed(projectId: string, sourceId: string, sourceHash: string): boolean {
    return this.seen.get(this.key(projectId, sourceId)) === sourceHash
  }
  markProcessed(projectId: string, _runId: string, sources: ReadonlyArray<{ sourceId: string; sourceHash: string }>): void {
    for (const s of sources) this.seen.set(this.key(projectId, s.sourceId), s.sourceHash)
  }
}

describe('HarnessService — incremental fan-out (ledger + folder workers)', () => {
  let ws: string, vault: string
  const A = 'raw/project-docs/0/A/a.md', B = 'raw/project-docs/0/B/b.md'
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-inc-'))
    vault = join(ws, 'vault')
    mkdirSync(join(vault, 'raw', 'project-docs', '0', 'A'), { recursive: true })
    mkdirSync(join(vault, 'raw', 'project-docs', '0', 'B'), { recursive: true })
    writeFileSync(join(vault, 'raw', 'project-docs', '0', 'A', 'a.md'), 'A v1\n')
    writeFileSync(join(vault, 'raw', 'project-docs', '0', 'B', 'b.md'), 'B v1\n')
  })
  afterEach(() => rmSync(ws, { recursive: true, force: true }))

  const svc = (ledger: SourceLedger, outputs: string[]) => new HarnessService({
    runner: new FakeAgentRunner(outputs), vaultRoot: vault, runsRoot: join(ws, 'runs'),
    sourceLedger: ledger, maxPromptChars: 200, gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
  })
  const fanOf = (s: HarnessService, runId: string) => {
    const shown = s.show({ runId }); if (!shown.ok) throw new Error('show failed')
    return shown.artifacts.find((a) => a.name === 'fanout-report')?.data as { units: number; ran: number }
  }

  test('a re-run after a change re-processes ONLY the changed folder', async () => {
    const ledger = new MemoryLedger()

    // Run 1: both folders are fresh → 2 workers.
    const s1 = svc(ledger, [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify({ proposals: [proposalFor('A1', A)] }),
      JSON.stringify({ proposals: [proposalFor('B1', B)] }),
      JSON.stringify(lead),
    ])
    const r1 = await s1.run({ projectId: 'p1', engine: 'claude' })
    expect(r1.ok, r1.reason).toBe(true)
    expect(fanOf(s1, r1.runId)).toMatchObject({ units: 2, ran: 2 })

    // Sources are consumed at PROMOTE (committed), not at HUMAN_REVIEW — so promote run 1 to mark them.
    const p1 = s1.promote({ runId: r1.runId })
    expect(p1.ok, 'reason' in p1 ? p1.reason : '').toBe(true)

    // Change folder A only → B is unchanged (ledger filters it) → run 2 fans out over A alone.
    writeFileSync(join(vault, 'raw', 'project-docs', '0', 'A', 'a.md'), 'A v2 CHANGED\n')
    const s2 = svc(ledger, [
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's2' }),
      JSON.stringify({ generated_by: 'classifier', documents: [] }),
      JSON.stringify({ proposals: [proposalFor('A2', A)] }),
      JSON.stringify(lead),
    ])
    const r2 = await s2.run({ projectId: 'p1', engine: 'claude' })
    expect(r2.ok, r2.reason).toBe(true)
    expect(fanOf(s2, r2.runId)).toMatchObject({ units: 1, ran: 1 }) // only folder A re-processed
  })
})
