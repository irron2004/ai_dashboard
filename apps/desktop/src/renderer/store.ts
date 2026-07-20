import { create } from 'zustand'
import type { AgentActivity, AgentPaneIdentity, Project, AgentProfile, AgentType } from '@apc/shared'
import {
  WIKI_GENERATION_ENGINE,
  type GeneratePreflightCategoryId, type GeneratePreflightRes, type ProjectDashboardRes,
  type GenerateProjectRes, type HarnessCanonicalProposalsRes, type WikiPolicyRecordDto,
  type HarnessLiveNode, type HarnessNodesEvent, type ProjectStructureHintDto,
  type ProjectContextConfirmReq, type ProjectContextInput, type ProjectContextMutRes,
  type WorkspaceRestore,
} from '../shared/ipc-contract.js'
import type { WorkspaceOverview, ResumeCard } from '@apc/dashboard-api'
import { api } from './api.js'
import {
  appendTailLines,
  createDefaultHarnessConfig,
  loadHarnessConfig,
  loadHarnessRuns,
  loadHarnessSelectedRun,
  saveHarnessConfig,
  saveHarnessRuns,
  saveHarnessSelectedRun,
  modelSettingsToEngineOptions,
  type HarnessAgentPromptKey,
  type HarnessConfig,
  type HarnessFeatureGateKey,
  type HarnessRunBundle,
} from './harness-utils.js'

export type AgentRunStatus = 'idle' | 'running' | 'attention' | 'done'

type ApcStore = {
  projects: Project[]
  selectedProjectId: string | null
  /** Agent dock selection, shared by terminal, Git, diff and Learning Gate surfaces. */
  activeWorktrees: Record<string, string | null>
  setActiveWorktree(projectId: string, worktreePath: string | null): void
  paneTarget: { pane: AgentPaneIdentity; nonce: number } | null
  focusAgentPane(pane: AgentPaneIdentity): void
  clearPaneTarget(paneId?: string): void
  activities: AgentActivity[]
  activitySnapshotAsOf: string | null
  activityLoadGeneration: number
  mergeAgentActivity(activity: AgentActivity): void
  loadAgentActivities(projectId?: string): Promise<void>
  dashboard: ProjectDashboardRes | null
  workspaceOverview: WorkspaceOverview | null
  resumeCard: ResumeCard | null
  resumeBannerOpen: boolean
  loadResumeCard: (projectId: string) => Promise<void>
  openResumeBanner: () => void
  dismissResumeBanner: () => void
  addNextNote: (text: string) => Promise<void>
  profiles: AgentProfile[]
  ingesting: boolean
  lastIngest: { sources: number; sessions: number; documents: number } | null
  error: string | null
  /** Agent run status keyed by `${projectId}:${agent}` so each project's agents are tracked independently
   *  (their terminals stay mounted across project switches). Missing key → treat as 'idle'. */
  agentStatus: Record<string, AgentRunStatus>
  /** Open panes keyed by `${projectId}:${agent}`. Populated on boot via hydrateWorkspace (workspace restore). */
  openPanes: Record<string, { agent: AgentType; sessionId: string | null }>
  preflighting: boolean
  generatePreflight: GeneratePreflightRes | null
  generating: boolean
  generation: GenerateProjectRes | null

  harnessRuns: HarnessRunBundle[]
  selectedHarnessRunId: string | null
  harnessLoading: boolean
  harnessMessage: string | null
  harnessProgress: string | null
  harnessConfigs: Record<string, HarnessConfig>
  /** canonical proposals for the selected run; each currentHash captured when this list was fetched
   * (= the "last read" the hash-gate compares against when the user later clicks promote). */
  harnessCanonicalProposals: HarnessCanonicalProposalsRes
  harnessLiveLabel: string | null
  harnessLiveTail: string[]
  /** Nodes discovered DURING the active run (folder worker → IPC stream), shown incrementally in the
   * Knowledge graph. Keyed to one runId; reset when a new run starts. De-duped by node id. */
  harnessLiveNodes: HarnessLiveNode[]
  harnessLiveNodesRunId: string | null
  /** Set when promote was blocked by a validation gate that `allowInvalid` can override; null otherwise.
   * Drives the "검증 무시하고 promote" force-override affordance in the UI. */
  harnessPromoteBlockedReason: string | null
  /** Same, but for a CANONICAL proposal promote — tracks which proposal was blocked so the per-doc
   * force button can retry exactly that one with allowInvalid. */
  harnessCanonicalBlock: { proposalRelPath: string; lastReadHash: string; reason: string } | null

  wikiPolicy: WikiPolicyRecordDto | null
  wikiPolicyPreview: string | null
  wikiPolicyBusy: boolean
  wikiPolicyMessage: string | null
  proposeWikiPolicy(projectId: string): Promise<void>
  approveWikiPolicy(projectId: string): Promise<void>
  loadWikiPolicy(projectId: string): Promise<void>
  revertWikiPolicy(projectId: string): Promise<void>

  hydrateWorkspace(p: WorkspaceRestore): void
  setAgentStatus(key: string, status: AgentRunStatus): void
  /** Per-session restart token keyed by `${projectId}:${agent}`. Bumping it re-spawns that agent's terminal. */
  restartNonce: Record<string, number>
  /** Keys whose latest exit was a user-initiated ⏹ stop; the resulting onPtyExit 'done' is coerced to 'idle'. */
  stoppingKeys: Record<string, boolean>
  restartAgent(key: string): void
  /** Resumes `key`'s pane at a specific session (from a resume-card target) and bumps restartNonce in the
   *  SAME set() so AgentTerminal's respawn effect (deps: restartNonce) picks up the new resumeSessionId. */
  resumeAgentSession(key: string, sessionId: string, agent?: AgentType): void
  stopAgent(key: string): void
  prepareGenerate(): Promise<void>
  generate(selectedPreflightCategoryIds?: GeneratePreflightCategoryId[]): Promise<void>
  clearGeneratePreflight(): void
  clearGeneration(): void
  loadProjects(): Promise<void>
  addProject(name: string, projectType: string, repoPath: string, domain: string, context?: ProjectContextInput): Promise<void>
  updateProject(id: string, name: string, projectType: string, repoPath: string, domain: string, context?: ProjectContextInput): Promise<void>
  confirmProjectContext(req: ProjectContextConfirmReq): Promise<ProjectContextMutRes>
  deleteProject(id: string): Promise<void>
  selectProject(projectId: string): Promise<void>
  loadWorkspaceOverview(): Promise<void>
  loadProfiles(projectPath: string): Promise<void>
  ingest(): Promise<void>
  clearError(): void

  hydrateHarnessProject(projectId: string): void
  selectHarnessRun(runId: string): void
  startHarnessRun(materialize?: boolean, fullRegen?: boolean, interactive?: boolean, projectContext?: ProjectStructureHintDto): Promise<void>
  refreshHarnessRun(runId?: string): Promise<void>
  resumeHarnessRun(runId?: string): Promise<void>
  confirmNodes(runId: string, approvedNodes: { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> }): Promise<void>
  promoteHarnessRun(runId?: string, allowInvalid?: boolean): Promise<void>
  exportWiki(projectId?: string): Promise<void>
  loadCanonicalProposals(runId?: string): Promise<void>
  promoteCanonicalDoc(proposalRelPath: string, lastReadHash: string, allowInvalid?: boolean): Promise<void>
  updateHarnessModel(patch: Partial<HarnessConfig['model']>): void
  updateHarnessSafety(patch: Partial<HarnessConfig['safety']>): void
  toggleHarnessGate(key: HarnessFeatureGateKey): void
  updateHarnessPrompt(key: HarnessAgentPromptKey, value: string): void
  clearHarnessMessage(): void
  setHarnessProgress(state: string | null): void
  appendHarnessEngineLog(e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }): void
  addHarnessLiveNodes(e: HarnessNodesEvent): void
  attachProfileToActiveTask(profileId: string): Promise<void>
}

function persistProjectRuns(projectId: string, runs: HarnessRunBundle[], selectedRunId: string | null): void {
  saveHarnessRuns(projectId, runs)
  saveHarnessSelectedRun(projectId, selectedRunId)
}

function upsertRun(runs: HarnessRunBundle[], bundle: HarnessRunBundle): HarnessRunBundle[] {
  const prev = runs.find((item) => item.runState.runId === bundle.runState.runId)
  // Preserve mode from the existing entry: refreshHarnessRun builds bundles without mode.
  const merged = { ...bundle, mode: bundle.mode ?? prev?.mode }
  const next = [merged, ...runs.filter((item) => item.runState.runId !== bundle.runState.runId)]
  return next.sort((a, b) => {
    const aAt = a.runState.history.at(-1)?.at ?? a.runState.history[0]?.at ?? ''
    const bAt = b.runState.history.at(-1)?.at ?? b.runState.history[0]?.at ?? ''
    return bAt.localeCompare(aAt)
  })
}

function getHarnessConfig(state: ApcStore, projectId: string): HarnessConfig {
  return state.harnessConfigs[projectId] ?? loadHarnessConfig(projectId) ?? createDefaultHarnessConfig()
}

function updateHarnessConfig(state: ApcStore, projectId: string, next: HarnessConfig): Partial<ApcStore> {
  return { harnessConfigs: { ...state.harnessConfigs, [projectId]: next } }
}

/** Revision is pane-local. Snapshot/event arrival order must never roll a pane backwards. */
export function mergeAgentActivities(
  current: readonly AgentActivity[],
  incoming: readonly AgentActivity[],
): AgentActivity[] {
  const byPane = new Map(current.map((activity) => [activity.pane.paneId, activity]))
  for (const activity of incoming) {
    const existing = byPane.get(activity.pane.paneId)
    if (!existing || activity.revision > existing.revision) byPane.set(activity.pane.paneId, activity)
  }
  return [...byPane.values()].sort((left, right) => (
    right.lastActivityAt.localeCompare(left.lastActivityAt)
    || left.pane.paneId.localeCompare(right.pane.paneId)
  ))
}

export const useStore = create<ApcStore>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  activeWorktrees: {},
  setActiveWorktree: (projectId, worktreePath) => set((state) => ({
    activeWorktrees: { ...state.activeWorktrees, [projectId]: worktreePath },
  })),
  paneTarget: null,
  focusAgentPane: (pane) => set((state) => ({
    activeWorktrees: { ...state.activeWorktrees, [pane.projectId]: pane.worktreePath },
    paneTarget: { pane, nonce: (state.paneTarget?.nonce ?? 0) + 1 },
  })),
  clearPaneTarget: (paneId) => set((state) => (
    !state.paneTarget || (paneId && state.paneTarget.pane.paneId !== paneId)
      ? {}
      : { paneTarget: null }
  )),
  activities: [],
  activitySnapshotAsOf: null,
  activityLoadGeneration: 0,
  mergeAgentActivity: (activity) => set((state) => ({
    activities: mergeAgentActivities(state.activities, [activity]),
  })),
  loadAgentActivities: async (projectId) => {
    const generation = get().activityLoadGeneration + 1
    set({ activityLoadGeneration: generation })
    try {
      const snapshot = await api.agentActivitySnapshot(projectId ? { projectId } : {})
      if (get().activityLoadGeneration !== generation) return
      if (projectId && get().selectedProjectId !== projectId) return
      set((state) => ({
        activities: mergeAgentActivities(state.activities, snapshot.activities),
        activitySnapshotAsOf: snapshot.asOf,
      }))
    } catch (error) {
      if (get().activityLoadGeneration === generation) set({ error: `Failed to load agent activity: ${error}` })
    }
  },
  dashboard: null,
  workspaceOverview: null,
  resumeCard: null,
  resumeBannerOpen: false,
  profiles: [],
  ingesting: false,
  lastIngest: null,
  error: null,
  agentStatus: {},
  restartNonce: {},
  stoppingKeys: {},
  openPanes: {},
  preflighting: false,
  generatePreflight: null,
  generating: false,
  generation: null,

  harnessRuns: [],
  harnessCanonicalProposals: [],
  selectedHarnessRunId: null,
  harnessLoading: false,
  harnessMessage: null,
  harnessProgress: null,
  harnessLiveLabel: null,
  harnessLiveTail: [],
  harnessLiveNodes: [],
  harnessLiveNodesRunId: null,
  harnessPromoteBlockedReason: null,
  harnessCanonicalBlock: null,
  harnessConfigs: {},

  wikiPolicy: null,
  wikiPolicyPreview: null,
  wikiPolicyBusy: false,
  wikiPolicyMessage: null,

  hydrateWorkspace(p) {
    const openPanes: Record<string, { agent: AgentType; sessionId: string | null }> = {}
    for (const pane of p.panes) {
      openPanes[pane.paneId ?? `${pane.projectId}:${pane.agent}`] = {
        agent: pane.agent,
        sessionId: pane.lastSessionId,
      }
    }
    set({ openPanes, selectedProjectId: p.selectedProjectId ?? get().selectedProjectId })
  },

  setAgentStatus(key, status) {
    set((s) => {
      if (status === 'done' && s.stoppingKeys[key]) {
        const stopping = { ...s.stoppingKeys }
        delete stopping[key]
        return { agentStatus: { ...s.agentStatus, [key]: 'idle' }, stoppingKeys: stopping }
      }
      return { agentStatus: { ...s.agentStatus, [key]: status } }
    })
  },

  restartAgent(key) {
    set((s) => {
      const stopping = { ...s.stoppingKeys }
      delete stopping[key]
      return {
        restartNonce: { ...s.restartNonce, [key]: (s.restartNonce[key] ?? 0) + 1 },
        stoppingKeys: stopping,
      }
    })
  },
  resumeAgentSession(key, sessionId, requestedAgent) {
    set((s) => {
      const agent = requestedAgent ?? s.openPanes[key]?.agent ?? (key.split(':').pop() as AgentType)
      // Mirror restartAgent's stoppingKeys reset (a prior ⏹ stop shouldn't linger across resume) and
      // bump restartNonce in the SAME set() as the sessionId write — AgentTerminal's respawn effect only
      // depends on restartNonce, so both must land in one render for it to pick up the new resumeSessionId.
      const stopping = { ...s.stoppingKeys }
      delete stopping[key]
      return {
        openPanes: { ...s.openPanes, [key]: { agent, sessionId } },
        restartNonce: { ...s.restartNonce, [key]: (s.restartNonce[key] ?? 0) + 1 },
        stoppingKeys: stopping,
      }
    })
  },
  stopAgent(key) {
    api.killPty({ id: key })
    set((s) => ({
      agentStatus: { ...s.agentStatus, [key]: 'idle' },
      stoppingKeys: { ...s.stoppingKeys, [key]: true },
    }))
  },

  async prepareGenerate() {
    const { selectedProjectId } = get()
    if (!selectedProjectId) { set({ error: 'Select a project first.' }); return }
    set({ preflighting: true, generatePreflight: null, generation: null })
    try {
      const generatePreflight = await api.generatePreflight({ projectId: selectedProjectId })
      set({ generatePreflight })
      if (!generatePreflight.ok) set({ error: generatePreflight.reason ?? 'Generate preflight failed' })
    } catch (e) {
      set({ error: `Generate preflight failed: ${e}` })
    } finally {
      set({ preflighting: false })
    }
  },

  async generate(selectedPreflightCategoryIds) {
    const { selectedProjectId } = get()
    if (!selectedProjectId) { set({ error: 'Select a project first.' }); return }
    set({ generating: true, generation: null })
    try {
      const generation = await api.generateProject({ projectId: selectedProjectId, engine: WIKI_GENERATION_ENGINE, selectedPreflightCategoryIds })
      set({ generation })
      if (!generation.ok) set({ error: generation.reason ?? 'Generate failed' })
    } catch (e) {
      set({ error: `Generate failed: ${e}` })
    } finally {
      set({ generating: false })
    }
  },

  clearGeneratePreflight() { set({ generatePreflight: null, preflighting: false }) },
  clearGeneration() { set({ generation: null }) },

  async loadProjects() {
    try {
      const projects = await api.listProjects()
      set({ projects })
    } catch (e) {
      set({ error: `Failed to load projects: ${e}` })
    }
  },

  async addProject(name: string, projectType: string, repoPath: string, domain: string, context = {}) {
    try {
      await api.registerProject({ name, projectType, repoPath, domain, ...context })
      await get().loadProjects()
    } catch (e) {
      set({ error: `Failed to add project: ${e}` })
    }
  },

  async updateProject(id: string, name: string, projectType: string, repoPath: string, domain: string, context = {}) {
    try {
      await api.updateProject({ id, name, projectType, repoPath, domain, ...context })
      await get().loadProjects()
      if (get().selectedProjectId === id) await get().selectProject(id)
    } catch (e) {
      set({ error: `Failed to update project: ${e}` })
    }
  },

  async confirmProjectContext(req) {
    try {
      const result = await api.projectContextConfirm(req)
      if (!result.ok || !result.project) return result
      set((state) => ({
        projects: state.projects.map((project) => project.id === result.project!.id ? result.project! : project),
        dashboard: state.dashboard?.project.id === result.project!.id
          ? { ...state.dashboard, project: result.project! }
          : state.dashboard,
      }))
      return result
    } catch (error) {
      const reason = `Failed to confirm project context: ${error}`
      set({ error: reason })
      return { ok: false, reason }
    }
  },

  async deleteProject(id: string) {
    try {
      await api.deleteProject(id)
      if (get().selectedProjectId === id) set({ selectedProjectId: null, dashboard: null, profiles: [], harnessRuns: [], selectedHarnessRunId: null, harnessMessage: null, harnessCanonicalProposals: [] })
      await get().loadProjects()
    } catch (e) {
      set({ error: `Failed to delete project: ${e}` })
    }
  },

  async selectProject(projectId: string) {
    try {
      set({ selectedProjectId: projectId, dashboard: null })
      const dashboard = await api.projectDashboard({ projectId })
      if (get().selectedProjectId !== projectId) return // stale response guard
      set({ dashboard })
      get().hydrateHarnessProject(projectId)
    } catch (e) {
      if (get().selectedProjectId !== projectId) return
      set({ error: `Failed to load dashboard: ${e}` })
    }
  },

  async loadWorkspaceOverview() {
    try {
      const workspaceOverview = await api.workspaceOverview()
      set({ workspaceOverview })
    } catch (e) {
      set({ error: `Failed to load workspace overview: ${e}` })
    }
  },

  async loadResumeCard(projectId) {
    const card = await api.resumeCard(projectId)
    if (get().selectedProjectId !== projectId) return
    set({ resumeCard: card, resumeBannerOpen: Boolean(card?.hasHistory) })
  },
  openResumeBanner() { set({ resumeBannerOpen: true }) },
  dismissResumeBanner() { set({ resumeBannerOpen: false }) },
  async addNextNote(text) {
    const pid = get().selectedProjectId
    if (!pid) return
    const res = await api.nextNoteAdd({ projectId: pid, text })
    if (res.ok && res.note) {
      const card = get().resumeCard
      if (card && card.project.id === pid) set({ resumeCard: { ...card, nextNotes: [res.note, ...card.nextNotes], hasHistory: true } })
    }
  },

  async loadProfiles(projectPath: string) {
    const projectId = get().selectedProjectId
    try {
      const profiles = await api.listProfiles(projectPath)
      if (get().selectedProjectId !== projectId) return // stale response guard
      set({ profiles })
    } catch (e) {
      if (get().selectedProjectId !== projectId) return
      set({ profiles: [], error: `Failed to load profiles: ${e}` })
    }
  },

  async ingest() {
    set({ ingesting: true })
    try {
      const lastIngest = await api.ingestAll()
      set({ lastIngest })
      const { selectedProjectId } = get()
      if (selectedProjectId) {
        const dashboard = await api.projectDashboard({ projectId: selectedProjectId })
        set({ dashboard })
      }
    } catch (e) {
      set({ error: `Ingest failed: ${e}` })
    } finally {
      set({ ingesting: false })
    }
  },

  clearError() { set({ error: null }) },

  hydrateHarnessProject(projectId: string) {
    const runs = loadHarnessRuns(projectId)
    const config = loadHarnessConfig(projectId) ?? createDefaultHarnessConfig()
    const selectedHarnessRunId = loadHarnessSelectedRun(projectId) ?? runs[0]?.runState.runId ?? null
    set((state) => ({
      ...updateHarnessConfig(state, projectId, config),
      harnessRuns: runs,
      selectedHarnessRunId,
      harnessMessage: null,
      harnessCanonicalProposals: [],  // hashes are run-specific; clear until the next refresh re-captures
      harnessPromoteBlockedReason: null,
      harnessCanonicalBlock: null,
    }))
  },

  selectHarnessRun(runId: string) {
    const projectId = get().selectedProjectId
    if (!projectId) return
    // canonical hashes belong to the previously-selected run — clear so we never promote against the wrong run
    set({ selectedHarnessRunId: runId, harnessCanonicalProposals: [], harnessPromoteBlockedReason: null, harnessCanonicalBlock: null })
    saveHarnessSelectedRun(projectId, runId)
  },

  async startHarnessRun(materialize = false, fullRegen = false, interactive = false, projectContext?: ProjectStructureHintDto) {
    const projectId = get().selectedProjectId
    if (!projectId) { set({ error: 'Select a project first.' }); return }
    const storedConfig = getHarnessConfig(get(), projectId)
    const config: HarnessConfig = {
      ...storedConfig,
      model: { ...storedConfig.model, engine: WIKI_GENERATION_ENGINE, permissionMode: undefined },
    }
    set({ harnessLoading: true, harnessMessage: null, harnessCanonicalProposals: [], harnessProgress: null, harnessLiveLabel: null, harnessLiveTail: [], harnessLiveNodes: [], harnessLiveNodesRunId: null, harnessPromoteBlockedReason: null, harnessCanonicalBlock: null })
    try {
      const started = await api.harnessRun({
        projectId,
        engine: WIKI_GENERATION_ENGINE,
        materialize,
        engineOptions: modelSettingsToEngineOptions(config.model),
        workerConcurrency: config.model.workerConcurrency,
        fullRegen,
        ...(interactive ? { interactive: true } : {}),
        ...(projectContext ? { projectContext } : {}),
      })
      if (!started.runId) throw new Error(started.reason ?? 'Harness run did not return a run id')
      const shown = await api.harnessGetRun({ runId: started.runId })
      if (shown.ok && shown.runState) {
        const bundle: HarnessRunBundle = { runState: shown.runState, artifacts: shown.artifacts ?? [], mode: materialize ? 'full-docs' : 'recent-sessions' }
        const runs = upsertRun(get().harnessRuns, bundle)
        set((state) => ({
          ...updateHarnessConfig(state, projectId, config),
          harnessRuns: runs,
          selectedHarnessRunId: bundle.runState.runId,
          harnessMessage: `${started.runId} → ${started.finalState ?? bundle.runState.state}`,
        }))
        persistProjectRuns(projectId, runs, bundle.runState.runId)
      } else {
        set({ harnessMessage: started.reason ?? shown.reason ?? 'Harness run finished but could not be loaded.' })
      }
      if (!started.ok) set({ harnessMessage: `${started.runId} → ${started.finalState ?? 'FAILED'}${started.reason ? ` — ${started.reason}` : ''}` })
    } catch (e) {
      set({ error: `Harness run failed: ${e}` })
    } finally {
      set({ harnessLoading: false })
    }
  },

  async refreshHarnessRun(runId?: string) {
    const targetRunId = runId ?? get().selectedHarnessRunId
    const projectId = get().selectedProjectId
    if (!projectId) { set({ error: 'Select a project first.' }); return }
    if (!targetRunId) { set({ error: 'Select a harness run first.' }); return }
    set({ harnessLoading: true })
    try {
      const shown = await api.harnessGetRun({ runId: targetRunId })
      if (get().selectedProjectId !== projectId || get().selectedHarnessRunId !== targetRunId) return // stale guard
      if (!shown.ok || !shown.runState) throw new Error(shown.reason ?? 'Run not found')
      const bundle: HarnessRunBundle = { runState: shown.runState, artifacts: shown.artifacts ?? [] }
      const runs = upsertRun(get().harnessRuns, bundle)
      set({ harnessRuns: runs, selectedHarnessRunId: targetRunId, harnessMessage: `Refreshed ${targetRunId}`, harnessPromoteBlockedReason: null, harnessCanonicalBlock: null })
      persistProjectRuns(projectId, runs, targetRunId)
      await get().loadCanonicalProposals(targetRunId)  // capture canonical hashes as of this view
    } catch (e) {
      if (get().selectedProjectId !== projectId || get().selectedHarnessRunId !== targetRunId) return
      set({ error: `Failed to refresh harness run: ${e}` })
    } finally {
      set({ harnessLoading: false })
    }
  },

  async resumeHarnessRun(runId?: string) {
    const targetRunId = runId ?? get().selectedHarnessRunId
    if (!targetRunId) { set({ error: 'Select a harness run first.' }); return }
    set({ harnessLoading: true })
    try {
      const resumed = await api.harnessResume({ runId: targetRunId })
      if (!resumed.ok) {
        set({ harnessMessage: `Resume failed: ${resumed.reason ?? 'unknown reason'}` })
        return
      }
      await get().refreshHarnessRun(targetRunId)
      set({ harnessMessage: `Resumed ${targetRunId} → ${resumed.finalState ?? '?'}` })  // after refresh (which sets its own message)
    } catch (e) {
      set({ error: `Harness resume failed: ${e}` })
    } finally {
      set({ harnessLoading: false })
    }
  },

  async confirmNodes(runId: string, approvedNodes: { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> }) {
    set({ harnessLoading: true, harnessMessage: null })
    try {
      const res = await api.harnessConfirmNodes({ runId, approvedNodes })
      if (!res.ok) {
        set({ harnessMessage: `확인 실패: ${res.reason ?? 'unknown reason'}` })
        return
      }
      await get().refreshHarnessRun(runId)
      set({ harnessMessage: `노드 확인 완료 → ${res.finalState ?? '?'}` })
    } catch (e) {
      set({ error: `Node confirm failed: ${e}` })
    } finally {
      set({ harnessLoading: false })
    }
  },

  async promoteHarnessRun(runId?: string, allowInvalid = false) {
    const targetRunId = runId ?? get().selectedHarnessRunId
    if (!targetRunId) { set({ error: 'Select a harness run first.' }); return }
    try {
      const promoted = await api.harnessPromote(allowInvalid ? { runId: targetRunId, allowInvalid: true } : { runId: targetRunId })
      if (!promoted.ok) {
        const reason = promoted.reason ?? 'unknown reason'
        // Surface a force-override affordance only for gates allowInvalid can lift (graph/markdown/link),
        // and only when we didn't already pass it (so a forced-but-still-failed promote doesn't loop).
        const overridable = !allowInvalid && /pass allowInvalid to override/i.test(reason)
        set({ harnessMessage: `Promote failed: ${reason}`, harnessPromoteBlockedReason: overridable ? reason : null })
        return
      }
      await get().refreshHarnessRun(targetRunId)  // clears harnessPromoteBlockedReason on its success path
      set({ harnessMessage: `Promoted ${promoted.promoted?.length ?? 0} file(s)${allowInvalid ? ' (검증 무시)' : ''}`, harnessPromoteBlockedReason: null })
    } catch (e) {
      set({ error: `Harness promote failed: ${e}` })
    }
  },

  async exportWiki(projectId?: string) {
    const targetProjectId = projectId ?? get().selectedProjectId
    if (!targetProjectId) { set({ error: 'Select a project first.' }); return }
    set({ harnessMessage: '워크스페이스로 export 중…' })
    try {
      const r = await api.harnessExportWiki({ projectId: targetProjectId })
      set({ harnessMessage: r.ok ? `✅ ${r.files}개 문서를 워크스페이스로 export: ${r.target}` : `Export 실패: ${r.reason}` })
    } catch (e) {
      set({ error: `Wiki export failed: ${e}` })
    }
  },

  async loadCanonicalProposals(runId?: string) {
    const targetRunId = runId ?? get().selectedHarnessRunId
    if (!targetRunId) { set({ harnessCanonicalProposals: [] }); return }
    try {
      const list = await api.harnessCanonicalProposals({ runId: targetRunId })
      // staleness guard: if the selected run changed during the await, this result is for the OLD run —
      // dropping it prevents a late IPC from re-populating B's list with A's proposals (cross-run promote).
      if (get().selectedHarnessRunId !== targetRunId) return
      set({ harnessCanonicalProposals: list })
    } catch (e) {
      if (get().selectedHarnessRunId !== targetRunId) return  // same guard for a late rejection
      // non-fatal: clear the stale list but surface the failure so it's not mistaken for "no proposals"
      set({ harnessCanonicalProposals: [], harnessMessage: `Could not load canonical proposals: ${e}` })
    }
  },

  async promoteCanonicalDoc(proposalRelPath: string, lastReadHash: string, allowInvalid = false) {
    const targetRunId = get().selectedHarnessRunId
    if (!targetRunId) { set({ error: 'Select a harness run first.' }); return }
    try {
      const r = await api.harnessPromoteCanonical(
        allowInvalid
          ? { runId: targetRunId, proposalRelPath, lastReadHash, allowInvalid: true }
          : { runId: targetRunId, proposalRelPath, lastReadHash },
      )
      if (!r.ok) {
        const reason = r.reason ?? 'unknown'
        const overridable = !allowInvalid && /pass allowInvalid to override/i.test(reason)
        set({
          harnessMessage: `Canonical promote failed: ${reason}`,
          harnessCanonicalBlock: overridable ? { proposalRelPath, lastReadHash, reason } : null,
        })
        return
      }
      await get().refreshHarnessRun(targetRunId)  // re-captures hashes after the write (sets its own message)
      set({
        harnessMessage: r.status === 'conflict' ? `Conflict written: ${r.conflictPath}` : `Promoted ${r.canonicalPath}${allowInvalid ? ' (검증 무시)' : ''}`,
        harnessCanonicalBlock: null,
      })
    } catch (e) {
      set({ error: `Canonical promote failed: ${e}` })
    }
  },

  updateHarnessModel(patch) {
    const projectId = get().selectedProjectId
    if (!projectId) return
    const current = getHarnessConfig(get(), projectId)
    const next: HarnessConfig = {
      ...current,
      model: { ...current.model, ...patch, engine: WIKI_GENERATION_ENGINE, permissionMode: undefined },
    }
    set((state) => updateHarnessConfig(state as ApcStore, projectId, next))
    saveHarnessConfig(projectId, next)
  },

  updateHarnessSafety(patch) {
    const projectId = get().selectedProjectId
    if (!projectId) return
    const current = getHarnessConfig(get(), projectId)
    const next = { ...current, safety: { ...current.safety, ...patch } }
    set((state) => updateHarnessConfig(state as ApcStore, projectId, next))
    saveHarnessConfig(projectId, next)
  },

  toggleHarnessGate(key) {
    const projectId = get().selectedProjectId
    if (!projectId) return
    const current = getHarnessConfig(get(), projectId)
    const next = { ...current, featureGates: { ...current.featureGates, [key]: !current.featureGates[key] } }
    set((state) => updateHarnessConfig(state as ApcStore, projectId, next))
    saveHarnessConfig(projectId, next)
  },

  updateHarnessPrompt(key, value) {
    const projectId = get().selectedProjectId
    if (!projectId) return
    const current = getHarnessConfig(get(), projectId)
    const next = { ...current, prompts: { ...current.prompts, [key]: value } }
    set((state) => updateHarnessConfig(state as ApcStore, projectId, next))
    saveHarnessConfig(projectId, next)
  },

  clearHarnessMessage() { set({ harnessMessage: null }) },
  setHarnessProgress(state) { set({ harnessProgress: state }) },
  appendHarnessEngineLog(e) {
    set((s) => ({ harnessLiveLabel: e.label, harnessLiveTail: appendTailLines(s.harnessLiveTail, e.chunk) }))
  },
  addHarnessLiveNodes(e) {
    set((s) => {
      // A new run's first batch resets the accumulator (the prior run's live nodes are stale).
      const base = s.harnessLiveNodesRunId === e.runId ? s.harnessLiveNodes : []
      const seen = new Set(base.map((n) => n.id))
      const merged = [...base]
      for (const n of e.nodes) if (!seen.has(n.id)) { seen.add(n.id); merged.push(n) }
      return { harnessLiveNodes: merged, harnessLiveNodesRunId: e.runId }
    })
  },

  async proposeWikiPolicy(projectId) {
    set({ wikiPolicyBusy: true, wikiPolicyMessage: null })
    try {
      const res = await api.harnessProposePolicy({ projectId, engine: WIKI_GENERATION_ENGINE })
      if (res.ok && res.proposal) {
        set({
          wikiPolicyPreview: res.effectivePreview ?? null,
          wikiPolicyMessage: '제안 생성됨 — 검토 후 승인하세요',
          wikiPolicy: { status: 'proposed', proposal: res.proposal, generatedAt: new Date().toISOString(), body: res.body ?? '' },
        })
      } else {
        set({ wikiPolicyMessage: `실패: ${res.reason ?? 'unknown'}` })
      }
    } catch (e) {
      set({ wikiPolicyMessage: `실패: ${e}` })
    } finally {
      set({ wikiPolicyBusy: false })   // always clear the spinner, even on IPC rejection
    }
  },

  async approveWikiPolicy(projectId) {
    try {
      const res = await api.harnessApprovePolicy({ projectId })
      if (res.ok) set({ wikiPolicy: res.record ?? null, wikiPolicyMessage: '승인됨 — 다음 런부터 적용' })
      else set({ wikiPolicyMessage: `승인 실패: ${res.reason ?? 'unknown'}` })
    } catch (e) {
      set({ wikiPolicyMessage: `승인 실패: ${e}` })
    }
  },

  async loadWikiPolicy(projectId) {
    try {
      const res = await api.harnessGetPolicy({ projectId })
      set({ wikiPolicy: res.record, wikiPolicyPreview: null })
    } catch { /* policy load is best-effort UI hydration — leave prior state on failure */ }
  },

  async revertWikiPolicy(projectId) {
    try {
      const res = await api.harnessRevertPolicy({ projectId })
      if (!res.ok) { set({ wikiPolicyMessage: `되돌리기 실패: ${res.reason ?? 'unknown'}` }); return }
      set({ wikiPolicy: null, wikiPolicyPreview: null, wikiPolicyMessage: '기본 정책으로 되돌림' })
    } catch (e) {
      set({ wikiPolicyMessage: `되돌리기 실패: ${e}` })
    }
  },

  async attachProfileToActiveTask(profileId: string) {
    const dashboard = get().dashboard
    const taskId = dashboard?.activeTasks[0]?.id
    if (!taskId) {
      set({ error: 'Select/create a task first to attach a profile.' })
      return
    }
    try {
      await api.selectProfile({ taskId, profileId })
      set({ harnessMessage: `Attached profile ${profileId} to ${taskId}` })
    } catch (e) {
      set({ error: `Failed to attach profile: ${e}` })
    }
  },
}))
