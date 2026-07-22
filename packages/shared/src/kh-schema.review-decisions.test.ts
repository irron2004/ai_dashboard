import { describe, expect, test } from 'vitest'
import { KhReviewDecisionsSchema } from './kh-schema.js'

describe('KhReviewDecisionsSchema', () => {
  test('parses a decisions list and rejects unknown verdicts', () => {
    const parsed = KhReviewDecisionsSchema.parse({
      decisions: [
        { proposal_id: 'NP-1', verdict: 'approved', decided_at: '2026-07-21T00:00:00Z' },
        { proposal_id: 'NP-2', verdict: 'excluded', decided_at: '2026-07-21T00:00:01Z' },
      ],
    })
    expect(parsed.decisions).toHaveLength(2)
    expect(() => KhReviewDecisionsSchema.parse({
      decisions: [{ proposal_id: 'NP-1', verdict: 'maybe', decided_at: 'x' }],
    })).toThrow()
  })

  test('defaults to an empty decisions list and rejects a duplicate proposal_id', () => {
    expect(KhReviewDecisionsSchema.parse({}).decisions).toEqual([])
    expect(() => KhReviewDecisionsSchema.parse({
      decisions: [
        { proposal_id: 'NP-1', verdict: 'approved', decided_at: 'x' },
        { proposal_id: 'NP-1', verdict: 'excluded', decided_at: 'y' },
      ],
    })).toThrow(/duplicate/)
  })
})
