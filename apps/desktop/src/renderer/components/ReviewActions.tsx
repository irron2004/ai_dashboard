import { useState } from 'react'
import type { Review } from '@apc/shared'

type ReviewStatus = Review['status']

type ReviewInput = {
  status: ReviewStatus
  summary: string
}

type Props = {
  onReview: (input: ReviewInput) => void
}

export function ReviewActions({ onReview }: Props) {
  const [summary, setSummary] = useState('')

  const handleReview = (status: ReviewStatus) => {
    onReview({ status, summary })
  }

  return (
    <div className="review-actions">
      <textarea
        className="review-actions__summary"
        placeholder="Review summary (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
      />
      <div className="review-actions__buttons">
        <button type="button" className="review-actions__btn review-actions__btn--approve" onClick={() => handleReview('approved')}>
          Approve
        </button>
        <button type="button" className="review-actions__btn review-actions__btn--needs-changes" onClick={() => handleReview('needs_changes')}>
          Needs changes
        </button>
        <button type="button" className="review-actions__btn review-actions__btn--reject" onClick={() => handleReview('rejected')}>
          Reject
        </button>
      </div>
    </div>
  )
}
