import type { KhWritePlan, KhWriteOp } from '@apc/shared'
import type { StagingVault } from '../staging/staging-vault.js'

export type AppliedWriteReport = { applied: string[]; proposals: string[]; skipped: string[] }

/** Turn a write op's path into its `.proposal.md` sibling (canonical docs are never overwritten directly). */
function proposalPath(path: string): string {
  return path.replace(/\.md$/i, '.proposal.md')
}

function bodyOf(op: KhWriteOp): string {
  return op.content ?? op.content_template ?? ''
}

/**
 * Deterministic executor of an approved WritePlan against a StagingVault.
 * - `mode: proposal_only` → writes a `.proposal.md` sibling instead of overwriting.
 * - paths under `raw/` are skipped (defense in depth; PolicyGuard is the primary guard in Phase 3).
 * - only `create_file` / `append_section` ops write content in the MVP; others are skipped.
 */
export class ObsidianWikiWriter {
  readonly name = 'obsidian-wiki-writer'

  apply(plan: KhWritePlan, staging: StagingVault): AppliedWriteReport {
    const report: AppliedWriteReport = { applied: [], proposals: [], skipped: [] }
    for (const op of plan.operations) {
      if (op.path.startsWith('raw/') || op.path.includes('/raw/')) { report.skipped.push(op.path); continue }
      if (op.op !== 'create_file' && op.op !== 'append_section') { report.skipped.push(op.path); continue }
      if (op.mode === 'proposal_only') {
        const p = proposalPath(op.path)
        staging.writeDoc(p, bodyOf(op))
        report.proposals.push(p)
      } else {
        staging.writeDoc(op.path, bodyOf(op))
        report.applied.push(op.path)
      }
    }
    return report
  }
}
