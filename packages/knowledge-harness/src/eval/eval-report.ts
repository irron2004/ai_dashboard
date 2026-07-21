import {
  KhEvalReportSchema,
  type KhEvalReport, type KhNodeProposal, type KhPolicyReport, type KhGraphValidationReport,
} from '@apc/shared'
import { isRaw } from '../runtime/vault-fs.js'

export type EvalInputs = {
  sourcesTotal?: number
  sourcesClassified?: number
  proposals?: KhNodeProposal[]
  policy?: KhPolicyReport
  graph?: KhGraphValidationReport
  applied?: { applied: string[]; proposals: string[]; skipped: string[] }
  /** Lead-produced shared-promotion plan; this is the metric's actual data source. */
  sharedPromotion?: { candidates: unknown[] }
  /** count of findings from the VALIDATED body-content secret scan (PolicyGuard only sees evidence text). */
  secretScanFindings?: number
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
      // honor each proposal's own minimum plus the shared_candidate floor (≥2), not a hardcoded ≥1
      proposals_with_minimum_evidence: count(proposals, p =>
        p.evidence.length >= Math.max(p.claim_policy.minimum_evidence_count, p.node.scope === 'shared_candidate' ? 2 : 1)),
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
      // The Writer skips any op under raw/ (pushed to AppliedWriteReport.skipped), so raw/ should
      // never appear in `applied`. Compute the invariant from the observed signal instead of
      // hardcoding it: if a raw path ever lands in `applied`, that is a real breach and flips true.
      raw_modified: (inputs.applied?.applied ?? []).some(p => isRaw(p)),
      // evidence-text hits (PolicyGuard) + body-content hits (VALIDATED secret scan)
      secret_warnings: count(policyViolations, v => v.rule === 'secret') + (inputs.secretScanFindings ?? 0),
      canonical_direct_overwrite_attempts: count(policyViolations, v => v.rule === 'canonical_overwrite'),
      delete_attempts: count(policyViolations, v => v.rule === 'delete'),
    },
    usefulness: {
      current_update_proposals: inputs.applied?.proposals.length ?? 0,
      // No trustworthy next-task source exists yet. The schema preserves its compatibility default (0),
      // while the UI intentionally does not present it as if it had been measured.
      shared_promotion_candidates: inputs.sharedPromotion?.candidates.length ?? 0,
    },
  })
}
