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
/**
 * Demote an under-evidenced shared proposal to `project` scope (instead of letting PolicyGuard FAIL the
 * whole run on its `shared_evidence_min` floor). A folder worker sees only its own folder, so it cannot
 * establish that a concept is SHARED (shared is inherently cross-folder) and usually carries just one
 * evidence for it; declaring `shared`/`shared_candidate` there is premature. Downgrading keeps it as a
 * valid project node, and the WikiGraphLead — which sees every folder's proposals + their provenance —
 * re-promotes it to shared with the merged cross-folder evidence (and the human-review gate) where that
 * decision belongs. Proposals that already meet the >=2-evidence floor keep their scope.
 */
export function demoteUnderEvidencedShared(proposals: KhNodeProposal[]): KhNodeProposal[] {
  return proposals.map((p) =>
    p.node.scope !== 'project' && p.evidence.length < 2
      ? { ...p, node: { ...p.node, scope: 'project' } }
      : p,
  )
}

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
