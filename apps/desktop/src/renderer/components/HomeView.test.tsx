import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { HomeView } from './HomeView.js'

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
const gitCommitPush = vi.fn(async () => ({ ok: true, status: { ok: true, detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] } }))
vi.mock('../api.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'fsReadDoc') return (...a: unknown[]) => fsReadDoc(...a as [never])
      if (prop === 'changesList') return (...a: unknown[]) => changesList(...a as [])
      if (prop === 'changesDiff') return (...a: unknown[]) => changesDiff(...a as [])
      if (prop === 'gitStatus') return (...a: unknown[]) => gitStatus(...a as [])
      if (prop === 'gitCommitPush') return (...a: unknown[]) => gitCommitPush(...a as [])
      return vi.fn(async () => ({ ok: true, sources: 0, sessions: 0, documents: 0 }))
    },
  }),
}))

const dashboard: ProjectDashboardRes = {
  project: { id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', projectType: 'git', domain: 'project-docs', repoPaths: ['/r'], vaultPaths: [], sourcePaths: [] },
  activeTasks: [], reviewQueue: [], recentRuns: [],
  allTasks: [{ id: 'T1', projectId: 'p1', title: 't', status: 'done', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] }],
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({ selectedProjectId: 'p1', dashboard, ingesting: false })
  })

  test('loads current.md and the changes feed on mount', async () => {
    render(<HomeView dashboard={dashboard} />)
    expect(await screen.findByText('현재 상태')).toBeDefined()
    expect(await screen.findByText('docs/new.md')).toBeDefined()
    expect(screen.getByText(/미반영/)).toBeDefined()
  })

  test('clicking an unreflected md opens it with an Ingest now header button', async () => {
    render(<HomeView dashboard={dashboard} />)
    fireEvent.click(await screen.findByText('docs/new.md'))
    expect(await screen.findByText('새 문서')).toBeDefined()
    expect(screen.getAllByRole('button', { name: /Ingest now/ }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: /current\.md/ })).toBeDefined()
  })

  test('clicking a code file fetches its diff', async () => {
    render(<HomeView dashboard={dashboard} />)
    const rows = await screen.findAllByText('src/x.ts')
    fireEvent.click(rows[rows.length - 1])
    await waitFor(() => expect(changesDiff).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'src/x.ts' }))
  })

  test('PM strip shows goal and expands details', async () => {
    render(<HomeView dashboard={dashboard} />)
    // let the mount's async loads (fsReadDoc/changesList) settle before asserting, so React state
    // updates are flushed inside act() rather than firing after synchronous assertions
    await screen.findByText('현재 상태')
    expect(screen.getByText(/ship MVP/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /자세히/ }))
    expect(screen.getByText('Task Board')).toBeDefined()
  })

  test('Git sync panel commits only selected files with a message', async () => {
    render(<HomeView dashboard={dashboard} />)
    expect(await screen.findByText('Git 동기화')).toBeDefined()
    fireEvent.click((await screen.findAllByText('src/x.ts'))[0])
    fireEvent.change(screen.getByPlaceholderText(/feat: add git sync panel/), { target: { value: 'test: sync selected file' } })
    fireEvent.click(screen.getByRole('button', { name: /Commit & Push/ }))
    await waitFor(() => expect(gitCommitPush).toHaveBeenCalledWith({ projectId: 'p1', files: ['src/x.ts'], message: 'test: sync selected file' }))
  })
})
