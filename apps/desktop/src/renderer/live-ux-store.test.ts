import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentActivity, Project } from '@apc/shared'
import type { ResumeCard, WorkspaceOverview } from '@apc/dashboard-api'
import type { ProjectDashboardRes } from '../shared/ipc-contract.js'

const mocks = vi.hoisted(() => ({
  agentActivitySnapshot: vi.fn(),
  listProjects: vi.fn(),
  workspaceOverview: vi.fn(),
  projectDashboard: vi.fn(),
  resumeCard: vi.fn(),
  updateProject: vi.fn(),
  nextNoteAdd: vi.fn(),
}))

vi.mock('./api.js', () => ({
  api: {
    agentActivitySnapshot: mocks.agentActivitySnapshot,
    listProjects: mocks.listProjects,
    workspaceOverview: mocks.workspaceOverview,
    projectDashboard: mocks.projectDashboard,
    resumeCard: mocks.resumeCard,
    updateProject: mocks.updateProject,
    nextNoteAdd: mocks.nextNoteAdd,
  },
}))

import { mergeAgentActivities, useStore } from './store.js'

function activity(paneId: string, revision: number, lastActivityAt = '2026-07-20T10:00:00Z'): AgentActivity {
  return {
    pane: {
      paneId, projectId: 'p1', worktreePath: '/repo', slotId: paneId.split(':').at(-1) ?? paneId, agent: 'codex',
    },
    launchId: `launch-${revision}`,
    connection: 'connected',
    phase: 'working',
    processAlive: true,
    lastActivityAt,
    revision,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const project: Project = {
  id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs',
  repoPaths: ['/repo'], vaultPaths: [], sourcePaths: [],
}
const refreshedProject: Project = { ...project, name: 'APC refreshed' }
const refreshedDashboard = {
  project: refreshedProject, activeTasks: [], reviewQueue: [], recentRuns: [], allTasks: [],
} satisfies ProjectDashboardRes
const refreshedOverview = {
  generatedAt: '2026-07-20T10:02:00Z', projects: [],
} as unknown as WorkspaceOverview
const refreshedResumeCard = {
  project: refreshedProject, hasHistory: true,
} as unknown as ResumeCard

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listProjects.mockResolvedValue([refreshedProject])
  mocks.workspaceOverview.mockResolvedValue(refreshedOverview)
  mocks.projectDashboard.mockResolvedValue(refreshedDashboard)
  mocks.resumeCard.mockResolvedValue(refreshedResumeCard)
  mocks.updateProject.mockResolvedValue(refreshedProject)
  mocks.nextNoteAdd.mockResolvedValue({ ok: true, note: { id: 'N1', projectId: 'p1', text: 'next' } })
  useStore.setState({
    projects: [project],
    selectedProjectId: 'p1',
    dashboard: null,
    workspaceOverview: null,
    activities: [],
    activitySnapshotAsOf: null,
    activityLoadGeneration: 0,
    resumeCard: null,
    resumeBannerOpen: false,
    projectSurfaceRevision: 0,
    error: null,
  })
})

describe('live UX store ordering', () => {
  test('keeps the exact worktree and slot when targeting a pane', () => {
    const pane = {
      paneId: 'p1:feature:codex-2', projectId: 'p1', worktreePath: '/repo-feature', slotId: 'codex-2', agent: 'codex' as const,
    }

    useStore.getState().focusAgentPane(pane)

    expect(useStore.getState().activeWorktrees.p1).toBe('/repo-feature')
    expect(useStore.getState().paneTarget?.pane).toEqual(pane)
    useStore.getState().clearPaneTarget('another-pane')
    expect(useStore.getState().paneTarget?.pane).toEqual(pane)
    useStore.getState().clearPaneTarget(pane.paneId)
    expect(useStore.getState().paneTarget).toBeNull()
  })

  test('never rolls a pane backward when a lower or equal revision arrives', () => {
    const current = activity('p1:main:codex-1', 5)
    const result = mergeAgentActivities(
      [current],
      [activity('p1:main:codex-1', 4), activity('p1:main:codex-1', 5)],
    )

    expect(result).toEqual([current])
  })

  test('keeps a newer live event when an older snapshot resolves later', async () => {
    useStore.setState({ activities: [activity('p1:main:codex-1', 8)] })
    mocks.agentActivitySnapshot.mockResolvedValue({
      activities: [activity('p1:main:codex-1', 3)],
      asOf: '2026-07-20T10:01:00Z',
    })

    await useStore.getState().loadAgentActivities('p1')

    expect(useStore.getState().activities[0]?.revision).toBe(8)
    expect(useStore.getState().activitySnapshotAsOf).toBe('2026-07-20T10:01:00Z')
  })

  test('drops a resume-card response after the selected project changes', async () => {
    const pending = deferred<ResumeCard | null>()
    mocks.resumeCard.mockReturnValue(pending.promise)
    const existing = { project: { id: 'p2' }, hasHistory: false }
    useStore.setState({ resumeCard: existing as unknown as ResumeCard })

    const request = useStore.getState().loadResumeCard('p1')
    useStore.setState({ selectedProjectId: 'p2' })
    pending.resolve({ project: { id: 'p1' }, hasHistory: true } as unknown as ResumeCard)
    await request

    expect(useStore.getState().resumeCard).toBe(existing)
    expect(useStore.getState().resumeBannerOpen).toBe(false)
  })

  test('applies project list, dashboard, workspace, and resume card as one revision', async () => {
    const projects = deferred<Project[]>()
    const workspace = deferred<WorkspaceOverview>()
    const dashboard = deferred<ProjectDashboardRes>()
    const card = deferred<ResumeCard | null>()
    mocks.listProjects.mockReturnValue(projects.promise)
    mocks.workspaceOverview.mockReturnValue(workspace.promise)
    mocks.projectDashboard.mockReturnValue(dashboard.promise)
    mocks.resumeCard.mockReturnValue(card.promise)

    const refresh = useStore.getState().refreshProjectSurfaces({ includeProjects: true })
    projects.resolve([refreshedProject])
    workspace.resolve(refreshedOverview)
    dashboard.resolve(refreshedDashboard)
    await Promise.resolve()

    expect(useStore.getState()).toMatchObject({
      projects: [project], dashboard: null, workspaceOverview: null, resumeCard: null,
    })

    card.resolve(refreshedResumeCard)
    await refresh
    expect(useStore.getState()).toMatchObject({
      projects: [refreshedProject],
      dashboard: refreshedDashboard,
      workspaceOverview: refreshedOverview,
      resumeCard: refreshedResumeCard,
      projectSurfaceRevision: 1,
    })
  })

  test('does not let a project list read from an older revision overwrite a mutation refresh', async () => {
    const staleProjects = deferred<Project[]>()
    mocks.listProjects
      .mockReturnValueOnce(staleProjects.promise)
      .mockResolvedValueOnce([refreshedProject])

    const staleRead = useStore.getState().loadProjects()
    await useStore.getState().refreshProjectSurfaces({ includeProjects: true })
    expect(useStore.getState().projects).toEqual([refreshedProject])

    staleProjects.resolve([{ ...project, name: 'stale' }])
    await staleRead
    expect(useStore.getState().projects).toEqual([refreshedProject])
  })

  test('does not let older dashboard or resume reads overwrite a mutation refresh', async () => {
    const staleDashboard = deferred<ProjectDashboardRes>()
    const staleCard = deferred<ResumeCard | null>()
    mocks.projectDashboard
      .mockReturnValueOnce(staleDashboard.promise)
      .mockResolvedValueOnce(refreshedDashboard)
    mocks.resumeCard
      .mockReturnValueOnce(staleCard.promise)
      .mockResolvedValueOnce(refreshedResumeCard)

    const dashboardRead = useStore.getState().selectProject('p1')
    const cardRead = useStore.getState().loadResumeCard('p1')
    await useStore.getState().refreshProjectSurfaces()
    expect(useStore.getState()).toMatchObject({
      dashboard: refreshedDashboard, resumeCard: refreshedResumeCard,
    })

    staleDashboard.resolve({ ...refreshedDashboard, project })
    staleCard.resolve({ project, hasHistory: false } as unknown as ResumeCard)
    await Promise.all([dashboardRead, cardRead])
    expect(useStore.getState()).toMatchObject({
      dashboard: refreshedDashboard, resumeCard: refreshedResumeCard,
    })
  })

  test('refreshes all project surfaces after project and note mutations', async () => {
    const updated = await useStore.getState().updateProject(
      'p1', 'APC refreshed', 'git', '/repo', 'project-docs',
    )
    expect(updated).toEqual({ ok: true, project: refreshedProject })
    expect(mocks.listProjects).toHaveBeenCalledTimes(1)
    expect(mocks.workspaceOverview).toHaveBeenCalledTimes(1)
    expect(mocks.projectDashboard).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(mocks.resumeCard).toHaveBeenCalledWith('p1')

    vi.clearAllMocks()
    mocks.nextNoteAdd.mockResolvedValue({ ok: true, note: { id: 'N1', projectId: 'p1', text: 'next' } })
    mocks.workspaceOverview.mockResolvedValue(refreshedOverview)
    mocks.projectDashboard.mockResolvedValue(refreshedDashboard)
    mocks.resumeCard.mockResolvedValue(refreshedResumeCard)
    await useStore.getState().addNextNote('next')

    expect(mocks.workspaceOverview).toHaveBeenCalledTimes(1)
    expect(mocks.projectDashboard).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(mocks.resumeCard).toHaveBeenCalledWith('p1')
  })
})
