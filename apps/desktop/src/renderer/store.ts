import { create } from 'zustand'
import type { Project, AgentProfile } from '@apc/shared'
import type { ProjectDashboardRes } from '../shared/ipc-contract.js'
import { api } from './api.js'

type ApcStore = {
  projects: Project[]
  selectedProjectId: string | null
  dashboard: ProjectDashboardRes | null
  profiles: AgentProfile[]

  loadProjects(): Promise<void>
  selectProject(projectId: string): Promise<void>
  loadProfiles(projectPath: string): Promise<void>
}

export const useStore = create<ApcStore>((set) => ({
  projects: [],
  selectedProjectId: null,
  dashboard: null,
  profiles: [],

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
}))
