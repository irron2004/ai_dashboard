import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DiffPanel } from './DiffPanel.js'

const mocks = vi.hoisted(() => ({
  changesList: vi.fn(),
  changesDiff: vi.fn(),
}))

vi.mock('../api.js', () => ({
  api: {
    changesList: mocks.changesList,
    changesDiff: mocks.changesDiff,
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.changesList.mockResolvedValue({
    ok: true,
    files: [
      { path: 'src/x.ts', status: 'modified', isMarkdown: false, mtimeMs: 2, additions: 12, deletions: 3 },
      { path: 'docs/new.md', status: 'new', isMarkdown: true, mtimeMs: 2, additions: 5, deletions: 0 },
      { path: 'assets/logo.png', status: 'modified', isMarkdown: false, mtimeMs: 2, binary: true },
    ],
  })
  mocks.changesDiff.mockResolvedValue({
    ok: true,
    patch: 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n',
  })
})

describe('DiffPanel', () => {
  test('닫혀 있으면 아무것도 렌더하지 않는다', () => {
    render(<DiffPanel open={false} projectId="p1" onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.changesList).not.toHaveBeenCalled()
  })

  test('열면 파일 목록과 +/− 스탯, 총계를 보여준다', async () => {
    render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await screen.findByText('src/x.ts')
    expect(screen.getByText('+12')).toBeDefined()
    expect(screen.getAllByText('−3').length).toBe(2)
    expect(screen.getByText('binary')).toBeDefined()
    expect(screen.getByText('+17')).toBeDefined()
    expect(screen.getByText('−3', { selector: '.diff-panel__total-del' })).toBeDefined()
  })

  test('파일 클릭 시에만 diff를 가져오고 unified 라인을 펼친다', async () => {
    render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await screen.findByText('src/x.ts')
    expect(mocks.changesDiff).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /src\/x\.ts/ }))
    await screen.findByText('new line')
    expect(mocks.changesDiff).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'src/x.ts' })
    expect(screen.getByText('old line')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /src\/x\.ts/ }))
    expect(screen.queryByText('new line')).toBeNull()
  })

  test('Esc와 닫기 버튼이 onClose를 부른다', async () => {
    const onClose = vi.fn()
    render(<DiffPanel open projectId="p1" onClose={onClose} />)
    await screen.findByText('src/x.ts')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '변경사항 닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('빈 변경분과 조회 실패를 각각 안내한다', async () => {
    mocks.changesList.mockResolvedValueOnce({ ok: true, files: [] })
    const { unmount } = render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await screen.findByText(/working tree clean/)
    unmount()

    mocks.changesList.mockResolvedValueOnce({ ok: false, reason: 'git 실패' })
    render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/git 실패/)).toBeDefined())
  })

  test('projectId가 없으면 프로젝트 선택을 안내한다', () => {
    render(<DiffPanel open projectId={null} onClose={() => {}} />)
    expect(screen.getByText('프로젝트를 선택하세요')).toBeDefined()
    expect(mocks.changesList).not.toHaveBeenCalled()
  })
})
