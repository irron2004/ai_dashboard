import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FilePreviewReadRes, ResolvedFileReference } from '@apc/shared'
import { FILE_PREVIEW_WIDTH_KEY, FilePreviewPanel } from './FilePreviewPanel.js'

function reference(token: string, kind: ResolvedFileReference['kind'] = 'markdown', line?: number): ResolvedFileReference {
  const path = kind === 'markdown' ? 'docs/readme.md' : kind === 'html' ? 'pages/demo.html' : 'src/main.py'
  return {
    raw: path, path, form: 'bare', start: 0, end: path.length,
    ...(line === undefined ? {} : { line }),
    token, projectId: 'p1', canonicalPath: `/repo/${path}`, displayPath: path,
    workspaceRoot: '/repo', kind, size: 12,
  }
}

function success(target: ResolvedFileReference, content: string): FilePreviewReadRes {
  return { ok: true, reference: target, content, encoding: 'utf8' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  if (!window.PointerEvent) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent })
})

describe('FilePreviewPanel', () => {
  test('loads a preview, shows its verified root, and closes by button or Escape', async () => {
    const target = reference('one')
    const onClose = vi.fn()
    const readPreview = vi.fn().mockResolvedValue(success(target, '# title'))
    render(<FilePreviewPanel reference={target} onClose={onClose} readPreview={readPreview} />)

    expect(screen.getByText('불러오는 중…')).toBeDefined()
    await screen.findByText('title')
    expect(readPreview).toHaveBeenCalledWith({ projectId: 'p1', token: 'one' })
    expect(screen.getByText('/repo')).toBeDefined()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '파일 미리보기 닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('ignores a slower response after the selected reference changes', async () => {
    const first = deferred<FilePreviewReadRes>()
    const second = deferred<FilePreviewReadRes>()
    const targetA = reference('a')
    const targetB = { ...reference('b'), path: 'docs/b.md', displayPath: 'docs/b.md' }
    const readPreview = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const view = render(<FilePreviewPanel reference={targetA} onClose={() => {}} readPreview={readPreview} />)
    view.rerender(<FilePreviewPanel reference={targetB} onClose={() => {}} readPreview={readPreview} />)

    await act(async () => { second.resolve(success(targetB, '# B selected')) })
    expect(await screen.findByText('B selected')).toBeDefined()
    await act(async () => { first.resolve(success(targetA, '# A stale')) })
    expect(screen.queryByText('A stale')).toBeNull()
    expect(screen.getByText('B selected')).toBeDefined()
  })

  test('persists a clamped 280–720px width and supports keyboard resizing', async () => {
    localStorage.setItem(FILE_PREVIEW_WIDTH_KEY, '900')
    const target = reference('width')
    const { container } = render(
      <FilePreviewPanel reference={target} onClose={() => {}} readPreview={async () => success(target, '# width')} />,
    )
    await screen.findByText('width', { selector: 'h1' })
    const panel = screen.getByRole('complementary', { name: '파일 미리보기' })
    expect(panel.getAttribute('style')).toContain('720px')
    const separator = screen.getByRole('separator', { name: '미리보기 너비 조절' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(panel.getAttribute('style')).toContain('704px')
    expect(localStorage.getItem(FILE_PREVIEW_WIDTH_KEY)).toBe('704')

    fireEvent.pointerDown(separator, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 1000 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(panel.getAttribute('style')).toContain('280px'))
    expect(container.querySelector('.file-preview-panel--resizing')).toBeNull()
  })

  test('escapes Markdown raw HTML and routes local links through the resolver callback', async () => {
    const target = reference('markdown')
    const onOpenLocalPath = vi.fn()
    const { container } = render(
      <FilePreviewPanel
        reference={target}
        onClose={() => {}}
        readPreview={async () => success(target, '# Safe\n\n<img src=x onerror="alert(1)">\n\n[child](docs/child.md)')}
        onOpenLocalPath={onOpenLocalPath}
      />,
    )
    await screen.findByText('Safe')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/<img src=x/)).toBeDefined()
    fireEvent.click(screen.getByRole('link', { name: 'child' }))
    expect(onOpenLocalPath).toHaveBeenCalledWith('docs/child.md')
  })

  test('shows read failure without retaining previous content', async () => {
    const target = reference('failure', 'python')
    render(
      <FilePreviewPanel
        reference={target}
        onClose={() => {}}
        readPreview={async () => ({ ok: false, reason: '파일이 변경되었습니다.' })}
      />,
    )
    expect((await screen.findByRole('alert')).textContent).toContain('파일이 변경되었습니다.')
    expect(screen.queryByLabelText('Python source')).toBeNull()
  })
})
