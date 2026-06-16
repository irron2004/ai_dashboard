import type { KhNodeProposal } from '@apc/shared'

/**
 * Guarantee globally-unique `proposal_id` and `node.id` across a merged proposal set. Fan-out runs the
 * extractor once per folder, and separate calls can emit colliding ids (e.g. each worker numbering from
 * 1); downstream merge (wiki-graph-lead) and graph-integrity validation key off these ids, so a collision
 * would conflate two distinct nodes or fail as a "duplicate node". Order-preserving: the first occurrence
 * keeps its id; later duplicates get a `-2`, `-3`, … suffix. A no-op when ids are already unique (so the
 * single-shot path is unchanged). Evidence/claim references are intra-proposal and don't point at
 * proposal_id/node.id, so renaming is safe.
 */
export function dedupeProposalIds(proposals: KhNodeProposal[]): KhNodeProposal[] {
  const seenProp = new Map<string, number>()
  const seenNode = new Map<string, number>()
  const uniq = (id: string, seen: Map<string, number>): string => {
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    return n === 1 ? id : `${id}-${n}`
  }
  return proposals.map((p) => {
    const proposal_id = uniq(p.proposal_id, seenProp)
    const node = p.node ? { ...p.node, id: uniq(p.node.id, seenNode) } : p.node
    return { ...p, proposal_id, node }
  })
}
