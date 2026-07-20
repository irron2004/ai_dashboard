import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { FileRefsResolveRes, ParsedFileReference, ResolvedFileReference } from '@apc/shared'
import { MarkdownContent } from './MarkdownContent.js'

function resolved(candidate: ParsedFileReference): ResolvedFileReference {
  return {
    ...candidate,
    token: candidate.path,
    projectId: 'p1',
    canonicalPath: `/repo/${candidate.path}`,
    displayPath: candidate.path,
    workspaceRoot: '/repo',
    kind: candidate.path.endsWith('.py') ? 'python' : 'markdown',
    size: 10,
  }
}

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

  test('renders plain markdown links as anchors', () => {
    render(<MarkdownContent markdown={'see [docs](https://example.com)'} onOpenWikiLink={vi.fn()} />)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link.getAttribute('href')).toBe('https://example.com')
  })

  test('batch-resolves local markdown links and previews them only on a modifier or keyboard action', async () => {
    const onOpen = vi.fn()
    const resolveFileReferences = vi.fn(async (req): Promise<FileRefsResolveRes> => ({
      resolved: req.candidates.map(resolved),
      unresolved: [],
    }))
    render(
      <MarkdownContent
        markdown={'see [source](src/main(test).py)'}
        onOpenWikiLink={() => {}}
        projectId="p1"
        activeWorktreePath="/repo/active"
        sessionWorkspacePath="/repo/session"
        resolveFileReferences={resolveFileReferences}
        onOpenFileReference={onOpen}
      />,
    )
    const link = screen.getByRole('link', { name: 'source' })
    await waitFor(() => expect(link.className).toContain('markdown-viewer__file-reference'))
    expect(resolveFileReferences).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', activeWorktreePath: '/repo/active', sessionWorkspacePath: '/repo/session',
    }))

    fireEvent.click(link)
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(link, { metaKey: true })
    fireEvent.keyDown(link, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'src/main(test).py' }))
  })

  test('keeps an unresolved markdown link and explains why it cannot be previewed', async () => {
    const resolveFileReferences = vi.fn(async (req): Promise<FileRefsResolveRes> => ({
      resolved: [],
      unresolved: [{ candidate: req.candidates[0]!, reason: '프로젝트 밖의 경로입니다.' }],
    }))
    render(
      <MarkdownContent
        markdown={'[missing](../outside.md)'}
        onOpenWikiLink={() => {}}
        projectId="p1"
        resolveFileReferences={resolveFileReferences}
        onOpenFileReference={() => {}}
      />,
    )

    expect(screen.getByRole('link', { name: 'missing' }).getAttribute('href')).toBe('../outside.md')
    expect(await screen.findByText(/프로젝트 밖의 경로입니다/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'missing' }).className).not.toContain('markdown-viewer__file-reference')
  })

  test('does not send external links to the file resolver', () => {
    const resolveFileReferences = vi.fn()
    render(
      <MarkdownContent
        markdown={'[site](https://example.com/docs.md)'}
        onOpenWikiLink={() => {}}
        projectId="p1"
        resolveFileReferences={resolveFileReferences}
        onOpenFileReference={() => {}}
      />,
    )
    expect(resolveFileReferences).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'site' }).getAttribute('href')).toBe('https://example.com/docs.md')
  })
})
