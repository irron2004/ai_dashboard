import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import type { KhReviewDecision } from '@apc/shared'
import type { SourceLedger } from '@apc/knowledge-harness'
import { HarnessService } from './harness-service.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')
const decidedAt = '2026-07-21T00:00:00Z'

function cannedOutputs(): string[] {
  const proposals = {
    proposals: [
      {
        proposal_id: 'NP-1', proposed_by: 'extractor', created_at: decidedAt,
        node: { id: 'n1', type: 'ConceptNode', title: 'Alpha node', summary: 'Alpha summary' },
        evidence: [{
          evidence_id: 'EV-1', source_id: 'raw/a', source_path: 'raw/a',
          evidence_type: 'decision', quote_or_summary: 'alpha evidence source',
        }],
        claims: [{ claim_id: 'CL-1', text: 'Alpha claim', evidence_ids: ['EV-1'] }],
      },
      {
        proposal_id: 'NP-2', proposed_by: 'extractor', created_at: decidedAt,
        node: { id: 'n2', type: 'ConceptNode', title: 'Beta node', summary: 'Beta summary' },
        evidence: [{
          evidence_id: 'EV-2', source_id: 'raw/b', source_path: 'raw/b',
          evidence_type: 'decision', quote_or_summary: 'beta evidence source',
        }],
        claims: [{ claim_id: 'CL-2', text: 'Beta claim', evidence_ids: ['EV-2'] }],
      },
    ],
  }
  const lead = {
    graph_update_plan: {
      created_by: 'lead',
      edge_ops: [{
        op: 'create', from_node_id: 'n1', to_node_id: 'n2', type: 'relates_to', note: 'related',
      }],
    },
    shared_promotion_plan: { created_by: 'lead' },
    stale_doc_report: { generated_by: 'lead' },
    write_plan: {
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [{
        op: 'create_file', path: 'concepts/extra.md', content: '# Extra\n', source_proposal: 'NP-2',
      }],
    },
  }
  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
    JSON.stringify({
      generated_by: 'classifier',
      documents: [
        { path: 'raw/a', intent: 'reference' },
        { path: 'raw/b', intent: 'reference' },
      ],
    }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

type Marked = {
  projectId: string
  runId: string
  sources: ReadonlyArray<{ sourceId: string; sourceHash: string }>
}

const decision = (proposal_id: string, verdict: 'approved' | 'excluded'): KhReviewDecision => ({
  proposal_id,
  verdict,
  decided_at: decidedAt,
})

describe('HarnessService review decisions and source evidence', () => {
  let ws: string

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-review-'))
    mkdirSync(join(ws, 'vault', 'raw'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'README.md'), '# vault\n')
    writeFileSync(join(ws, 'vault', 'raw', 'a'), [
      'line one', 'line two', 'line three', 'alpha   evidence', 'source line',
      'line six', 'line seven', 'line eight', 'line nine', 'line ten', 'line eleven',
    ].join('\n'))
    writeFileSync(join(ws, 'vault', 'raw', 'b'), 'beta evidence source\n')
  })

  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function service(marked: Marked[] = []): HarnessService {
    const ledger: SourceLedger = {
      isProcessed: () => false,
      markProcessed: (projectId, runId, sources) => { marked.push({ projectId, runId, sources }) },
    }
    return new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'), sourceLedger: ledger,
      gatesPath, preamble: 'RULES', now: () => decidedAt,
    })
  }

  async function completedRun(svc: HarnessService): Promise<string> {
    const result = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(result.ok, result.reason).toBe(true)
    return result.runId
  }

  test('persists decisions as one replaceable HUMAN_REVIEW_REQUIRED artifact', async () => {
    const svc = service()
    const runId = await completedRun(svc)
    expect(svc.setReviewDecisions({
      runId,
      decisions: [decision('NP-1', 'approved'), decision('NP-2', 'excluded')],
    })).toEqual({ ok: true })
    expect(svc.setReviewDecisions({ runId, decisions: [decision('NP-2', 'approved')] }))
      .toEqual({ ok: true })

    const shown = svc.show({ runId })
    expect(shown.ok).toBe(true)
    if (!shown.ok) return
    expect(shown.runState.artifacts.HUMAN_REVIEW_REQUIRED
      .filter(path => path.endsWith('review-decisions.json'))).toHaveLength(1)
    expect(shown.artifacts.find(artifact => artifact.name === 'review-decisions')?.data)
      .toEqual({ decisions: [decision('NP-2', 'approved')] })
  })

  test('rejects unknown proposal ids and duplicate decisions', async () => {
    const svc = service()
    const runId = await completedRun(svc)
    expect(svc.setReviewDecisions({ runId, decisions: [decision('NP-X', 'approved')] }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('unknown proposal_id') })
    expect(svc.setReviewDecisions({
      runId,
      decisions: [decision('NP-1', 'approved'), decision('NP-1', 'excluded')],
    })).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate decision') })
  })

  test('returns an actual raw-source excerpt and original line number with whitespace-tolerant matching', async () => {
    const svc = service()
    const runId = await completedRun(svc)
    const result = svc.readSourceExcerpt({
      runId,
      sourcePath: 'raw/a',
      quote: 'ALPHA evidence source',
    })
    expect(result).toMatchObject({ ok: true, matched: true, line: 4 })
    if (result.ok) {
      expect(result.excerpt).toContain('line one')
      expect(result.excerpt).toContain('line nine')
      expect(result.excerpt).not.toContain('line ten')
    }
  })

  test('falls back to the source head when an AI-provided quote cannot be matched', async () => {
    const svc = service()
    const runId = await completedRun(svc)
    const result = svc.readSourceExcerpt({ runId, sourcePath: 'raw/a', quote: 'not in source' })
    expect(result).toMatchObject({ ok: true, matched: false })
    if (result.ok) expect(result.excerpt).toContain('line one')
  })

  test('only resolves existing files inside raw/', async () => {
    const svc = service()
    const runId = await completedRun(svc)
    expect(svc.resolveRawSourceFile({ runId, sourcePath: 'raw/a' }))
      .toEqual({ ok: true, absPath: join(ws, 'vault', 'raw', 'a') })
    expect(svc.resolveRawSourceFile({ runId, sourcePath: '../README.md' }))
      .toMatchObject({ ok: false })
    expect(svc.resolveRawSourceFile({ runId, sourcePath: 'raw/../README.md' }))
      .toMatchObject({ ok: false })
    expect(svc.resolveRawSourceFile({ runId, sourcePath: 'README.md' }))
      .toMatchObject({ ok: false })
    expect(svc.resolveRawSourceFile({ runId, sourcePath: 'raw/missing' }))
      .toMatchObject({ ok: false })
  })
})

describe('HarnessService promotion with review decisions', () => {
  let ws: string

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-reviewed-promote-'))
    mkdirSync(join(ws, 'vault', 'raw'), { recursive: true })
    writeFileSync(join(ws, 'vault', 'README.md'), '# vault\n')
    writeFileSync(join(ws, 'vault', 'raw', 'a'), 'alpha evidence source\n')
    writeFileSync(join(ws, 'vault', 'raw', 'b'), 'beta evidence source\n')
  })

  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function service(marked: Marked[]): HarnessService {
    const ledger: SourceLedger = {
      isProcessed: () => false,
      markProcessed: (projectId, runId, sources) => { marked.push({ projectId, runId, sources }) },
    }
    return new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'vault'), runsRoot: join(ws, 'runs'), sourceLedger: ledger,
      gatesPath, preamble: 'RULES', now: () => decidedAt,
    })
  }

  async function completedRun(svc: HarnessService): Promise<string> {
    const result = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(result.ok, result.reason).toBe(true)
    return result.runId
  }

  test('promotes only approved proposal output and reports skipped files and dangling links', async () => {
    const marked: Marked[] = []
    const svc = service(marked)
    const runId = await completedRun(svc)
    svc.setReviewDecisions({
      runId,
      decisions: [decision('NP-1', 'approved'), decision('NP-2', 'excluded')],
    })

    const result = svc.promote({ runId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.promoted).toContain('nodes/n1.md')
    expect(result.promoted).not.toContain('nodes/n2.md')
    expect(result.skippedByReview).toEqual(expect.arrayContaining([
      'nodes/n2.md', 'concepts/extra.md',
    ]))
    expect(result.danglingLinks).toBe(1)
    expect(existsSync(join(ws, 'vault', 'nodes', 'n1.md'))).toBe(true)
    expect(existsSync(join(ws, 'vault', 'nodes', 'n2.md'))).toBe(false)
    expect(existsSync(join(ws, 'vault', 'concepts', 'extra.md'))).toBe(false)
    expect(readFileSync(join(ws, 'vault', 'nodes', 'n1.md'), 'utf8')).toContain('[[n2]]')
  })

  test('marks only sources cited by approved proposals in the ledger', async () => {
    const marked: Marked[] = []
    const svc = service(marked)
    const runId = await completedRun(svc)
    svc.setReviewDecisions({
      runId,
      decisions: [decision('NP-1', 'approved'), decision('NP-2', 'excluded')],
    })
    svc.promote({ runId })
    expect(marked).toHaveLength(1)
    expect(marked[0].sources.map(source => source.sourceId)).toEqual(['raw/a'])
  })

  test('refuses promotion when a decisions artifact has no approved proposal', async () => {
    const marked: Marked[] = []
    const svc = service(marked)
    const runId = await completedRun(svc)
    svc.setReviewDecisions({
      runId,
      decisions: [decision('NP-1', 'excluded'), decision('NP-2', 'excluded')],
    })
    const result = svc.promote({ runId })
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('승인된 항목이 없습니다') })
    expect(marked).toHaveLength(0)
  })

  test('keeps legacy promote-all behavior when no decisions artifact exists', async () => {
    const marked: Marked[] = []
    const svc = service(marked)
    const runId = await completedRun(svc)
    const result = svc.promote({ runId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.promoted).toEqual(expect.arrayContaining([
      'nodes/n1.md', 'nodes/n2.md', 'concepts/extra.md',
    ]))
    expect(result.skippedByReview).toEqual([])
    expect(result.danglingLinks).toBe(0)
    expect(marked[0].sources.map(source => source.sourceId).sort()).toEqual(['raw/a', 'raw/b'])
  })

  test('treats an undecided proposal as excluded at promotion time', async () => {
    const marked: Marked[] = []
    const svc = service(marked)
    const runId = await completedRun(svc)
    svc.setReviewDecisions({ runId, decisions: [decision('NP-1', 'approved')] })
    const result = svc.promote({ runId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.promoted).not.toContain('nodes/n2.md')
    expect(result.skippedByReview).toContain('nodes/n2.md')
  })
})
