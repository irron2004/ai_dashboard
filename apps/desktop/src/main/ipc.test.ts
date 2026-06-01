import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handlers } from './ipc.js'
import { buildContainer } from './container.js'
import { CH } from '../shared/ipc-contract.js'
import type { ProjectDashboardReq, SubmitReviewReq, ListProfilesReq } from '../shared/ipc-contract.js'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'

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

  test('q:listProfiles reads OpenCode agent profiles from a project path', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'apc-ipc-proj-'))
    try {
      mkdirSync(join(projDir, '.opencode'), { recursive: true })
      writeFileSync(
        join(projDir, '.opencode', 'opencode.jsonc'),
        '{ "agent": { "build": { "model": "openai/gpt-5.5", "mode": "primary" } } }',
      )
      const h = handlers(container)
      const req: ListProfilesReq = { projectPath: projDir }
      const res = (await h[CH.listProfiles](req)) as any[]
      expect(res.find((p) => p.name === 'build')?.model).toBe('openai/gpt-5.5')
    } finally {
      rmSync(projDir, { recursive: true, force: true })
    }
  })

  test('c:ingestAll runs the configured adapters and indexes a resolved session', async () => {
    const session: NormalizedSession = {
      id: 's1', agentType: 'claude', repoPath: '/work/apc',
      turns: [{ role: 'user', text: 'design the control tower', toolCalls: [] }], filesTouched: [],
    }
    const fake: AgentIngestAdapter = {
      agentKind: 'claude',
      async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
        if (cursorFor('claude:s1')) return []
        return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/s1.jsonl', repoPath: '/work/apc' }]
      },
      async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
        return { session, position: JSON.stringify({ sizeBytes: 1, mtimeMs: 1 }) }
      },
    }
    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [fake] })
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const h = handlers(c2)
    const res = (await h[CH.ingestAll](undefined)) as { sources: number; sessions: number }
    expect(res).toEqual({ sources: 1, sessions: 1 })
    expect(c2.searchIndex.search('control tower', { projectId: 'p1' })).toHaveLength(1)
  })
})
