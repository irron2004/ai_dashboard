import type { VaultAdapter } from '@apc/vault'
import type { ConflictManager } from '@apc/core'

export type PromotionDeps = { vault: VaultAdapter; conflict: ConflictManager; stamp: string }
export type PromotionResult =
  | { status: 'promoted'; canonicalPath: string; newHash: string }
  | { status: 'conflict'; conflictPath: string }

export class CurrentPromotionService {
  constructor(private readonly deps: PromotionDeps) {}

  promote(input: { projectId: string; lastReadHash: string }): PromotionResult {
    const base = `projects/${input.projectId}`
    const proposalRel = `${base}/current.proposal.md`
    const canonicalRel = `${base}/current.md`
    const proposed = this.deps.vault.readDoc(proposalRel).body   // throws if missing

    let canonicalBody: string | undefined
    try { canonicalBody = this.deps.vault.readDoc(canonicalRel).body } catch { canonicalBody = undefined }

    if (canonicalBody !== undefined && this.deps.conflict.detectConflict(input.lastReadHash, canonicalBody)) {
      const conflictPath = `${base}/conflicts/${this.deps.stamp}-current-conflict.md`
      this.deps.vault.writeDoc(conflictPath, {
        frontmatter: { type: 'conflict', target: canonicalRel },
        body: this.deps.conflict.buildConflictDoc({
          targetPath: canonicalRel, previousVersion: '(app last-read hash did not match)',
          currentVersion: canonicalBody, proposedChange: proposed,
        }),
      })
      return { status: 'conflict', conflictPath }
    }

    this.deps.vault.writeDoc(canonicalRel, { frontmatter: { type: 'current', project_id: input.projectId }, body: proposed })
    return { status: 'promoted', canonicalPath: canonicalRel, newHash: this.deps.conflict.hash(proposed) }
  }
}
