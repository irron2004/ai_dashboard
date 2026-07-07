import type { AgentType, NextNote, Project, Task } from '@apc/shared'
import type { ProjectRegistry } from '@apc/core'
import type { TaskStore, NextNoteStore } from '@apc/pm'

export type ResumeLatestSession = (
  repoPath: string,
) => Promise<{ agent: AgentType; sessionId: string; lastUserTurn?: { text: string; ts: string } } | null>

export type ResumeDeps = {
  registry: Pick<ProjectRegistry, 'get'>
  tasks: Pick<TaskStore, 'listByProject'>
  nextNotes: Pick<NextNoteStore, 'listByProject'>
  latestSession: ResumeLatestSession
}

export type ResumeCard = {
  project: Project
  lastSummary: string | null
  lastQuestion: { text: string; ts: string; agent: AgentType } | null
  nextNotes: NextNote[]
  resumeTarget: { agent: AgentType; sessionId: string } | null
  hasHistory: boolean
}

/** Most recent `req:` task title for the project = the "지난번 요약" (SP1 already summarized it — no
 *  re-LLM on switch). `req:` ids sort lexicographically by their sessionId suffix; we take the last. */
function lastRequestSummary(tasks: Task[]): string | null {
  const reqs = tasks.filter((t) => t.id.startsWith('req:')).sort((a, b) => a.id.localeCompare(b.id))
  return reqs.length ? reqs[reqs.length - 1].title : null
}

export async function buildResumeCard(deps: ResumeDeps, projectId: string): Promise<ResumeCard | null> {
  const project = deps.registry.get(projectId)
  if (!project) return null
  const tasks = deps.tasks.listByProject(projectId)
  const nextNotes = deps.nextNotes.listByProject(projectId)
  const repoPath = project.repoPaths[0]
  const latest = repoPath ? await deps.latestSession(repoPath).catch(() => null) : null
  const lastSummary = lastRequestSummary(tasks)
  const lastQuestion = latest?.lastUserTurn
    ? { text: latest.lastUserTurn.text, ts: latest.lastUserTurn.ts, agent: latest.agent }
    : null
  const resumeTarget = latest ? { agent: latest.agent, sessionId: latest.sessionId } : null
  const hasHistory = Boolean(lastSummary || lastQuestion || nextNotes.length || resumeTarget)
  return { project, lastSummary, lastQuestion, nextNotes, resumeTarget, hasHistory }
}
