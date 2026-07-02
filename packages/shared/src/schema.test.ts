import { describe, expect, test } from 'vitest'
import { ProjectSchema, TaskSchema, AgentRunSchema, ReviewSchema, AgentKind } from './schema.js'

describe('ProjectSchema', () => {
  test('parses a valid hybrid project', () => {
    const p = ProjectSchema.parse({
      id: 'agent-project-console',
      name: 'Agent Project Console',
      status: 'active',
      goal: 'Task lifecycle MVP',
      projectType: 'hybrid',
      repoPaths: ['/mnt/c/work/apc'],
      vaultPaths: ['vault/projects/agent-project-console'],
      sourcePaths: ['~/.claude'],
    })
    expect(p.status).toBe('active')
    expect(p.repoPaths).toHaveLength(1)
  })

  test('rejects an unknown status', () => {
    expect(() =>
      ProjectSchema.parse({
        id: 'x',
        name: 'x',
        status: 'on-fire',
        projectType: 'git',
        repoPaths: [],
        vaultPaths: [],
        sourcePaths: [],
      }),
    ).toThrow()
  })
})

describe('TaskSchema', () => {
  test('parses a task assigned to an agent', () => {
    const t = TaskSchema.parse({
      id: 'TASK-003',
      projectId: 'agent-project-console',
      title: 'terminal wrapper 설계',
      status: 'in_progress',
      assigneeType: 'agent',
      assignee: 'codex',
      reviewStatus: 'pending',
    })
    expect(t.assignee).toBe('codex')
    expect(t.reviewStatus).toBe('pending')
  })
  test('defaults blockedBy to [] and preserves given ids', () => {
    const d = TaskSchema.parse({
      id: 'T1', projectId: 'p1', title: 'x', status: 'todo',
    })
    expect(d.blockedBy).toEqual([])
    const b = TaskSchema.parse({
      id: 'T2', projectId: 'p1', title: 'y', status: 'todo', blockedBy: ['T1'],
    })
    expect(b.blockedBy).toEqual(['T1'])
  })
})

describe('AgentRunSchema', () => {
  test('parses a completed run', () => {
    const r = AgentRunSchema.parse({
      id: 'RUN-20260601-001',
      taskId: 'TASK-003',
      agent: 'codex',
      repoPath: '/mnt/c/work/apc',
      startedAt: '2026-06-01T10:00:00Z',
      status: 'completed',
    })
    expect(AgentKind.options).toContain(r.agent)
  })
})

describe('ReviewSchema', () => {
  test('parses a needs_changes review with next tasks', () => {
    const v = ReviewSchema.parse({
      id: 'REVIEW-001',
      taskId: 'TASK-003',
      agentRunId: 'RUN-20260601-001',
      reviewer: 'hyoseok',
      status: 'needs_changes',
      summary: 'resolver 정책 보완 필요',
      nextTasks: ['TASK-004'],
    })
    expect(v.nextTasks).toEqual(['TASK-004'])
  })
})
