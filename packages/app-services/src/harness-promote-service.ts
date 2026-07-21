import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RunState } from '@apc/shared'
import { ConflictManager } from '@apc/core'
import { RunArtifactStore, isCanonical, resolveInside } from '@apc/knowledge-harness'

export type HarnessPromoteResult =
  | {
      ok: true
      promoted: string[]
      proposals: string[]
      refusedCanonical: string[]
      skippedByReview: string[]
      danglingLinks: number
    }
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

  /** Shared promotion gates (both promote() and promoteCanonical() must apply these): the run must be at
   * HUMAN_REVIEW_REQUIRED; (unless allowSecrets) the VALIDATED secret scan must be clean; and (unless
   * allowInvalid) the deterministic graph/markdown/link validators must all be `ok`. The run still
   * COMPLETES to HUMAN_REVIEW_REQUIRED so the human can read every report — these gates block PROMOTION,
   * not the run. Returns a refusal reason or null if promotion may proceed. */
  private gate(store: RunArtifactStore, rs: RunState, opts: { allowSecrets?: boolean; allowInvalid?: boolean } = {}): string | null {
    if (rs.state !== 'HUMAN_REVIEW_REQUIRED') return `run is ${rs.state}, expected HUMAN_REVIEW_REQUIRED`
    const validated = rs.artifacts['VALIDATED'] ?? []
    if (!opts.allowSecrets) {
      const secretRel = validated.find(p => p.endsWith('secret-scan-report.json'))
      if (secretRel) {
        const secret = store.readArtifact<{ ok: boolean; findings: unknown[] }>(secretRel)
        if (!secret.ok) return `${secret.findings.length} secret finding(s) in staging; promotion blocked (pass allowSecrets to override)`
      }
    }
    if (!opts.allowInvalid) {
      // B1 (#6/#25): broken-graph / invalid-markdown / broken-link output is NOT silently promotable.
      const reports: Array<[string, string]> = [
        ['graph-validation-report.json', 'graph integrity'],
        ['markdown-yaml-validation-report.json', 'markdown/YAML'],
        ['link-validation-report.json', 'wiki-link'],
      ]
      for (const [suffix, label] of reports) {
        const relPath = validated.find(p => p.endsWith(suffix))
        if (!relPath) continue
        const report = store.readArtifact<{ ok: boolean }>(relPath)
        if (!report.ok) return `${label} validation failed; promotion blocked (pass allowInvalid to override)`
      }
    }
    return null
  }

  promote(input: { runId: string; allowSecrets?: boolean; allowInvalid?: boolean }): HarnessPromoteResult {
    const store = new RunArtifactStore(resolveInside(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const rs = store.loadRunState()
    const blocked = this.gate(store, rs, input)
    if (blocked) return { ok: false, reason: blocked }

    const appliedPaths = rs.artifacts['STAGING_WRITTEN'] ?? []
    const rel = appliedPaths.find(p => p.endsWith('applied-write-report.json'))
    if (!rel) return { ok: false, reason: 'no applied-write-report in run' }
    const report = store.readArtifact<{ applied: string[]; proposals: string[] }>(rel)

    // A decisions artifact switches the run to explicit review semantics. Its absence is the only
    // legacy escape hatch: old/headless runs created before review decisions existed still promote all.
    const review = this.reviewFilter(store, rs, report.applied)
    if (!review.ok) return review
    const { toPromote, skippedByReview, skippedNodeIds } = review

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
    const refusedCanonical = toPromote.filter(isCanonical)
    const promoted = toPromote.filter(p => !isCanonical(p)).filter(copy)
    const proposals = report.proposals.filter(copy)  // .proposal.md siblings — never overwrite canonical

    // Broken wiki links are useful review feedback, but valid Obsidian markdown may intentionally
    // contain them. Count each approved-document → excluded-node reference and report without blocking.
    let danglingLinks = 0
    for (const relPath of promoted) {
      if (!/\.md$/i.test(relPath)) continue
      const abs = resolveInside(staging, relPath)
      if (!existsSync(abs)) continue
      const body = readFileSync(abs, 'utf8')
      for (const nodeId of skippedNodeIds) {
        const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const link = new RegExp(`\\[\\[${escaped}(?:[|#][^\\]]*)?\\]\\]`)
        if (link.test(body)) danglingLinks += 1
      }
    }
    return { ok: true, promoted, proposals, refusedCanonical, skippedByReview, danglingLinks }
  }

  /**
   * Resolve ownership from the lead write plan first, then from the deterministic node-doc path.
   * Files with no proposal owner (indexes and other shared output) remain promotable.
   */
  private reviewFilter(store: RunArtifactStore, rs: RunState, applied: string[]):
    | { ok: true; toPromote: string[]; skippedByReview: string[]; skippedNodeIds: string[] }
    | { ok: false; reason: string } {
    const norm = (path: string) => path.replace(/\\/g, '/')
    const decisionsRel = (rs.artifacts['HUMAN_REVIEW_REQUIRED'] ?? [])
      .find(path => path.endsWith('review-decisions.json'))
    if (!decisionsRel) {
      return { ok: true, toPromote: applied, skippedByReview: [], skippedNodeIds: [] }
    }

    const decisions = store.readArtifact<{
      decisions: Array<{ proposal_id: string; verdict: string }>
    }>(decisionsRel)
    const approved = new Set(
      decisions.decisions.filter(decision => decision.verdict === 'approved')
        .map(decision => decision.proposal_id),
    )
    if (approved.size === 0) {
      return { ok: false, reason: '승인된 항목이 없습니다 — 검수 탭에서 항목을 승인한 뒤 반영하세요' }
    }

    const proposalsRel = (rs.artifacts['NODE_PROPOSALS_CREATED'] ?? [])
      .find(path => path.endsWith('node-proposals.json'))
    const proposals = proposalsRel
      ? store.readArtifact<{
          proposals?: Array<{ proposal_id: string; node: { id: string } }>
        }>(proposalsRel).proposals ?? []
      : []
    const planRel = (rs.artifacts['WRITE_PLAN_CREATED'] ?? [])
      .find(path => path.endsWith('write-plan.json'))
    const operations = planRel
      ? store.readArtifact<{
          operations?: Array<{ path: string; source_proposal?: string }>
        }>(planRel).operations ?? []
      : []

    const ownerByPath = new Map(
      operations
        .filter((operation): operation is { path: string; source_proposal: string } =>
          typeof operation.source_proposal === 'string' && operation.source_proposal.length > 0)
        .map(operation => [norm(operation.path), operation.source_proposal]),
    )
    const proposalByNodeId = new Map(
      proposals.map(proposal => [proposal.node.id, proposal.proposal_id]),
    )
    const owner = (relPath: string): string | undefined => {
      const normalized = norm(relPath)
      const planOwner = ownerByPath.get(normalized)
      if (planOwner) return planOwner
      const match = /(?:^|\/)nodes\/(.+)\.md$/i.exec(normalized)
      return match ? proposalByNodeId.get(match[1]) : undefined
    }

    const skippedByReview = applied.filter(relPath => {
      const proposalId = owner(relPath)
      // Missing decisions are pending and therefore excluded at promotion time.
      return proposalId !== undefined && !approved.has(proposalId)
    })
    const skippedSet = new Set(skippedByReview)
    const skippedNodeIds = skippedByReview
      .map(relPath => /(?:^|\/)nodes\/(.+)\.md$/i.exec(norm(relPath))?.[1])
      .filter((nodeId): nodeId is string => Boolean(nodeId))

    return {
      ok: true,
      toPromote: applied.filter(relPath => !skippedSet.has(relPath)),
      skippedByReview,
      skippedNodeIds,
    }
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
    // Only a run awaiting human review may surface promotable proposals — never a FAILED/in-progress run.
    if (rs.state !== 'HUMAN_REVIEW_REQUIRED') return []
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
  promoteCanonical(input: { runId: string; proposalRelPath: string; lastReadHash: string; allowSecrets?: boolean; allowInvalid?: boolean }): CanonicalPromoteResult {
    if (!input.proposalRelPath.endsWith('.proposal.md')) {
      return { ok: false, reason: `not a canonical proposal: ${input.proposalRelPath}` }
    }
    // Same gates as promote(): HUMAN_REVIEW_REQUIRED + clean secret scan + valid graph/markdown/link.
    const store = new RunArtifactStore(resolveInside(this.deps.runsRoot, input.runId))
    if (!store.exists()) return { ok: false, reason: `run not found: ${input.runId}` }
    const blocked = this.gate(store, store.loadRunState(), input)
    if (blocked) return { ok: false, reason: blocked }

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
