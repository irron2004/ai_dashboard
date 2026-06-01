import { beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handlers } from './ipc.js'
import { buildContainer } from './container.js'
import { CH } from '../shared/ipc-contract.js'
import type { ProjectDashboardReq, SubmitReviewReq } from '../shared/ipc-contract.js'

describe('IPC handlers (no Electron)', () => {
  let vaultDir: string
  let container: ReturnType<typeof buildContainer>

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'apc-ipc-'))
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir })
    // seed a project and a task
    container.registry.register({
      id: 'p1', name: 'APC', status: 'active', projectType: 'git',
      repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [],
    })
    container.tasks.create({
      id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress',
      assigneeType: 'agent', priority: 'high', reviewStatus: 'none',
    })
    container.runs.create({
      id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/work/apc',
      startedAt: '2026-06-01T10:00:00Z', status: 'running',
    })
  })

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('q:projectDashboard returns the dashboard shape', async () => {
    const h = handlers(container)
    const req: ProjectDashboardReq = { projectId: 'p1' }
    const res = await h[CH.projectDashboard](req)
    expect((res as any).project.id).toBe('p1')
    expect((res as any).activeTasks).toHaveLength(1)
    expect((res as any).activeTasks[0].id).toBe('T1')
    expect((res as any).recentRuns).toHaveLength(1)
    expect((res as any).recentRuns[0].id).toBe('R1')
  })

  test('c:submitReview transitions the task to done', async () => {
    const h = handlers(container)
    // First complete the run so review is valid context
    container.runs.complete('R1', { endedAt: '2026-06-01T11:00:00Z' })

    const req: SubmitReviewReq = {
      review: {
        id: 'rev1', taskId: 'T1', agentRunId: 'R1', reviewer: 'human',
        status: 'approved', summary: 'looks good', nextTasks: [],
      },
    }
    await h[CH.submitReview](req)
    const task = container.tasks.get('T1')
    expect(task?.status).toBe('done')
    expect(task?.reviewStatus).toBe('approved')
  })

  test('q:listProjects returns all registered projects', async () => {
    const h = handlers(container)
    const res = await h[CH.listProjects](undefined)
    expect(Array.isArray(res)).toBe(true)
    expect((res as any[]).find((p: any) => p.id === 'p1')).toBeDefined()
  })
})
