import { beforeEach, describe, expect, test } from 'vitest'
import { migrate, openDb, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { ReceiptStore } from './receipt-store.js'

describe('ReceiptStore', () => {
  let db: Db
  let store: ReceiptStore

  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    migratePm(db)
    store = new ReceiptStore(db)
  })

  test('stores the immutable review evidence binding and queries by target/repo', () => {
    const receipt = store.add({
      projectId: 'p1', repoPath: '/repo', branch: 'main', reviewedHeadSha: 'a'.repeat(40),
      retroId: 'retro:2026-07-20', targetId: 'rt:one',
      answeredQuestionIds: ['q1', 'q2'], evidenceRefs: ['pnpm test: 12 passed'],
      answerSnapshotHash: 'b'.repeat(64), issuedAt: '2026-07-20T12:00:00Z',
    })

    expect(store.get(receipt.id)).toEqual(receipt)
    expect(store.latestForRepo('/repo')?.id).toBe(receipt.id)
    expect(store.forTarget('rt:one')?.answeredQuestionIds).toEqual(['q1', 'q2'])
    expect(store.listByRetro('retro:2026-07-20')).toHaveLength(1)
  })

  test('delete supports compensating a failed gate-file write', () => {
    const receipt = store.add({
      projectId: 'p1', repoPath: '/repo', reviewedHeadSha: 'a'.repeat(40),
      retroId: 'retro:2026-07-20', targetId: 'rt:one', answeredQuestionIds: ['q1'],
      evidenceRefs: ['manual'], answerSnapshotHash: 'b'.repeat(64), issuedAt: '2026-07-20T12:00:00Z',
    })
    store.delete(receipt.id)
    expect(store.get(receipt.id)).toBeNull()
    expect(store.forTarget('rt:one')).toBeNull()
  })
})
