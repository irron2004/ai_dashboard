import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type {
  FileRefsResolveRes,
  ParsedFileReference,
  ResolvedFileReference,
} from '@apc/shared'
import { FileReferenceText } from './FileReferenceText.js'

function resolved(candidate: ParsedFileReference, projectId = 'p1'): ResolvedFileReference {
  return {
    ...candidate,
    token: `${projectId}:${candidate.path}`,
    projectId,
    canonicalPath: `/repo/${candidate.path}`,
    displayPath: candidate.path,
    workspaceRoot: '/repo',
    kind: candidate.path.endsWith('.py') ? 'python' : 'markdown',
    size: 12,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('FileReferenceText', () => {
  test('resolves candidates as one scoped batch and activates only verified ranges', async () => {
    const onOpen = vi.fn()
    const resolveReferences = vi.fn(async (req): Promise<FileRefsResolveRes> => ({
      resolved: [resolved(req.candidates[0]!)],
      unresolved: [{ candidate: req.candidates[1]!, reason: '파일이 없습니다.' }],
    }))
    const text = '문서는 docs/readme.md, 누락은 src/missing.py.'
    const { container } = render(
      <FileReferenceText
        text={text}
        projectId="p1"
        activeWorktreePath="/repo/active"
        sessionWorkspacePath="/repo/session"
        resolveReferences={resolveReferences}
        onOpenReference={onOpen}
      />,
    )

    const link = await screen.findByRole('link', { name: 'docs/readme.md 파일 미리보기' })
    expect(resolveReferences).toHaveBeenCalledTimes(1)
    expect(resolveReferences.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'p1',
      activeWorktreePath: '/repo/active',
      sessionWorkspacePath: '/repo/session',
    })
    expect(resolveReferences.mock.calls[0]?.[0].candidates.map((item: ParsedFileReference) => item.path)).toEqual([
      'docs/readme.md', 'src/missing.py',
    ])
    expect(container.querySelector('.file-reference-text__source')?.textContent).toBe(text)
    expect(screen.getByText(/파일이 없습니다/)).toBeDefined()
    expect(screen.queryByRole('link', { name: /src\/missing.py/ })).toBeNull()

    fireEvent.click(link)
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(link, { ctrlKey: true })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: 'docs/readme.md' }))
    fireEvent.keyDown(link, { key: 'Enter' })
    fireEvent.keyDown(link, { key: ' ' })
    expect(onOpen).toHaveBeenCalledTimes(3)
  })

  test('ignores resolved entries that do not belong to the exact request batch', async () => {
    const resolveReferences = vi.fn(async (req): Promise<FileRefsResolveRes> => ({
      resolved: [{ ...resolved(req.candidates[0]!), start: 999, end: 1005 }],
      unresolved: [],
    }))
    render(
      <FileReferenceText
        text="docs/readme.md"
        projectId="p1"
        resolveReferences={resolveReferences}
        onOpenReference={() => {}}
      />,
    )

    await waitFor(() => expect(resolveReferences).toHaveBeenCalled())
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('docs/readme.md')).toBeDefined()
  })

  test('discards a slower response after the project and source text change', async () => {
    const first = deferred<FileRefsResolveRes>()
    const second = deferred<FileRefsResolveRes>()
    const resolveReferences = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const view = render(
      <FileReferenceText
        text="docs/old.md"
        projectId="p1"
        resolveReferences={resolveReferences}
        onOpenReference={() => {}}
      />,
    )
    await waitFor(() => expect(resolveReferences).toHaveBeenCalledTimes(1))
    view.rerender(
      <FileReferenceText
        text="src/new.py"
        projectId="p2"
        resolveReferences={resolveReferences}
        onOpenReference={() => {}}
      />,
    )
    await waitFor(() => expect(resolveReferences).toHaveBeenCalledTimes(2))
    const newCandidate = resolveReferences.mock.calls[1]![0].candidates[0] as ParsedFileReference
    await act(async () => second.resolve({ resolved: [resolved(newCandidate, 'p2')], unresolved: [] }))
    expect(await screen.findByRole('link', { name: 'src/new.py 파일 미리보기' })).toBeDefined()

    const oldCandidate = resolveReferences.mock.calls[0]![0].candidates[0] as ParsedFileReference
    await act(async () => first.resolve({ resolved: [resolved(oldCandidate, 'p1')], unresolved: [] }))
    expect(screen.queryByRole('link', { name: 'docs/old.md 파일 미리보기' })).toBeNull()
    expect(screen.getByRole('link', { name: 'src/new.py 파일 미리보기' })).toBeDefined()
  })

  test('does not call main when the text has no supported file reference', () => {
    const resolveReferences = vi.fn()
    render(
      <FileReferenceText
        text="https://example.com/readme.md"
        projectId="p1"
        resolveReferences={resolveReferences}
        onOpenReference={() => {}}
      />,
    )
    expect(resolveReferences).not.toHaveBeenCalled()
    expect(screen.getByText('https://example.com/readme.md')).toBeDefined()
  })
})
