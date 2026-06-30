import { AgentRunSchema, type AgentRun } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  id: string; task_id: string; agent: string; repo_path: string; branch: string | null
  worktree_path: string | null; started_at: string; ended_at: string | null
  status: string; transcript_path: string | null; summary_path: string | null
}
function toRun(r: Row): AgentRun {
  return AgentRunSchema.parse({
    id: r.id, taskId: r.task_id, agent: r.agent, repoPath: r.repo_path,
    branch: r.branch ?? undefined, worktreePath: r.worktree_path ?? undefined,
    startedAt: r.started_at, endedAt: r.ended_at ?? undefined, status: r.status,
    transcriptPath: r.transcript_path ?? undefined, summaryPath: r.summary_path ?? undefined,
  })
}

export class AgentRunStore {
  constructor(private readonly db: Db) {}

  create(input: AgentRun): void {
    const r = AgentRunSchema.parse(input)
    this.db.prepare(
      `INSERT OR REPLACE INTO agent_runs
       (id, task_id, agent, repo_path, branch, worktree_path, started_at, ended_at, status, transcript_path, summary_path)
       VALUES (:id, :taskId, :agent, :repoPath, :branch, :worktreePath, :startedAt, :endedAt, :status, :transcriptPath, :summaryPath)`,
    ).run({
      id: r.id, taskId: r.taskId, agent: r.agent, repoPath: r.repoPath, branch: r.branch ?? null,
      worktreePath: r.worktreePath ?? null, startedAt: r.startedAt, endedAt: r.endedAt ?? null,
      status: r.status, transcriptPath: r.transcriptPath ?? null, summaryPath: r.summaryPath ?? null,
    })
  }

  get(id: string): AgentRun | undefined {
    const r = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as Row | undefined
    return r ? toRun(r) : undefined
  }

  complete(id: string, patch: { endedAt: string; summaryPath?: string }): void {
    this.db.prepare('UPDATE agent_runs SET status = ?, ended_at = ?, summary_path = ? WHERE id = ?')
      .run('completed', patch.endedAt, patch.summaryPath ?? null, id)
  }

  /** Mark a run failed (non-zero exit, spawn error, timeout, or cancel). Mirrors complete(). */
  fail(id: string, patch: { endedAt: string }): void {
    this.db.prepare('UPDATE agent_runs SET status = ?, ended_at = ? WHERE id = ?')
      .run('failed', patch.endedAt, id)
  }

  listByTask(taskId: string): AgentRun[] {
    const rows = this.db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId) as Row[]
    return rows.map(toRun)
  }
}
