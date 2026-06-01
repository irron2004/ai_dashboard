import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ReviewActions } from './ReviewActions.js'

describe('ReviewActions', () => {
  test('renders approve, needs_changes, and reject buttons', () => {
    const onReview = vi.fn()
    render(<ReviewActions onReview={onReview} />)
    expect(screen.getByText('Approve')).toBeDefined()
    expect(screen.getByText('Needs changes')).toBeDefined()
    expect(screen.getByText('Reject')).toBeDefined()
  })

  test('calls onReview with approved status and typed summary when Approve is clicked', () => {
    const onReview = vi.fn()
    render(<ReviewActions onReview={onReview} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'great work' } })
    fireEvent.click(screen.getByText('Approve'))
    expect(onReview).toHaveBeenCalledWith({ status: 'approved', summary: 'great work' })
  })

  test('calls onReview with needs_changes status', () => {
    const onReview = vi.fn()
    render(<ReviewActions onReview={onReview} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'fix the tests' } })
    fireEvent.click(screen.getByText('Needs changes'))
    expect(onReview).toHaveBeenCalledWith({ status: 'needs_changes', summary: 'fix the tests' })
  })

  test('calls onReview with rejected status', () => {
    const onReview = vi.fn()
    render(<ReviewActions onReview={onReview} />)
    fireEvent.click(screen.getByText('Reject'))
    expect(onReview).toHaveBeenCalledWith({ status: 'rejected', summary: '' })
  })
})
