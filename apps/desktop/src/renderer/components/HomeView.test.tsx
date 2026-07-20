import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { HomeView, ProjectDocumentsView } from './HomeView.js'

const fsReadDoc = vi.fn(async ({ relPath }: { relPath: string }) =>
  relPath === 'current.md' ? { ok: true, content: '# 현재 상태' } : { ok: true, content: '# 새 문서' })
const changesList = vi.fn(async () => ({
  ok: true,
  files: [
    { path: 'docs/new.md', status: 'new', isMarkdown: true, mtimeMs: 2, unreflected: true },
    { path: 'src/x.ts', status: 'modified', isMarkdown: false, mtimeMs: 2, unreflected: false },
  ],
}))
const changesDiff = vi.fn(async () => ({ ok: true, patch: 'diff --git a/src/x.ts b/src/x.ts\n+x' }))
const gitStatus = vi.fn(async () => ({
  ok: true,
  repoPath: '/r',
  root: '/r',
  branch: 'main',
  upstream: 'origin/main',
  detached: false,
  ahead: 0,
  behind: 0,
  hasChanges: true,
  files: [{ path: 'src/x.ts', status: 'modified', staged: false, unstaged: true, conflict: false }],
  warnings: [],
}))
const gitCommit = vi.fn(async () => ({ ok: true, committedSha: 'a'.repeat(40), status: { ok: true, detached: false, ahead: 1, behind: 0, hasChanges: false, files: [], warnings: [] } }))
const gitPush = vi.fn(async () => ({ ok: true, status: { ok: true, detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] } }))
const gateStatus = vi.fn(async () => ({
  ok: true, enabled: true, hookInstalled: false, headSha: 'b'.repeat(40), headCovered: false, reviewedCount: 0,
}))
const gateInstall = vi.fn(async () => ({ ok: true }))
vi.mock('../api.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'fsReadDoc') return (...a: unknown[]) => fsReadDoc(...a as [never])
      if (prop === 'changesList') return (...a: unknown[]) => changesList(...a as [])
      if (prop === 'changesDiff') return (...a: unknown[]) => changesDiff(...a as [])
      if (prop === 'gitStatus') return (...a: unknown[]) => gitStatus(...a as [])
      if (prop === 'gitCommit') return (...a: unknown[]) => gitCommit(...a as [])
      if (prop === 'gitPush') return (...a: unknown[]) => gitPush(...a as [])
      if (prop === 'gateStatus') return (...a: unknown[]) => gateStatus(...a as [])
      if (prop === 'gateInstall') return (...a: unknown[]) => gateInstall(...a as [])
      return vi.fn(async () => ({ ok: true, sources: 0, sessions: 0, documents: 0 }))
    },
  }),
}))

const dashboard: ProjectDashboardRes = {
  project: { id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', projectType: 'git', domain: 'project-docs', repoPaths: ['/r'], vaultPaths: [], sourcePaths: [] },
  activeTasks: [], reviewQueue: [], recentRuns: [],
  allTasks: [{ id: 'T1', projectId: 'p1', title: 't', status: 'done', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] }],
}

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState({ selectedProjectId: 'p1', activeWorktrees: {}, dashboard, ingesting: false })
})

describe('HomeView', () => {
  test('shows the PM dashboard immediately without an expand action', () => {
    render(<HomeView dashboard={dashboard} />)
    expect(screen.getByText(/ship MVP/)).toBeDefined()
    expect(screen.getByText('태스크 보드')).toBeDefined()
    expect(screen.getByRole('region', { name: '프로젝트 작업 대시보드' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /자세히/ })).toBeNull()
  })
})

describe('ProjectDocumentsView', () => {
  test('loads current.md and the changes feed on mount', async () => {
    render(<ProjectDocumentsView dashboard={dashboard} />)
    expect(await screen.findByText('현재 상태')).toBeDefined()
    expect(await screen.findByText('docs/new.md')).toBeDefined()
    expect(screen.getByText(/미반영/)).toBeDefined()
  })

  test('clicking an unreflected md opens it with an Ingest now header button', async () => {
    render(<ProjectDocumentsView dashboard={dashboard} />)
    fireEvent.click(await screen.findByText('docs/new.md'))
    expect(await screen.findByText('새 문서')).toBeDefined()
    expect(screen.getAllByRole('button', { name: /Ingest now/ }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: /current\.md/ })).toBeDefined()
  })

  test('clicking a code file fetches its diff', async () => {
    render(<ProjectDocumentsView dashboard={dashboard} />)
    const rows = await screen.findAllByText('src/x.ts')
    fireEvent.click(rows[rows.length - 1])
    await waitFor(() => expect(changesDiff).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'src/x.ts' }))
  })

  test('keeps current.md and Git changes in the dedicated documents view', async () => {
    render(<ProjectDocumentsView dashboard={dashboard} />)
    expect(await screen.findByText('현재 상태')).toBeDefined()
    expect(screen.getByRole('region', { name: '프로젝트 문서와 변경분' })).toBeDefined()
    expect(screen.getByRole('region', { name: '프로젝트 문서' })).toBeDefined()
    expect(screen.getByRole('complementary', { name: 'Git 변경분' })).toBeDefined()
    expect(screen.queryByText('태스크 보드')).toBeNull()
  })

  test('Git sync panel commits selected files without pushing', async () => {
    render(<ProjectDocumentsView dashboard={dashboard} />)
    expect(await screen.findByText('Git 동기화')).toBeDefined()
    fireEvent.click((await screen.findAllByText('src/x.ts'))[0])
    fireEvent.change(screen.getByPlaceholderText(/feat: add git sync panel/), { target: { value: 'test: sync selected file' } })
    fireEvent.click(screen.getByRole('button', { name: /^Commit$/ }))
    await waitFor(() => expect(gitCommit).toHaveBeenCalledWith({ projectId: 'p1', files: ['src/x.ts'], message: 'test: sync selected file', worktreePath: undefined }))
    expect(gitPush).not.toHaveBeenCalled()
  })

  test('Git sync panel explains an uncovered HEAD and installs terminal push protection explicitly', async () => {
    render(<ProjectDocumentsView dashboard={dashboard} />)
    expect(await screen.findByText(/미확인 HEAD/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '터미널 Push도 보호' }))
    await waitFor(() => expect(gateInstall).toHaveBeenCalledWith({ projectId: 'p1', worktreePath: undefined }))
    expect(await screen.findByText(/hook 설치 완료/)).toBeDefined()
  })
})
