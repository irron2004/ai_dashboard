import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MarkdownContent } from './MarkdownContent.js'

describe('MarkdownContent', () => {
  test('renders headings, lists and code from a markdown string', () => {
    render(<MarkdownContent markdown={'# Title\n\n- one\n- two\n\n```ts\nconst x = 1\n```'} onOpenWikiLink={vi.fn()} />)
    expect(screen.getByText('Title')).toBeDefined()
    expect(screen.getByText('one')).toBeDefined()
  })

  test('wiki links fire onOpenWikiLink with the target', () => {
    const onOpen = vi.fn()
    render(<MarkdownContent markdown={'see [[아키텍처|arch]]'} onOpenWikiLink={onOpen} />)
    fireEvent.click(screen.getByText('arch'))
    expect(onOpen).toHaveBeenCalledWith('아키텍처')
  })
})
