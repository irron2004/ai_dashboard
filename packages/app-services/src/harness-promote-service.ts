import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ConflictManager } from '@apc/core'
import { RunArtifactStore, isCanonical, resolveInside } from '@apc/knowledge-harness'

export type HarnessPromoteResult =
  | { ok: true; promoted: string[]; proposals: string[]; refusedCanonical: string[] }
  | { ok: false; reason: string }

/** Hash-gated promotion of one canonical proposal (`<x>.proposal.md` → `<x>.md`), acceptance #7. */
export type CanonicalPromoteResult =
  | { ok: true; status: 'promoted'; canonicalPath: string; newHash: string }
  | { ok: true; status: 'conflict'; conflictPath: string }
  | { ok: false; reason: string }

export type HarnessPromoteDeps = {
  runsRoot: string
  vaultRoot: string
  /** staging dir for a given run; defaults to <runsRoot>/<runId>/vault-staging (matches HarnessService). */
  stagingDirFor?: (runId: string) => string
  /** for hash-gated canonical promotion; defaults to a fresh ConflictManager. */
  conflict?: ConflictManager
  /** timestamp slug for conflict doc filenames. */
  stamp?: string
}

/**
 * Promote a finished run's staging output into the real vault.
 * MVP policy (auto_write_to_real_vault=false, auto_update_current=false): copy only the
 * evidence-backed non-canonical files (AppliedWriteReport.applied[]) into the real vault; canonical
 * targets remain as `.proposal.md` (AppliedWriteReport.proposals[]) for the human to merge in Obsidian.
 *
 * Deterministic backstops (do not trust upstream): refuses if the VALIDATED secret scan found
 * anything (unless allowSecrets), never copies a canonical path even if it leaked into applied[],
 * and resolves every source/target inside its root (no path escape).
 */
export class HarnessPromoteService {
  constructor(private readonly deps: HarnessPromoteDeps) {}

  private stagingDir(runId: string): string {
    return this.deps.stagingDirFor?.(runId) ?? resolveInside(this.deps.runsRoot, `${runId}/vault-staging`)
  }

  promote(input: { runId: string; allowSecrets?: boolean }): HarnessPromoteResult {
    const store = new RunArtifactStore(resolveInside(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const rs = store.loadRunState()
    if (rs.state !== 'HUMAN_REVIEW_REQUIRED') {
      return { ok: false, reason: `run is ${rs.state}, expected HUMAN_REVIEW_REQUIRED` }
    }

    // Secret gate: a leaked secret in staged content must not reach the real vault.
    if (!input.allowSecrets) {
      const secretRel = (rs.artifacts['VALIDATED'] ?? []).find(p => p.endsWith('secret-scan-report.json'))
      if (secretRel) {
        const secret = store.readArtifact<{ ok: boolean; findings: unknown[] }>(secretRel)
        if (!secret.ok) {
          return { ok: false, reason: `${secret.findings.length} secret finding(s) in staging; promotion blocked (pass allowSecrets to override)` }
        }
      }
    }

    const appliedPaths = rs.artifacts['STAGING_WRITTEN'] ?? []
    const rel = appliedPaths.find(p => p.endsWith('applied-write-report.json'))
    if (!rel) return { ok: false, reason: 'no applied-write-report in run' }
    const report = store.readArtifact<{ applied: string[]; proposals: string[] }>(rel)

    const staging = this.stagingDir(input.runId)
    const copy = (relPath: string): boolean => {
      const from = resolveInside(staging, relPath)          // source must be inside staging
      const to = resolveInside(this.deps.vaultRoot, relPath) // target must be inside the vault
      if (!existsSync(from)) return false
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
      return true
    }

    // Belt: a canonical path must never be copied into the real vault, even if it leaked into applied[].
    const refusedCanonical = report.applied.filter(isCanonical)
    const promoted = report.applied.filter(p => !isCanonical(p)).filter(copy)
    const proposals = report.proposals.filter(copy)  // .proposal.md siblings — never overwrite canonical
    return { ok: true, promoted, proposals, refusedCanonical }
  }

  /**
   * List this run's canonical proposals with the CURRENT hash of each real-vault canonical (or null if
   * the canonical doesn't exist yet). The renderer captures this hash when it displays the proposal and
   * passes it back to promoteCanonical as `lastReadHash`, so an Obsidian edit made afterward is detected.
   */
  canonicalProposals(runId: string): Array<{ proposalRelPath: string; canonicalPath: string; currentHash: string | null }> {
    const store = new RunArtifactStore(resolveInside(this.deps.runsRoot, runId))
    if (!store.exists()) return []
    const rs = store.loadRunState()
    const rel = (rs.artifacts['STAGING_WRITTEN'] ?? []).find(p => p.endsWith('applied-write-report.json'))
    if (!rel) return []
    const report = store.readArtifact<{ proposals: string[] }>(rel)
    const conflict = this.deps.conflict ?? new ConflictManager()
    return report.proposals
      .map(proposalRelPath => ({ proposalRelPath, canonicalPath: proposalRelPath.replace(/\.proposal\.md$/i, '.md') }))
      .filter(p => isCanonical(p.canonicalPath))
      .map(p => {
        const abs = resolveInside(this.deps.vaultRoot, p.canonicalPath)
        return { ...p, currentHash: existsSync(abs) ? conflict.hash(readFileSync(abs, 'utf8')) : null }
      })
  }

  /**
   * Hash-gated promotion of ONE canonical proposal into the real vault (design §8 / acceptance #7).
   * `proposalRelPath` is a staged `<x>.proposal.md`; its target is `<x>.md`. If the vault canonical
   * changed since the app last read it (lastReadHash mismatch), writes a conflict doc and refuses to
   * overwrite — never clobbers an out-of-band edit. Reuses ConflictManager (same primitive as
   * CurrentPromotionService) so this is layout-agnostic (any canonical path, not just projects/<id>).
   */
  promoteCanonical(input: { runId: string; proposalRelPath: string; lastReadHash: string }): CanonicalPromoteResult {
    if (!input.proposalRelPath.endsWith('.proposal.md')) {
      return { ok: false, reason: `not a canonical proposal: ${input.proposalRelPath}` }
    }
    const conflict = this.deps.conflict ?? new ConflictManager()
    const canonicalRel = input.proposalRelPath.replace(/\.proposal\.md$/i, '.md')
    if (!isCanonical(canonicalRel)) return { ok: false, reason: `target is not a canonical doc: ${canonicalRel}` }

    const from = resolveInside(this.stagingDir(input.runId), input.proposalRelPath)
    if (!existsSync(from)) return { ok: false, reason: `staged proposal not found: ${input.proposalRelPath}` }
    const proposed = readFileSync(from, 'utf8')

    const canonicalAbs = resolveInside(this.deps.vaultRoot, canonicalRel)
    const canonicalBody = existsSync(canonicalAbs) ? readFileSync(canonicalAbs, 'utf8') : undefined

    if (canonicalBody !== undefined && conflict.detectConflict(input.lastReadHash, canonicalBody)) {
      const conflictRel = canonicalRel.replace(/\.md$/i, `.${this.deps.stamp ?? 'conflict'}.conflict.md`)
      const conflictAbs = resolveInside(this.deps.vaultRoot, conflictRel)
      mkdirSync(dirname(conflictAbs), { recursive: true })
      writeFileSync(conflictAbs, conflict.buildConflictDoc({
        targetPath: canonicalRel, previousVersion: '(app last-read hash did not match)',
        currentVersion: canonicalBody, proposedChange: proposed,
      }))
      return { ok: true, status: 'conflict', conflictPath: conflictRel }
    }

    mkdirSync(dirname(canonicalAbs), { recursive: true })
    writeFileSync(canonicalAbs, proposed)
    return { ok: true, status: 'promoted', canonicalPath: canonicalRel, newHash: conflict.hash(proposed) }
  }
}
