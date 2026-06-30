import { TaskSchema, type NormalizedSession, type Task, type TaskStatus } from '@apc/shared'

export function mapTodoStatus(s: string): TaskStatus {
  if (s === 'in_progress') return 'in_progress'
  if (s === 'completed') return 'done'
  return 'todo'
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣-]/g, '').replace(/^-+|-+$/g, '').slice(0, 64)
}

type RawTodo = { content?: unknown; status?: unknown }

/** Latest TodoWrite tool call → normalized todo list (empty content dropped). */
export function extractTodos(session: NormalizedSession): { content: string; status: TaskStatus }[] {
  let latest: RawTodo[] | null = null
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      if (call.name !== 'TodoWrite') continue
      const todos = (call.input as { todos?: unknown } | undefined)?.todos
      if (Array.isArray(todos)) latest = todos as RawTodo[]
    }
  }
  if (!latest) return []
  const out: { content: string; status: TaskStatus }[] = []
  for (const t of latest) {
    const content = typeof t.content === 'string' ? t.content.trim() : ''
    if (!content) continue
    out.push({ content, status: mapTodoStatus(typeof t.status === 'string' ? t.status : 'pending') })
  }
  return out
}

function firstUserTitle(session: NormalizedSession): string {
  const u = session.turns.find((t) => t.role === 'user' && t.text.trim())
  return (u?.text.trim() ?? '(no request)').slice(0, 80)
}

export async function extractTasks(
  session: NormalizedSession,
  projectId: string,
  opts: { summarize: (s: NormalizedSession) => Promise<string>; existingTitle?: string },
): Promise<{ request: Task; todos: Task[] }> {
  const sid = session.id
  const agent = session.agentType
  const reqId = `req:${projectId}:${sid}`

  const todoData = extractTodos(session)
  const todos = todoData.map((t) =>
    TaskSchema.parse({
      id: `todo:${projectId}:${sid}:${slug(t.content)}`,
      projectId, title: t.content, status: t.status,
      assigneeType: 'agent', assignee: agent, parentTaskId: reqId, contextPackage: sid,
    }),
  )

  let title = opts.existingTitle
  if (!title) {
    try { title = await opts.summarize(session) } catch { title = firstUserTitle(session) }
  }
  if (!title || !title.trim()) title = firstUserTitle(session)

  const hasOpen = todos.some((t) => t.status === 'todo' || t.status === 'in_progress')
  const request = TaskSchema.parse({
    id: reqId, projectId, title: title.trim(), status: hasOpen ? 'in_progress' : 'done',
    assigneeType: 'agent', assignee: agent, contextPackage: sid,
    linkedWikiPages: session.filesTouched,
  })
  return { request, todos }
}

export type TaskSink = {
  create(t: Task): void
  listByProject(projectId: string): Task[]
  delete(id: string): void
}

/** Upsert the session's request + todos, then delete this session's prior todo-Tasks that vanished. */
export function reconcileSessionTasks(
  store: TaskSink, projectId: string, sessionId: string, request: Task, todos: Task[],
): void {
  store.create(request)
  for (const t of todos) store.create(t)
  const keep = new Set(todos.map((t) => t.id))
  const prefix = `todo:${projectId}:${sessionId}:`
  for (const existing of store.listByProject(projectId)) {
    if (existing.id.startsWith(prefix) && !keep.has(existing.id)) store.delete(existing.id)
  }
}
