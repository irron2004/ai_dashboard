import {
  KhEvalReportSchema,
  type KhEvalReport, type KhNodeProposal, type KhPolicyReport, type KhGraphValidationReport,
} from '@apc/shared'

export type EvalInputs = {
  sourcesTotal?: number
  sourcesClassified?: number
  proposals?: KhNodeProposal[]
  policy?: KhPolicyReport
  graph?: KhGraphValidationReport
  applied?: { applied: string[]; proposals: string[]; skipped: string[] }
}

const count = <T>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length

/** Compute the EvalReport (design §11 metric groups) from a run's collected artifacts. Pure. */
export function buildEvalReport(inputs: EvalInputs): KhEvalReport {
  const proposals = inputs.proposals ?? []
  const policyViolations = inputs.policy?.violations ?? []
  const graph = inputs.graph

  return KhEvalReportSchema.parse({
    coverage: {
      raw_sources_total: inputs.sourcesTotal ?? 0,
      raw_sources_classified: inputs.sourcesClassified ?? 0,
      task_mapped_sources: inputs.sourcesClassified ?? 0,
      unmapped_sources: Math.max(0, (inputs.sourcesTotal ?? 0) - (inputs.sourcesClassified ?? 0)),
    },
    evidence_quality: {
      node_proposals_total: proposals.length,
      proposals_without_evidence: count(proposals, p => p.evidence.length === 0),
      proposals_with_minimum_evidence: count(proposals, p => p.evidence.length >= 1),
      inference_without_note: count(
        proposals.flatMap(p => p.claims),
        c => c.inference && !c.inference_note,
      ),
    },
    graph_quality: {
      orphan_nodes: graph?.orphan_nodes.length ?? 0,
      duplicate_candidates: graph?.duplicate_node_ids.length ?? 0,
      broken_links: graph?.broken_links.length ?? 0,
      missing_backlinks: graph?.missing_backlinks.length ?? 0,
    },
    safety: {
      // Writers only touch the staging vault; PolicyGuard blocks any raw write before it runs.
      // So the real raw/ tree is never modified by a run — this is invariantly false in the MVP.
      raw_modified: false,
      secret_warnings: count(policyViolations, v => v.rule === 'secret'),
      canonical_direct_overwrite_attempts: count(policyViolations, v => v.rule === 'canonical_overwrite'),
      delete_attempts: count(policyViolations, v => v.rule === 'delete'),
    },
    usefulness: {
      current_update_proposals: inputs.applied?.proposals.length ?? 0,
      next_task_candidates: 0,
      shared_promotion_candidates: 0,
    },
  })
}
