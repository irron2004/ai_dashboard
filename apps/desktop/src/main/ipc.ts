import { CH } from '../shared/ipc-contract.js'
import type {
  ProjectDashboardReq, SearchReq, ListProfilesReq,
  SubmitReviewReq, PromoteCurrentReq, SelectProfileReq,
} from '../shared/ipc-contract.js'
import type { Container } from './container.js'

export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void
}

export function handlers(container: Container): Record<string, (payload: unknown) => Promise<unknown>> {
  return {
    [CH.listProjects]: async (_payload: unknown) => {
      return container.registry.list()
    },

    [CH.projectDashboard]: async (payload: unknown) => {
      const req = payload as ProjectDashboardReq
      return container.dashboard(
        { registry: container.registry, tasks: container.tasks, runs: container.runs },
        req.projectId,
      )
    },

    [CH.search]: async (payload: unknown) => {
      const req = payload as SearchReq
      return container.searchIndex.search(req.query, req.projectId ? { projectId: req.projectId } : {})
    },

    [CH.listProfiles]: async (payload: unknown) => {
      const req = payload as ListProfilesReq
      const { OpenCodeConfigAdapter } = await import('@apc/harness')
      return new OpenCodeConfigAdapter().discoverProfiles({ projectPath: req.projectPath })
    },

    [CH.ingestAll]: async (_payload: unknown) => {
      return container.ingest.ingestAll(container.ingestAdapters)
    },

    [CH.submitReview]: async (payload: unknown) => {
      const req = payload as SubmitReviewReq
      return container.reviews.applyReview(req.review)
    },

    [CH.promoteCurrent]: async (payload: unknown) => {
      const req = payload as PromoteCurrentReq
      // Lazy import to avoid pulling vault at types level; use ConflictManager from core
      const { ConflictManager } = await import('@apc/core')
      const { CurrentPromotionService } = await import('@apc/app-services')
      const stamp = new Date().toISOString().slice(0, 10)
      const svc = new CurrentPromotionService({ vault: container.vault, conflict: new ConflictManager(), stamp })
      return svc.promote({ projectId: req.projectId, lastReadHash: req.lastReadHash })
    },

    [CH.selectProfile]: async (payload: unknown) => {
      const req = payload as SelectProfileReq
      container.taskProfiles.select(req.taskId, req.profileId)
      return { ok: true }
    },
  }
}

export function registerIpc(ipcMain: IpcMainLike, container: Container): void {
  for (const [ch, fn] of Object.entries(handlers(container))) {
    ipcMain.handle(ch, (_e, payload) => fn(payload))
  }
}
