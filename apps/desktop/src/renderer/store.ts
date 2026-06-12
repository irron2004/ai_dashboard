import { create } from 'zustand'
import type { Project, AgentProfile, AgentType } from '@apc/shared'
import type { GeneratePreflightCategoryId, GeneratePreflightRes, ProjectDashboardRes, GenerateProjectRes, HarnessCanonicalProposalsRes } from '../shared/ipc-contract.js'
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
  type HarnessAgentPromptKey,
  type HarnessConfig,
  type HarnessFeatureGateKey,
  type HarnessRunBundle,
} from './harness-utils.js'

export type AgentRunStatus = 'idle' | 'running' | 'attention' | 'done'

type ApcStore = {
  projects: Project[]
  selectedProjectId: string | null
  dashboard: ProjectDashboardRes | null
  profiles: AgentProfile[]
  ingesting: boolean
  lastIngest: { sources: number; sessions: number; documents: number } | null
  error: string | null
  agentStatus: Record<AgentType, AgentRunStatus>
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
  /** Set when promote was blocked by a validation gate that `allowInvalid` can override; null otherwise.
   * Drives the "검증 무시하고 promote" force-override affordance in the UI. */
  harnessPromoteBlockedReason: string | null
  /** Same, but for a CANONICAL proposal promote — tracks which proposal was blocked so the per-doc
   * force button can retry exactly that one with allowInvalid. */
  harnessCanonicalBlock: { proposalRelPath: string; lastReadHash: string; reason: string } | null

  setAgentStatus(agent: AgentType, status: AgentRunStatus): void
  prepareGenerate(): Promise<void>
  generate(engine: AgentType, selectedPreflightCategoryIds?: GeneratePreflightCategoryId[]): Promise<void>
  clearGeneratePreflight(): void
  clearGeneration(): void
  loadProjects(): Promise<void>
  addProject(name: string, projectType: string, repoPath: string): Promise<void>
  updateProject(id: string, name: string, projectType: string, repoPath: string): Promise<void>
  deleteProject(id: string): Promise<void>
  selectProject(projectId: string): Promise<void>
  loadProfiles(projectPath: string): Promise<void>
  ingest(): Promise<void>
  clearError(): void

  hydrateHarnessProject(projectId: string): void
  selectHarnessRun(runId: string): void
  startHarnessRun(materialize?: boolean): Promise<void>
  refreshHarnessRun(runId?: string): Promise<void>
  resumeHarnessRun(runId?: string): Promise<void>
  promoteHarnessRun(runId?: string, allowInvalid?: boolean): Promise<void>
  loadCanonicalProposals(runId?: string): Promise<void>
  promoteCanonicalDoc(proposalRelPath: string, lastReadHash: string, allowInvalid?: boolean): Promise<void>
  updateHarnessModel(patch: Partial<HarnessConfig['model']>): void
  updateHarnessSafety(patch: Partial<HarnessConfig['safety']>): void
  toggleHarnessGate(key: HarnessFeatureGateKey): void
  updateHarnessPrompt(key: HarnessAgentPromptKey, value: string): void
  clearHarnessMessage(): void
  setHarnessProgress(state: string | null): void
  appendHarnessEngineLog(e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }): void
  attachProfileToActiveTask(profileId: string): Promise<void>
}

function persistProjectRuns(projectId: string, runs: HarnessRunBundle[], selectedRunId: string | null): void {
  saveHarnessRuns(projectId, runs)
  saveHarnessSelectedRun(projectId, selectedRunId)
}

function upsertRun(runs: HarnessRunBundle[], bundle: HarnessRunBundle): HarnessRunBundle[] {
  const prev = runs.find((item) => item.runState.runId === bundle.runState.runId)
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

export const useStore = create<ApcStore>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  dashboard: null,
  profiles: [],
  ingesting: false,
  lastIngest: null,
  error: null,
  agentStatus: { claude: 'idle', codex: 'idle', opencode: 'idle' },
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
  harnessPromoteBlockedReason: null,
  harnessCanonicalBlock: null,
  harnessConfigs: {},

  setAgentStatus(agent, status) {
    set((s) => ({ agentStatus: { ...s.agentStatus, [agent]: status } }))
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

  async generate(engine, selectedPreflightCategoryIds) {
    const { selectedProjectId } = get()
    if (!selectedProjectId) { set({ error: 'Select a project first.' }); return }
    set({ generating: true, generation: null })
    try {
      const generation = await api.generateProject({ projectId: selectedProjectId, engine, selectedPreflightCategoryIds })
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

  async addProject(name: string, projectType: string, repoPath: string) {
    try {
      await api.registerProject({ name, projectType, repoPath })
      await get().loadProjects()
    } catch (e) {
      set({ error: `Failed to add project: ${e}` })
    }
  },

  async updateProject(id: string, name: string, projectType: string, repoPath: string) {
    try {
      await api.updateProject({ id, name, projectType, repoPath })
      await get().loadProjects()
      if (get().selectedProjectId === id) await get().selectProject(id)
    } catch (e) {
      set({ error: `Failed to update project: ${e}` })
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

  async startHarnessRun(materialize = false) {
    const projectId = get().selectedProjectId
    if (!projectId) { set({ error: 'Select a project first.' }); return }
    const config = getHarnessConfig(get(), projectId)
    set({ harnessLoading: true, harnessMessage: null, harnessCanonicalProposals: [], harnessProgress: null, harnessLiveLabel: null, harnessLiveTail: [], harnessPromoteBlockedReason: null, harnessCanonicalBlock: null })
    try {
      const started = await api.harnessRun({ projectId, engine: config.model.engine, materialize })
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
    const next = { ...current, model: { ...current.model, ...patch } }
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
