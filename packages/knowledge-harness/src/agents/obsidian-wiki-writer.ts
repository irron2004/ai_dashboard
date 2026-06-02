import { readFileSync, existsSync } from 'node:fs'
import type { KhWritePlan, KhWriteOp } from '@apc/shared'
import type { StagingVault } from '../staging/staging-vault.js'
import { isCanonical, resolveInside } from '../runtime/vault-fs.js'

export type AppliedWriteReport = { applied: string[]; proposals: string[]; skipped: string[] }

/** Turn a write op's path into its `.proposal.md` sibling (canonical docs are never overwritten directly). */
function proposalPath(path: string): string {
  return path.replace(/\.md$/i, '.proposal.md')
}

function bodyOf(op: KhWriteOp): string {
  return op.content ?? op.content_template ?? ''
}

/** Resolve the body to write at `relPath`. `append_section` preserves any existing staged content
 * (StagingVault pre-seeds the real vault) instead of truncating it; `create_file` writes fresh. */
function bodyToWrite(op: KhWriteOp, staging: StagingVault, relPath: string): string {
  if (op.op === 'append_section') {
    const abs = resolveInside(staging.stagingPath, relPath)
    if (existsSync(abs)) return `${readFileSync(abs, 'utf8')}\n${bodyOf(op)}`
  }
  return bodyOf(op)
}

/**
 * Deterministic executor of an approved WritePlan against a StagingVault.
 * - canonical docs (current.md/PRD.md/ADR-*) are ALWAYS routed to a `.proposal.md` sibling,
 *   regardless of the op's declared mode — the "never overwrite canonical" invariant must not
 *   depend on the LLM Lead setting mode correctly.
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
      // Force proposal routing for canonical paths even if the LLM set mode: 'apply'.
      if (op.mode === 'proposal_only' || isCanonical(op.path)) {
        const p = proposalPath(op.path)
        staging.writeDoc(p, bodyToWrite(op, staging, p))
        report.proposals.push(p)
      } else {
        staging.writeDoc(op.path, bodyToWrite(op, staging, op.path))
        report.applied.push(op.path)
      }
    }
    return report
  }
}
