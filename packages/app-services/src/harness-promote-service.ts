import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { RunArtifactStore, isCanonical, resolveInside } from '@apc/knowledge-harness'

export type HarnessPromoteResult =
  | { ok: true; promoted: string[]; proposals: string[]; refusedCanonical: string[] }
  | { ok: false; reason: string }

export type HarnessPromoteDeps = {
  runsRoot: string
  vaultRoot: string
  /** staging dir for a given run; defaults to <runsRoot>/<runId>/vault-staging (matches HarnessService). */
  stagingDirFor?: (runId: string) => string
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
}
