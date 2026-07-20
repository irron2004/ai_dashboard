import { AgentActivitySchema, type AgentActivity, type AgentQuestionSummary } from '@apc/shared'
import type { Db } from '@apc/core'
import { normalizeRestoredAgentActivity } from './agent-activity-machine.js'

type Row = {
  pane_id: string
  project_id: string
  worktree_path: string
  slot_id: string
  agent: string
  session_id: string | null
  launch_id: string
  connection: string
  phase: string
  process_alive: number
  last_activity_at: string
  last_input_at: string | null
  last_output_at: string | null
  stale_since: string | null
  current_label: string | null
  last_question_display: string | null
  last_question_asked_at: string | null
  last_question_session_id: string | null
  last_question_exchange_id: string | null
  last_question_privacy: string | null
  last_question_source: string | null
  exit_code: number | null
  reason: string | null
  revision: number
}

function questionFromRow(row: Row): AgentQuestionSummary | undefined {
  if (!row.last_question_display || !row.last_question_asked_at || !row.last_question_privacy || !row.last_question_source) return undefined
  return {
    displayText: row.last_question_display,
    askedAt: row.last_question_asked_at,
    sessionId: row.last_question_session_id ?? undefined,
    exchangeId: row.last_question_exchange_id ?? undefined,
    privacy: row.last_question_privacy as AgentQuestionSummary['privacy'],
    source: row.last_question_source as AgentQuestionSummary['source'],
  }
}

function toActivity(row: Row): AgentActivity {
  return AgentActivitySchema.parse({
    pane: {
      paneId: row.pane_id,
      projectId: row.project_id,
      worktreePath: row.worktree_path,
      slotId: row.slot_id,
      agent: row.agent,
      sessionId: row.session_id ?? undefined,
    },
    launchId: row.launch_id,
    connection: row.connection,
    phase: row.phase,
    processAlive: row.process_alive === 1,
    lastActivityAt: row.last_activity_at,
    lastInputAt: row.last_input_at ?? undefined,
    lastOutputAt: row.last_output_at ?? undefined,
    staleSince: row.stale_since ?? undefined,
    currentLabel: row.current_label ?? undefined,
    lastQuestion: questionFromRow(row),
    exitCode: row.exit_code ?? undefined,
    reason: row.reason ?? undefined,
    revision: row.revision,
  })
}

export class AgentActivityStore {
  constructor(private readonly db: Db, private readonly now: () => string = () => new Date().toISOString()) {}

  get(paneId: string): AgentActivity | undefined {
    const row = this.db.prepare('SELECT * FROM agent_activity WHERE pane_id = ?').get(paneId) as Row | undefined
    return row ? toActivity(row) : undefined
  }

  list(projectId?: string): AgentActivity[] {
    const rows = (projectId
      ? this.db.prepare('SELECT * FROM agent_activity WHERE project_id = ? ORDER BY updated_at DESC, pane_id').all(projectId)
      : this.db.prepare('SELECT * FROM agent_activity ORDER BY updated_at DESC, pane_id').all()) as Row[]
    return rows.map(toActivity)
  }

  /** Atomic revision guard: a delayed snapshot/event can never overwrite newer pane state. */
  put(input: AgentActivity): boolean {
    const activity = AgentActivitySchema.parse(input)
    const question = activity.lastQuestion
    const result = this.db.prepare(
      `INSERT INTO agent_activity (
        pane_id, project_id, worktree_path, slot_id, agent, session_id, launch_id,
        connection, phase, process_alive, last_activity_at, last_input_at, last_output_at,
        stale_since, current_label, last_question_display, last_question_asked_at,
        last_question_session_id, last_question_exchange_id, last_question_privacy,
        last_question_source, exit_code, reason, revision, updated_at
      ) VALUES (
        :paneId, :projectId, :worktreePath, :slotId, :agent, :sessionId, :launchId,
        :connection, :phase, :processAlive, :lastActivityAt, :lastInputAt, :lastOutputAt,
        :staleSince, :currentLabel, :questionDisplay, :questionAskedAt,
        :questionSessionId, :questionExchangeId, :questionPrivacy,
        :questionSource, :exitCode, :reason, :revision, :updatedAt
      ) ON CONFLICT(pane_id) DO UPDATE SET
        project_id = excluded.project_id,
        worktree_path = excluded.worktree_path,
        slot_id = excluded.slot_id,
        agent = excluded.agent,
        session_id = excluded.session_id,
        launch_id = excluded.launch_id,
        connection = excluded.connection,
        phase = excluded.phase,
        process_alive = excluded.process_alive,
        last_activity_at = excluded.last_activity_at,
        last_input_at = excluded.last_input_at,
        last_output_at = excluded.last_output_at,
        stale_since = excluded.stale_since,
        current_label = excluded.current_label,
        last_question_display = excluded.last_question_display,
        last_question_asked_at = excluded.last_question_asked_at,
        last_question_session_id = excluded.last_question_session_id,
        last_question_exchange_id = excluded.last_question_exchange_id,
        last_question_privacy = excluded.last_question_privacy,
        last_question_source = excluded.last_question_source,
        exit_code = excluded.exit_code,
        reason = excluded.reason,
        revision = excluded.revision,
        updated_at = excluded.updated_at
      WHERE excluded.revision > agent_activity.revision`,
    ).run({
      paneId: activity.pane.paneId,
      projectId: activity.pane.projectId,
      worktreePath: activity.pane.worktreePath,
      slotId: activity.pane.slotId,
      agent: activity.pane.agent,
      sessionId: activity.pane.sessionId ?? null,
      launchId: activity.launchId,
      connection: activity.connection,
      phase: activity.phase,
      processAlive: activity.processAlive ? 1 : 0,
      lastActivityAt: activity.lastActivityAt,
      lastInputAt: activity.lastInputAt ?? null,
      lastOutputAt: activity.lastOutputAt ?? null,
      staleSince: activity.staleSince ?? null,
      currentLabel: activity.currentLabel ?? null,
      questionDisplay: question?.displayText ?? null,
      questionAskedAt: question?.askedAt ?? null,
      questionSessionId: question?.sessionId ?? null,
      questionExchangeId: question?.exchangeId ?? null,
      questionPrivacy: question?.privacy ?? null,
      questionSource: question?.source ?? null,
      exitCode: activity.exitCode ?? null,
      reason: activity.reason ?? null,
      revision: activity.revision,
      updatedAt: this.now(),
    })
    return result.changes > 0
  }

  normalizeStartup(): number {
    let changed = 0
    for (const activity of this.list()) {
      const normalized = normalizeRestoredAgentActivity(activity)
      if (normalized !== activity && this.put(normalized)) changed += 1
    }
    return changed
  }
}
