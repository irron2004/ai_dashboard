import { describe, expect, test } from 'vitest'
import { runFolderWorkers } from './make-drivers.js'
import type { WorkUnit } from './folder-plan.js'
import type { SourceDoc } from './source-reader.js'
import type { KhNodeProposal } from '@apc/shared'

const unit = (id: string, label: string): WorkUnit => ({
  id, label, memberPaths: [label], role: 'reference', docSourceIds: [id], sessionIds: [], estChars: 1,
})
const prop = (proposal_id: string): KhNodeProposal => ({
  proposal_id, proposed_by: 'x', created_at: 't',
  node: { id: `n_${proposal_id}`, type: 'ConceptNode', title: proposal_id }, evidence: [], claims: [],
} as unknown as KhNodeProposal)
const doc: SourceDoc = { source_id: 'x', source_path: 'x', text: 't', hash: 'x' }
const oneDoc = (): SourceDoc[] => [doc]

describe('runFolderWorkers', () => {
  test('merges proposals in unit order with aligned provenance', async () => {
    const res = await runFolderWorkers([unit('a', 'A'), unit('b', 'B')], oneDoc, 1, async (_d, u) => [prop(u.label)])
    expect(res.ran).toBe(2)
    expect(res.skipped).toEqual([])
    expect(res.proposals.map((p) => p.proposal_id)).toEqual(['A', 'B'])
    expect(res.provenance).toEqual([{ proposalId: 'A', folder: 'A' }, { proposalId: 'B', folder: 'B' }])
  })

  test('a throwing worker is skipped (not fatal); the rest still produce', async () => {
    const res = await runFolderWorkers([unit('a', 'A'), unit('b', 'B')], oneDoc, 1, async (_d, u) => {
      if (u.label === 'A') throw new Error('boom')
      return [prop('B1')]
    })
    expect(res.ran).toBe(1)
    expect(res.skipped).toEqual([{ unit: 'A', reason: 'boom' }])
    expect(res.proposals.map((p) => p.proposal_id)).toEqual(['B1'])
    expect(res.provenance).toEqual([{ proposalId: 'B1', folder: 'B' }])
  })

  test('colliding ids across workers are de-duplicated; provenance tracks the FINAL ids', async () => {
    const res = await runFolderWorkers([unit('a', 'A'), unit('b', 'B')], oneDoc, 1, async () => [prop('DUP')])
    expect(res.proposals.map((p) => p.proposal_id)).toEqual(['DUP', 'DUP-2'])
    expect(res.provenance).toEqual([{ proposalId: 'DUP', folder: 'A' }, { proposalId: 'DUP-2', folder: 'B' }])
  })

  test('a unit with no docs is skipped silently (not counted, not an error)', async () => {
    const res = await runFolderWorkers(
      [unit('a', 'A'), unit('b', 'B')],
      (u) => (u.label === 'A' ? [] : oneDoc()),
      1,
      async (_d, u) => [prop(u.label)],
    )
    expect(res.ran).toBe(1)
    expect(res.skipped).toEqual([])
    expect(res.proposals.map((p) => p.proposal_id)).toEqual(['B'])
  })

  test('onUnitProposals fires per successful worker (live stream), but NOT for skipped/empty units', async () => {
    const seen: Array<{ folder: string; ids: string[] }> = []
    const res = await runFolderWorkers(
      [unit('a', 'A'), unit('b', 'B'), unit('c', 'C')],
      (u) => (u.label === 'C' ? [] : oneDoc()),     // C has no docs → empty, no emit
      1,
      async (_d, u) => { if (u.label === 'B') throw new Error('boom'); return [prop(u.label)] }, // B throws → no emit
      (proposals, u) => seen.push({ folder: u.label, ids: proposals.map((p) => p.proposal_id) }),
    )
    expect(res.ran).toBe(1)
    expect(seen).toEqual([{ folder: 'A', ids: ['A'] }]) // only the worker that produced
  })

  test('a throwing onUnitProposals listener never breaks the fan-out (best-effort)', async () => {
    const res = await runFolderWorkers([unit('a', 'A')], oneDoc, 1, async (_d, u) => [prop(u.label)],
      () => { throw new Error('listener boom') })
    expect(res.proposals.map((p) => p.proposal_id)).toEqual(['A'])
  })

  test('concurrency > 1 still accumulates in unit order', async () => {
    const res = await runFolderWorkers(
      [unit('a', 'A'), unit('b', 'B'), unit('c', 'C')],
      oneDoc, 3,
      async (_d, u) => new Promise((r) => setTimeout(() => r([prop(u.label)]), u.label === 'A' ? 20 : 1)),
    )
    expect(res.proposals.map((p) => p.proposal_id)).toEqual(['A', 'B', 'C'])
  })
})
