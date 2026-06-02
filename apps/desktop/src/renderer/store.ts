import { create } from 'zustand'
import type { Project, AgentProfile } from '@apc/shared'
import type { ProjectDashboardRes } from '../shared/ipc-contract.js'
import { api } from './api.js'

type ApcStore = {
  projects: Project[]
  selectedProjectId: string | null
  dashboard: ProjectDashboardRes | null
  profiles: AgentProfile[]
  ingesting: boolean
  lastIngest: { sources: number; sessions: number } | null
  error: string | null

  loadProjects(): Promise<void>
  addProject(name: string, projectType: string, repoPath: string): Promise<void>
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
