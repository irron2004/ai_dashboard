import { CH } from '../shared/ipc-contract.js'
import type {
  RegisterProjectReq, UpdateProjectReq, ProjectDashboardReq, ProjectDashboardRes, SearchReq,
  SubmitReviewReq, PromoteCurrentReq, SelectProfileReq, GenerateRunReq,
  GenerateProjectReq, GenerateProjectRes, HarnessRunReq, HarnessRunRes, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
  HarnessResumeReq, HarnessPromoteCanonicalReq, HarnessPromoteCanonicalRes,
  HarnessCanonicalProposalsReq, HarnessCanonicalProposalsRes,
  StartPtyReq, PtyInputReq, PtyKillReq, PtyResizeReq,
} from '../shared/ipc-contract.js'
import type { Project, AgentProfile } from '@apc/shared'

declare global {
  interface Window {
    apc: {
      invoke(channel: string, payload?: unknown): Promise<unknown>
      startPty(req: StartPtyReq): void
      writePty(req: PtyInputReq): void
      killPty(req: PtyKillReq): void
      resizePty(req: PtyResizeReq): void
      onPtyData(cb: (id: string, data: string) => void): () => void
      onPtyExit(cb: (id: string, code: number) => void): () => void
    }
  }
}

export const api = {
  selectFolder(): Promise<string | null> {
    return window.apc.invoke(CH.selectFolder) as Promise<string | null>
  },
  appUpdate(): Promise<{ ok: boolean; output: string }> {
    return window.apc.invoke(CH.appUpdate) as Promise<{ ok: boolean; output: string }>
  },
  appRestart(): Promise<void> {
    return window.apc.invoke(CH.appRestart) as Promise<void>
  },
  testSsh(req: { host: string; port: number; username: string; remotePath: string }): Promise<{ ok: boolean; error?: string }> {
    return window.apc.invoke(CH.testSsh, req) as Promise<{ ok: boolean; error?: string }>
  },
  listProjects(): Promise<Project[]> {
    return window.apc.invoke(CH.listProjects) as Promise<Project[]>
  },
  registerProject(req: RegisterProjectReq): Promise<Project> {
    return window.apc.invoke(CH.registerProject, req) as Promise<Project>
  },
  updateProject(req: UpdateProjectReq): Promise<Project> {
    return window.apc.invoke(CH.updateProject, req) as Promise<Project>
  },
  deleteProject(id: string): Promise<{ ok: boolean }> {
    return window.apc.invoke(CH.deleteProject, { id }) as Promise<{ ok: boolean }>
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
  ingestAll(): Promise<{ sources: number; sessions: number }> {
    return window.apc.invoke(CH.ingestAll) as Promise<{ sources: number; sessions: number }>
  },
  generateRun(req: GenerateRunReq): Promise<unknown> {
    return window.apc.invoke(CH.generateRun, req)
  },
  generateProject(req: GenerateProjectReq): Promise<GenerateProjectRes> {
    return window.apc.invoke(CH.generateProject, req) as Promise<GenerateProjectRes>
  },
  harnessRun(req: HarnessRunReq): Promise<HarnessRunRes> {
    return window.apc.invoke(CH.harnessRun, req) as Promise<HarnessRunRes>
  },
  harnessResume(req: HarnessResumeReq): Promise<HarnessRunRes> {
    return window.apc.invoke(CH.harnessResume, req) as Promise<HarnessRunRes>
  },
  harnessGetRun(req: HarnessGetRunReq): Promise<HarnessGetRunRes> {
    return window.apc.invoke(CH.harnessGetRun, req) as Promise<HarnessGetRunRes>
  },
  harnessPromote(req: HarnessPromoteReq): Promise<HarnessPromoteRes> {
    return window.apc.invoke(CH.harnessPromote, req) as Promise<HarnessPromoteRes>
  },
  harnessPromoteCanonical(req: HarnessPromoteCanonicalReq): Promise<HarnessPromoteCanonicalRes> {
    return window.apc.invoke(CH.harnessPromoteCanonical, req) as Promise<HarnessPromoteCanonicalRes>
  },
  harnessCanonicalProposals(req: HarnessCanonicalProposalsReq): Promise<HarnessCanonicalProposalsRes> {
    return window.apc.invoke(CH.harnessCanonicalProposals, req) as Promise<HarnessCanonicalProposalsRes>
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

  // PTY (event-based)
  startPty(req: StartPtyReq): void { window.apc.startPty(req) },
  writePty(req: PtyInputReq): void { window.apc.writePty(req) },
  killPty(req: PtyKillReq): void { window.apc.killPty(req) },
  resizePty(req: PtyResizeReq): void { window.apc.resizePty(req) },
  onPtyData(cb: (id: string, data: string) => void): () => void { return window.apc.onPtyData(cb) },
  onPtyExit(cb: (id: string, code: number) => void): () => void { return window.apc.onPtyExit(cb) },
}
