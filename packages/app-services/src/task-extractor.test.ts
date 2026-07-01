import { describe, it, expect, vi } from 'vitest'
import type { NormalizedSession, Task } from '@apc/shared'
import { mapTodoStatus, slug, extractTodos, extractTasks, reconcileSessionTasks } from './task-extractor.js'

function session(partial: Partial<NormalizedSession> = {}): NormalizedSession {
  return { id: 's1', agentType: 'claude', turns: [], filesTouched: [], sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, ...partial } as NormalizedSession
}
const todoCall = (todos: { content: string; status: string }[]) => ({ name: 'TodoWrite', input: { todos } })

describe('mapTodoStatus', () => {
  it('maps the three todo states', () => {
    expect(mapTodoStatus('pending')).toBe('todo')
    expect(mapTodoStatus('in_progress')).toBe('in_progress')
    expect(mapTodoStatus('completed')).toBe('done')
  })
})

describe('extractTodos', () => {
  it('uses the LAST TodoWrite call and maps status, skips empty content', () => {
    const s = session({ turns: [
      { role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'old', status: 'pending' }])] },
      { role: 'assistant', text: '', toolCalls: [todoCall([
        { content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }, { content: '', status: 'pending' },
      ])] },
    ] as NormalizedSession['turns'] })
    expect(extractTodos(s)).toEqual([
      { content: 'A', status: 'done' }, { content: 'B', status: 'in_progress' },
    ])
  })
  it('returns [] when no TodoWrite', () => {
    expect(extractTodos(session({ turns: [{ role: 'user', text: 'hi', toolCalls: [] }] as NormalizedSession['turns'] }))).toEqual([])
  })
})

describe('extractTasks', () => {
  const summarize = vi.fn(async () => 'LLM Title')
  it('builds request-task (id/title/assignee) and parented todo-tasks', async () => {
    const s = session({ turns: [
      { role: 'user', text: 'do the thing', toolCalls: [] },
      { role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'A', status: 'pending' }])] },
    ] as NormalizedSession['turns'] })
    const { request, todos } = await extractTasks(s, 'p1', { summarize })
    expect(request.id).toBe('req:p1:s1')
    expect(request.title).toBe('LLM Title')
    expect(request.assignee).toBe('claude')
    expect(request.contextPackage).toBe('s1')
    expect(todos[0].id).toBe('todo:p1:s1:a')
    expect(todos[0].parentTaskId).toBe('req:p1:s1')
    expect(todos[0].status).toBe('todo')
  })
  it('derives request status: in_progress if any open todo, else done', async () => {
    const open = session({ turns: [{ role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'A', status: 'pending' }])] }] as NormalizedSession['turns'] })
    const closed = session({ turns: [{ role: 'assistant', text: '', toolCalls: [todoCall([{ content: 'A', status: 'completed' }])] }] as NormalizedSession['turns'] })
    expect((await extractTasks(open, 'p1', { summarize })).request.status).toBe('in_progress')
    expect((await extractTasks(closed, 'p1', { summarize })).request.status).toBe('done')
    expect((await extractTasks(session(), 'p1', { summarize })).request.status).toBe('done')
  })
  it('falls back to first user turn (80-cap) when summarize throws', async () => {
    const boom = vi.fn(async () => { throw new Error('llm down') })
    const s = session({ turns: [{ role: 'user', text: 'first request line', toolCalls: [] }] as NormalizedSession['turns'] })
    expect((await extractTasks(s, 'p1', { summarize: boom })).request.title).toBe('first request line')
  })
  it('skips summarize when existingTitle is provided', async () => {
    const spy = vi.fn(async () => 'NEW')
    const r = await extractTasks(session(), 'p1', { summarize: spy, existingTitle: 'KEEP' })
    expect(spy).not.toHaveBeenCalled()
    expect(r.request.title).toBe('KEEP')
  })
  it('sets request linkedWikiPages to session.filesTouched', async () => {
    const s = session({ filesTouched: ['/abs/proj/vault/a.md', '/abs/proj/src/x.py'],
      turns: [{ role: 'user', text: 'do', toolCalls: [] }] as NormalizedSession['turns'] })
    const { request } = await extractTasks(s, 'p1', { summarize })
    expect(request.linkedWikiPages).toEqual(['/abs/proj/vault/a.md', '/abs/proj/src/x.py'])
  })
  it('drops near-duplicate todos that collapse to the same slug id (keeps first)', async () => {
    const s = session({ turns: [{ role: 'assistant', text: '', toolCalls: [todoCall([
      { content: 'Fix the bug', status: 'pending' },
      { content: 'Fix the bug!', status: 'completed' },
    ])] }] as NormalizedSession['turns'] })
    const { todos } = await extractTasks(s, 'p1', { summarize })
    expect(todos).toHaveLength(1)
    expect(todos[0].id).toBe('todo:p1:s1:fix-the-bug')
    expect(todos[0].status).toBe('todo') // first occurrence wins
  })
})

describe('reconcileSessionTasks', () => {
  function fakeStore() {
    const map = new Map<string, Task>()
    return {
      map,
      create: (t: Task) => { map.set(t.id, t) },
      listByProject: (pid: string) => [...map.values()].filter((t) => t.projectId === pid),
      delete: (id: string) => { map.delete(id) },
    }
  }
  const mk = (id: string, extra: Partial<Task> = {}): Task => ({ id, projectId: 'p1', title: id, status: 'todo', assigneeType: 'agent', priority: 'medium', acceptanceCriteria: [], linkedWikiPages: [], reviewStatus: 'none', ...extra })

  it('upserts request + todos and deletes stale todos of the same session', () => {
    const store = fakeStore()
    // pre-existing: 3 todos for session s1
    store.create(mk('todo:p1:s1:a')); store.create(mk('todo:p1:s1:b')); store.create(mk('todo:p1:s1:c'))
    store.create(mk('todo:p1:s2:z')) // other session — must survive
    const request = mk('req:p1:s1', { parentTaskId: undefined })
    const todos = [mk('todo:p1:s1:a'), mk('todo:p1:s1:b')] // c dropped
    reconcileSessionTasks(store, 'p1', 's1', request, todos)
    const ids = store.listByProject('p1').map((t) => t.id).sort()
    expect(ids).toEqual(['req:p1:s1', 'todo:p1:s1:a', 'todo:p1:s1:b', 'todo:p1:s2:z'])
  })
})
