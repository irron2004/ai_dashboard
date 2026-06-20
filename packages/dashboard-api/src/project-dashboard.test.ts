import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore } from '@apc/pm'
import { getProjectDashboard } from './project-dashboard.js'

describe('getProjectDashboard', () => {
  let db: Db; let registry: ProjectRegistry; let tasks: TaskStore; let runs: AgentRunStore
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    registry = new ProjectRegistry(db); tasks = new TaskStore(db); runs = new AgentRunStore(db)
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/p1'], vaultPaths: [], sourcePaths: [], domain: 'project-docs' })
    tasks.create({ id: 'T1', projectId: 'p1', title: 'active', status: 'in_progress', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [] })
    tasks.create({ id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [] })
    tasks.create({ id: 'T3', projectId: 'p1', title: 'done', status: 'done', assigneeType: 'agent', priority: 'low', reviewStatus: 'approved', acceptanceCriteria: [], linkedWikiPages: [] })
    runs.create({ id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' })
  })

  test('aggregates project, active tasks, review queue, recent runs', () => {
    const dash = getProjectDashboard({ registry, tasks, runs }, 'p1')
    expect(dash.project.name).toBe('P1')
    expect(dash.activeTasks.map((t) => t.id)).toEqual(['T1'])
    expect(dash.reviewQueue.map((t) => t.id)).toEqual(['T2'])
    expect(dash.recentRuns.map((r) => r.id)).toEqual(['R1'])
  })

  test('throws for an unknown project', () => {
    expect(() => getProjectDashboard({ registry, tasks, runs }, 'nope')).toThrow(/not found/i)
  })

  test('allTasks includes every task regardless of status', () => {
    const dash = getProjectDashboard({ registry, tasks, runs }, 'p1')
    expect(dash.allTasks.map((t) => t.id).sort()).toEqual(['T1', 'T2', 'T3'])
  })
})
