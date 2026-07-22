import { ProjectSchema, type Project } from '@apc/shared'
import type { Db } from './db.js'

type Row = {
  id: string
  name: string
  status: string
  goal: string | null
  current_focus: string | null
  goal_source: string | null
  goal_confirmed_at: string | null
  current_focus_source: string | null
  current_focus_confirmed_at: string | null
  start_date: string | null
  target_date: string | null
  project_type: string
  domain: string
  repo_paths: string
  vault_paths: string
  source_paths: string
}

function rowToProject(row: Row): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    goal: row.goal ?? undefined,
    currentFocus: row.current_focus ?? undefined,
    goalSource: row.goal_source ?? undefined,
    goalConfirmedAt: row.goal_confirmed_at ?? undefined,
    currentFocusSource: row.current_focus_source ?? undefined,
    currentFocusConfirmedAt: row.current_focus_confirmed_at ?? undefined,
    startDate: row.start_date ?? undefined,
    targetDate: row.target_date ?? undefined,
    projectType: row.project_type,
    domain: row.domain,
    repoPaths: JSON.parse(row.repo_paths),
    vaultPaths: JSON.parse(row.vault_paths),
    sourcePaths: JSON.parse(row.source_paths),
  })
}

export class ProjectRegistry {
  constructor(private readonly db: Db, private readonly now: () => string = () => new Date().toISOString()) {}

  register(input: Project): void {
    const parsed = ProjectSchema.parse(input)
    const needsGoalConfirmation = Boolean(
      parsed.goal && !parsed.goalConfirmedAt && parsed.goalSource !== 'agent',
    )
    const needsFocusConfirmation = Boolean(
      parsed.currentFocus && !parsed.currentFocusConfirmedAt && parsed.currentFocusSource !== 'agent',
    )
    const confirmationTime = needsGoalConfirmation || needsFocusConfirmation ? this.now() : undefined
    const p = ProjectSchema.parse({
      ...parsed,
      goalSource: parsed.goal ? (parsed.goalSource ?? 'user') : undefined,
      goalConfirmedAt: parsed.goal
        ? (parsed.goalConfirmedAt ?? (parsed.goalSource === 'agent' ? undefined : confirmationTime))
        : undefined,
      currentFocusSource: parsed.currentFocus ? (parsed.currentFocusSource ?? 'user') : undefined,
      currentFocusConfirmedAt: parsed.currentFocus
        ? (parsed.currentFocusConfirmedAt ?? (parsed.currentFocusSource === 'agent' ? undefined : confirmationTime))
        : undefined,
    })
    this.db
      .prepare(
        `INSERT INTO projects
         (id, name, status, goal, current_focus, goal_source, goal_confirmed_at,
          current_focus_source, current_focus_confirmed_at, start_date, target_date,
          project_type, domain, repo_paths, vault_paths, source_paths)
         VALUES (:id, :name, :status, :goal, :currentFocus, :goalSource, :goalConfirmedAt,
                 :currentFocusSource, :currentFocusConfirmedAt, :startDate, :targetDate,
                 :projectType, :domain, :repoPaths, :vaultPaths, :sourcePaths)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           status = excluded.status,
           goal = excluded.goal,
           current_focus = excluded.current_focus,
           goal_source = excluded.goal_source,
           goal_confirmed_at = excluded.goal_confirmed_at,
           current_focus_source = excluded.current_focus_source,
           current_focus_confirmed_at = excluded.current_focus_confirmed_at,
           start_date = excluded.start_date,
           target_date = excluded.target_date,
           project_type = excluded.project_type,
           domain = excluded.domain,
           repo_paths = excluded.repo_paths,
           vault_paths = excluded.vault_paths,
           source_paths = excluded.source_paths`,
      )
      .run({
        id: p.id,
        name: p.name,
        status: p.status,
        goal: p.goal ?? null,
        currentFocus: p.currentFocus ?? null,
        goalSource: p.goalSource ?? null,
        goalConfirmedAt: p.goalConfirmedAt ?? null,
        currentFocusSource: p.currentFocusSource ?? null,
        currentFocusConfirmedAt: p.currentFocusConfirmedAt ?? null,
        startDate: p.startDate ?? null,
        targetDate: p.targetDate ?? null,
        projectType: p.projectType,
        domain: p.domain,
        repoPaths: JSON.stringify(p.repoPaths),
        vaultPaths: JSON.stringify(p.vaultPaths),
        sourcePaths: JSON.stringify(p.sourcePaths),
      })
  }

  get(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
    return row ? rowToProject(row) : undefined
  }

  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY id').all() as Row[]
    return rows.map(rowToProject)
  }

  /** Update an existing project in place (same id). Equivalent to register for a known id. */
  update(input: Project): void {
    this.register(input)
  }

  /** Apply a human-authored context patch. Supplying an empty string clears that field. */
  updateUserContext(
    id: string,
    patch: { goal?: string | null; currentFocus?: string | null },
  ): Project | undefined {
    const current = this.get(id)
    if (!current) return undefined
    const now = this.now()
    const hasGoal = Object.prototype.hasOwnProperty.call(patch, 'goal')
    const hasFocus = Object.prototype.hasOwnProperty.call(patch, 'currentFocus')
    const goal = hasGoal ? (patch.goal?.trim() || undefined) : current.goal
    const currentFocus = hasFocus ? (patch.currentFocus?.trim() || undefined) : current.currentFocus
    const updated: Project = {
      ...current,
      goal,
      currentFocus,
      goalSource: hasGoal ? (goal ? 'user' : undefined) : current.goalSource,
      goalConfirmedAt: hasGoal ? (goal ? now : undefined) : current.goalConfirmedAt,
      currentFocusSource: hasFocus ? (currentFocus ? 'user' : undefined) : current.currentFocusSource,
      currentFocusConfirmedAt: hasFocus ? (currentFocus ? now : undefined) : current.currentFocusConfirmedAt,
    }
    this.update(updated)
    return this.get(id)
  }

  /** Record an agent proposal only while the field has no user-confirmed value. */
  proposeContext(
    id: string,
    field: 'goal' | 'currentFocus',
    value: string,
  ): { ok: true; project: Project } | { ok: false; reason: 'project-not-found' | 'confirmed-value-exists' | 'empty-value' } {
    const current = this.get(id)
    if (!current) return { ok: false, reason: 'project-not-found' }
    const proposal = value.trim()
    if (!proposal) return { ok: false, reason: 'empty-value' }
    const confirmedAt = field === 'goal' ? current.goalConfirmedAt : current.currentFocusConfirmedAt
    if (confirmedAt) return { ok: false, reason: 'confirmed-value-exists' }

    const updated: Project = field === 'goal'
      ? { ...current, goal: proposal, goalSource: 'agent', goalConfirmedAt: undefined }
      : { ...current, currentFocus: proposal, currentFocusSource: 'agent', currentFocusConfirmedAt: undefined }
    this.update(updated)
    return { ok: true, project: this.get(id)! }
  }

  confirmContext(
    id: string,
    field: 'goal' | 'currentFocus',
  ): { ok: true; project: Project } | { ok: false; reason: 'project-not-found' | 'empty-value' } {
    const current = this.get(id)
    if (!current) return { ok: false, reason: 'project-not-found' }
    const value = field === 'goal' ? current.goal : current.currentFocus
    if (!value?.trim()) return { ok: false, reason: 'empty-value' }
    const confirmedAt = this.now()
    const updated: Project = field === 'goal'
      ? { ...current, goalConfirmedAt: confirmedAt }
      : { ...current, currentFocusConfirmedAt: confirmedAt }
    this.update(updated)
    return { ok: true, project: this.get(id)! }
  }

  /** Delete a project; its project_source_map rows cascade (FK ON DELETE CASCADE). */
  remove(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  findByRepoPath(repoPath: string): Project | undefined {
    // canonical project key = a repo path in repo_paths (spec §7)
    const rows = this.db.prepare('SELECT * FROM projects').all() as Row[]
    const match = rows.find((r) => (JSON.parse(r.repo_paths) as string[]).includes(repoPath))
    return match ? rowToProject(match) : undefined
  }

  mapNativeKey(agentKind: string, nativeKey: string, projectId: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_source_map (agent_kind, native_key, project_id)
         VALUES (?, ?, ?)`,
      )
      .run(agentKind, nativeKey, projectId)
  }

  resolveProjectId(agentKind: string, nativeKey: string): string | undefined {
    const row = this.db
      .prepare('SELECT project_id FROM project_source_map WHERE agent_kind = ? AND native_key = ?')
      .get(agentKind, nativeKey) as { project_id: string } | undefined
    return row?.project_id
  }
}
