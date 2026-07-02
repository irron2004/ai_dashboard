import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore } from '@apc/pm'
import { buildWorkspaceOverview } from './workspace-overview.js'

describe('buildWorkspaceOverview', () => {
  let db: Db; let registry: ProjectRegistry; let tasks: TaskStore; let runs: AgentRunStore
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    registry = new ProjectRegistry(db); tasks = new TaskStore(db); runs = new AgentRunStore(db)
    registry.register({ id: 'a', name: 'Alpha', status: 'active', projectType: 'git', repoPaths: ['/a'], vaultPaths: [], sourcePaths: [], domain: 'project-docs' })
    registry.register({ id: 'b', name: 'Beta', status: 'active', projectType: 'git', repoPaths: ['/b'], vaultPaths: [], sourcePaths: [], domain: 'paper' })
    // Alpha: 3 active (2 todo + 1 in_progress), 1 review; a-blocked is high but blocked by a-prog
    tasks.create({ id: 'a-todo', projectId: 'a', title: 'a todo', status: 'todo', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
    tasks.create({ id: 'a-prog', projectId: 'a', title: 'a prog', status: 'in_progress', assigneeType: 'agent', priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
    tasks.create({ id: 'a-rev', projectId: 'a', title: 'a review', status: 'review', assigneeType: 'agent', priority: 'low', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
    tasks.create({ id: 'a-blocked', projectId: 'a', title: 'blocked', status: 'todo', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: ['a-prog'] })
    // Beta: 1 active
    tasks.create({ id: 'b-todo', projectId: 'b', title: 'b todo', status: 'todo', assigneeType: 'agent', priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
    // runs: two running on Alpha tasks, one completed on a Beta task
    runs.create({ id: 'R-old', taskId: 'a-todo', agent: 'codex', repoPath: '/a', startedAt: '2026-06-01T10:00:00Z', status: 'running' })
    runs.create({ id: 'R-new', taskId: 'a-prog', agent: 'claude', repoPath: '/a', startedAt: '2026-06-01T12:00:00Z', status: 'running' })
    runs.create({ id: 'R-done', taskId: 'b-todo', agent: 'codex', repoPath: '/b', startedAt: '2026-06-01T11:00:00Z', status: 'completed', endedAt: '2026-06-01T11:30:00Z' })
  })

  test('aggregates counts, running runs (newest first, project-scoped) and nextUp per project', () => {
    const ov = buildWorkspaceOverview({ registry, tasks, runs })
    expect(ov.projects.map((p) => p.project.id)).toEqual(['a', 'b'])   // registry.list() ORDER BY id
    const a = ov.projects.find((p) => p.project.id === 'a')!
    expect(a.activeTaskCount).toBe(3)                                    // a-todo, a-prog, a-blocked
    expect(a.reviewQueueCount).toBe(1)
    expect(a.runningRuns.map((r) => r.id)).toEqual(['R-new', 'R-old'])  // newest first, only Alpha's
    expect(a.nextUp.map((t) => t.id)).toEqual(['a-todo', 'a-prog'])     // unblocked, high→medium; a-blocked excluded
    const b = ov.projects.find((p) => p.project.id === 'b')!
    expect(b.activeTaskCount).toBe(1)
    expect(b.runningRuns).toEqual([])                                    // its only run is completed
  })

  test('generatedAt is an ISO-8601 timestamp', () => {
    expect(buildWorkspaceOverview({ registry, tasks, runs }).generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('nextUp caps at 3 unblocked actionable tasks', () => {
    for (let i = 0; i < 5; i++) {
      tasks.create({ id: `a-x${i}`, projectId: 'a', title: `x${i}`, status: 'todo', assigneeType: 'agent', priority: 'low', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })
    }
    const a = buildWorkspaceOverview({ registry, tasks, runs }).projects.find((p) => p.project.id === 'a')!
    expect(a.nextUp).toHaveLength(3)
  })
})
