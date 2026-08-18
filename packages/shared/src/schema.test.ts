import { describe, expect, test } from 'vitest'
import {
  ProjectSchema, TaskSchema, AgentRunSchema, ReviewSchema, AgentKind,
  NextNoteSchema, NextYmlSchema, nextNoteLifecycle, taskSourceOf,
} from './schema.js'

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

  test('preserves context provenance while accepting legacy projects', () => {
    const legacy = ProjectSchema.parse({
      id: 'legacy', name: 'Legacy', status: 'active', projectType: 'git',
    })
    expect(legacy.goalSource).toBeUndefined()

    const suggested = ProjectSchema.parse({
      id: 'new', name: 'New', status: 'active', projectType: 'git',
      goal: 'Ship the dashboard', goalSource: 'agent',
    })
    expect(suggested.goalSource).toBe('agent')
    expect(suggested.goalConfirmedAt).toBeUndefined()
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

  test('parses provenance and treats legacy tasks as manual', () => {
    const legacy = TaskSchema.parse({ id: 'T1', projectId: 'p1', title: 'legacy', status: 'todo' })
    expect(taskSourceOf(legacy)).toBe('manual')

    const extracted = TaskSchema.parse({
      id: 'T2', projectId: 'p1', title: 'from chat', status: 'todo',
      source: 'conversation', sourceRef: 'session-1', createdAt: '2026-07-20T00:00:00Z',
      updatedAt: '2026-07-20T00:00:00Z',
    })
    expect(taskSourceOf(extracted)).toBe('conversation')
    expect(extracted.sourceRef).toBe('session-1')
  })
})

describe('NextNoteSchema', () => {
  test('derives an exclusive display lifecycle from legacy-compatible fields', () => {
    const active = NextNoteSchema.parse({
      id: 'N1', projectId: 'p1', text: 'remember', createdAt: '2026-07-20T00:00:00Z',
    })
    expect(nextNoteLifecycle(active)).toBe('active')
    expect(nextNoteLifecycle({ ...active, done: true })).toBe('completed')
    expect(nextNoteLifecycle({ ...active, done: true, archivedAt: '2026-07-21T00:00:00Z' })).toBe('archived')
  })
})

describe('NextYmlSchema', () => {
  const valid = {
    project: 'ai_dashboard',
    status: 'active',
    focus: 'Ship file-backed tasks',
    updated: '2026-07-27',
    tasks: [{
      id: 'next-yml-store',
      title: 'Implement the store',
      priority: 'P0',
      status: 'blocked',
      blocked_by: 'contract-test',
      source: 'agent:codex',
    }, {
      id: 'contract-test',
      title: 'Lock the contract',
      priority: 'P1',
      status: 'done',
    }],
  }

  test('parses the root next-actions shape', () => {
    expect(NextYmlSchema.parse(valid).tasks[0]?.blocked_by).toBe('contract-test')
  })

  test.each([
    [{ ...valid, status: 'maintenance' }],
    [{ ...valid, extra: true }],
    [{ ...valid, tasks: [{ ...valid.tasks[0], id: 'UPPER' }] }],
    [{ ...valid, tasks: [{ ...valid.tasks[0], priority: 'high' }] }],
  ])('rejects a value outside the JSON Schema surface', (input) => {
    expect(NextYmlSchema.safeParse(input).success).toBe(false)
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
