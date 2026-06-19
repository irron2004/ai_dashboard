import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NodeConfirmPanel } from './NodeConfirmPanel.js'

describe('NodeConfirmPanel', () => {
  test('removing a node then confirming sends only the kept nodes', () => {
    const onConfirm = vi.fn()
    const proposed = [
      { id: 'a', title: 'A', type: 'ConceptNode', source_proposal_id: 'pp-a' },
      { id: 'b', title: 'B', type: 'ConceptNode', source_proposal_id: 'pp-b' },
    ]
    render(<NodeConfirmPanel proposed={proposed} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByLabelText('제거 B'))     // drop node B
    fireEvent.click(screen.getByText('이대로 생성'))
    expect(onConfirm).toHaveBeenCalledWith({ nodes: [expect.objectContaining({ id: 'a', title: 'A' })] })
  })
})
