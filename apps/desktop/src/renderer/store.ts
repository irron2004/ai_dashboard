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

  loadProjects(): Promise<void>
  selectProject(projectId: string): Promise<void>
  loadProfiles(projectPath: string): Promise<void>
  ingest(): Promise<void>
}

export const useStore = create<ApcStore>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  dashboard: null,
  profiles: [],
  ingesting: false,
  lastIngest: null,

  async loadProjects() {
    const projects = await api.listProjects()
    set({ projects })
  },

  async selectProject(projectId: string) {
    set({ selectedProjectId: projectId, dashboard: null })
    const dashboard = await api.projectDashboard({ projectId })
    set({ dashboard })
  },

  async loadProfiles(projectPath: string) {
    const profiles = await api.listProfiles(projectPath)
    set({ profiles })
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
    } finally {
      set({ ingesting: false })
    }
  },
}))
