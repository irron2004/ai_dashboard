import { create } from 'zustand'
import type { Project, AgentProfile, AgentType } from '@apc/shared'
import type { ProjectDashboardRes, GenerateProjectRes } from '../shared/ipc-contract.js'
import { api } from './api.js'

export type AgentRunStatus = 'idle' | 'running' | 'attention' | 'done'

type ApcStore = {
  projects: Project[]
  selectedProjectId: string | null
  dashboard: ProjectDashboardRes | null
  profiles: AgentProfile[]
  ingesting: boolean
  lastIngest: { sources: number; sessions: number } | null
  error: string | null
  agentStatus: Record<AgentType, AgentRunStatus>
  generating: boolean
  generation: GenerateProjectRes | null

  setAgentStatus(agent: AgentType, status: AgentRunStatus): void
  generate(engine: AgentType): Promise<void>
  clearGeneration(): void
  loadProjects(): Promise<void>
  addProject(name: string, projectType: string, repoPath: string): Promise<void>
  updateProject(id: string, name: string, projectType: string, repoPath: string): Promise<void>
  deleteProject(id: string): Promise<void>
  selectProject(projectId: string): Promise<void>
  loadProfiles(projectPath: string): Promise<void>
  ingest(): Promise<void>
  clearError(): void
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
  generating: false,
  generation: null,

  setAgentStatus(agent, status) {
    set((s) => ({ agentStatus: { ...s.agentStatus, [agent]: status } }))
  },

  async generate(engine) {
    const { selectedProjectId } = get()
    if (!selectedProjectId) { set({ error: 'Select a project first.' }); return }
    set({ generating: true, generation: null })
    try {
      const generation = await api.generateProject({ projectId: selectedProjectId, engine })
      set({ generation })
      if (!generation.ok) set({ error: generation.reason ?? 'Generate failed' })
    } catch (e) {
      set({ error: `Generate failed: ${e}` })
    } finally {
      set({ generating: false })
    }
  },

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
      if (get().selectedProjectId === id) set({ selectedProjectId: null, dashboard: null, profiles: [] })
      await get().loadProjects()
    } catch (e) {
      set({ error: `Failed to delete project: ${e}` })
    }
  },

  async selectProject(projectId: string) {
    try {
      set({ selectedProjectId: projectId, dashboard: null })
      const dashboard = await api.projectDashboard({ projectId })
      set({ dashboard })
    } catch (e) {
      set({ error: `Failed to load dashboard: ${e}` })
    }
  },

  async loadProfiles(projectPath: string) {
    try {
      const profiles = await api.listProfiles(projectPath)
      set({ profiles })
    } catch (e) {
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
}))
