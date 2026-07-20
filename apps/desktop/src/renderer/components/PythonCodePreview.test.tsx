import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { PythonCodePreview } from './PythonCodePreview.js'

describe('PythonCodePreview', () => {
  test('renders line numbers, text tokens, and the requested line without HTML injection', () => {
    const { container } = render(
      <PythonCodePreview
        code={'def greet(name):\n    value = 42  # answer\n    return "<img src=x onerror=alert(1)>"'}
        targetLine={2}
      />,
    )

    expect(screen.getByLabelText('Python source')).toBeDefined()
    expect(container.querySelector('[data-line="2"]')?.className).toContain('python-preview__line--target')
    expect(container.querySelectorAll('.python-preview__line-number')).toHaveLength(3)
    expect(container.querySelector('.python-preview__token--keyword')?.textContent).toBe('def')
    expect(container.querySelector('.python-preview__token--number')?.textContent).toBe('42')
    expect(container.querySelector('.python-preview__token--comment')?.textContent).toBe('# answer')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/<img src=x/)).toBeDefined()
  })
})
