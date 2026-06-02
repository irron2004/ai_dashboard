import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RunArtifactStore } from '@apc/knowledge-harness'

export type HarnessPromoteResult =
  | { ok: true; promoted: string[]; proposals: string[] }
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
 * Never overwrites an existing canonical doc.
 */
export class HarnessPromoteService {
  constructor(private readonly deps: HarnessPromoteDeps) {}

  private stagingDir(runId: string): string {
    return this.deps.stagingDirFor?.(runId) ?? join(this.deps.runsRoot, runId, 'vault-staging')
  }

  promote(input: { runId: string }): HarnessPromoteResult {
    const store = new RunArtifactStore(join(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const rs = store.loadRunState()
    if (rs.state !== 'HUMAN_REVIEW_REQUIRED') {
      return { ok: false, reason: `run is ${rs.state}, expected HUMAN_REVIEW_REQUIRED` }
    }

    const appliedPaths = rs.artifacts['STAGING_WRITTEN'] ?? []
    const rel = appliedPaths.find(p => p.endsWith('applied-write-report.json'))
    if (!rel) return { ok: false, reason: 'no applied-write-report in run' }
    const report = store.readArtifact<{ applied: string[]; proposals: string[] }>(rel)

    const staging = this.stagingDir(input.runId)
    const copy = (relPath: string): boolean => {
      const from = join(staging, relPath)
      const to = join(this.deps.vaultRoot, relPath)
      if (!existsSync(from)) return false
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
      return true
    }

    const promoted = report.applied.filter(copy)
    const proposals = report.proposals.filter(copy)  // .proposal.md siblings — never overwrite canonical
    return { ok: true, promoted, proposals }
  }
}
