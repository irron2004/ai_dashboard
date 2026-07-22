import { randomUUID } from 'node:crypto'
import { ReviewReceiptSchema, type ReviewReceipt } from '@apc/shared'
import type { Db } from '@apc/core'

type ReceiptRow = {
  id: string
  project_id: string
  repo_path: string
  branch: string | null
  reviewed_head_sha: string
  diff_hash: string | null
  retro_id: string
  target_id: string
  answered_question_ids: string
  evidence_refs: string
  answer_snapshot_hash: string
  issued_at: string
}

function stringArray(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function toReceipt(row: ReceiptRow): ReviewReceipt {
  return ReviewReceiptSchema.parse({
    id: row.id,
    projectId: row.project_id,
    repoPath: row.repo_path,
    branch: row.branch ?? undefined,
    reviewedHeadSha: row.reviewed_head_sha,
    diffHash: row.diff_hash ?? undefined,
    retroId: row.retro_id,
    targetId: row.target_id,
    answeredQuestionIds: stringArray(row.answered_question_ids),
    evidenceRefs: stringArray(row.evidence_refs),
    answerSnapshotHash: row.answer_snapshot_hash,
    issuedAt: row.issued_at,
  })
}

export class ReceiptStore {
  constructor(private readonly db: Db) {}

  add(input: Omit<ReviewReceipt, 'id'>): ReviewReceipt {
    const receipt = ReviewReceiptSchema.parse({ ...input, id: `receipt:${randomUUID()}` })
    this.db.prepare(`
      INSERT INTO review_receipts (
        id, project_id, repo_path, branch, reviewed_head_sha, diff_hash, retro_id, target_id,
        answered_question_ids, evidence_refs, answer_snapshot_hash, issued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id, receipt.projectId, receipt.repoPath, receipt.branch ?? null,
      receipt.reviewedHeadSha, receipt.diffHash ?? null, receipt.retroId, receipt.targetId,
      JSON.stringify(receipt.answeredQuestionIds), JSON.stringify(receipt.evidenceRefs),
      receipt.answerSnapshotHash, receipt.issuedAt,
    )
    return receipt
  }

  get(id: string): ReviewReceipt | null {
    const row = this.db.prepare('SELECT * FROM review_receipts WHERE id = ?').get(id) as ReceiptRow | undefined
    return row ? toReceipt(row) : null
  }

  latestForRepo(repoPath: string): ReviewReceipt | null {
    const row = this.db.prepare('SELECT * FROM review_receipts WHERE repo_path = ? ORDER BY issued_at DESC LIMIT 1').get(repoPath) as ReceiptRow | undefined
    return row ? toReceipt(row) : null
  }

  forTarget(targetId: string): ReviewReceipt | null {
    const row = this.db.prepare('SELECT * FROM review_receipts WHERE target_id = ? ORDER BY issued_at DESC LIMIT 1').get(targetId) as ReceiptRow | undefined
    return row ? toReceipt(row) : null
  }

  listByRetro(retroId: string): ReviewReceipt[] {
    return (this.db.prepare('SELECT * FROM review_receipts WHERE retro_id = ? ORDER BY issued_at').all(retroId) as ReceiptRow[]).map(toReceipt)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM review_receipts WHERE id = ?').run(id)
  }
}
