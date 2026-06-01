import { CH } from '../shared/ipc-contract.js'
import type {
  ProjectDashboardReq, ProjectDashboardRes, SearchReq,
  SubmitReviewReq, PromoteCurrentReq, SelectProfileReq,
} from '../shared/ipc-contract.js'
import type { Project, AgentProfile } from '@apc/shared'

declare global {
  interface Window {
    apc: {
      invoke(channel: string, payload?: unknown): Promise<unknown>
      onPtyData(cb: (id: string, data: string) => void): void
    }
  }
}

export const api = {
  listProjects(): Promise<Project[]> {
    return window.apc.invoke(CH.listProjects) as Promise<Project[]>
  },
  projectDashboard(req: ProjectDashboardReq): Promise<ProjectDashboardRes> {
    return window.apc.invoke(CH.projectDashboard, req) as Promise<ProjectDashboardRes>
  },
  search(req: SearchReq): Promise<unknown[]> {
    return window.apc.invoke(CH.search, req) as Promise<unknown[]>
  },
  listProfiles(projectPath: string): Promise<AgentProfile[]> {
    return window.apc.invoke(CH.listProfiles, { projectPath }) as Promise<AgentProfile[]>
  },
  submitReview(req: SubmitReviewReq): Promise<unknown> {
    return window.apc.invoke(CH.submitReview, req)
  },
  promoteCurrent(req: PromoteCurrentReq): Promise<unknown> {
    return window.apc.invoke(CH.promoteCurrent, req)
  },
  selectProfile(req: SelectProfileReq): Promise<unknown> {
    return window.apc.invoke(CH.selectProfile, req)
  },
}
