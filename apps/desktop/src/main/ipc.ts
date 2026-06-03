import { z } from 'zod'
import { CH } from '../shared/ipc-contract.js'
import type {
  RegisterProjectReq, UpdateProjectReq, DeleteProjectReq, ProjectDashboardReq, SearchReq, ListProfilesReq,
  SubmitReviewReq, PromoteCurrentReq, SelectProfileReq, GenerateRunReq, GenerateProjectReq,
  HarnessRunReq, HarnessGetRunReq, HarnessPromoteReq,
} from '../shared/ipc-contract.js'
import type { AgentSource } from '@apc/shared'
import type { Container } from './container.js'

export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void
}

export function handlers(container: Container): Record<string, (payload: unknown) => Promise<unknown>> {
  return {
    [CH.listProjects]: async (_payload: unknown) => {
      return container.registry.list()
    },

    [CH.registerProject]: async (payload: unknown) => {
      const req = payload as RegisterProjectReq
      const id = `proj-${Date.now()}`
      container.registry.register({
        id,
        name: req.name,
        status: 'active',
        projectType: req.projectType as 'git' | 'obsidian' | 'hybrid',
        repoPaths: req.repoPath ? [req.repoPath] : [],
        vaultPaths: [],
        sourcePaths: [],
      })
      return container.registry.get(id)
    },

    [CH.updateProject]: async (payload: unknown) => {
      const req = payload as UpdateProjectReq
      const existing = container.registry.get(req.id)
      if (!existing) throw new Error(`Project not found: ${req.id}`)
      container.registry.update({
        ...existing,
        name: req.name,
        projectType: req.projectType as 'git' | 'obsidian' | 'hybrid',
        repoPaths: req.repoPath ? [req.repoPath] : [],
      })
      return container.registry.get(req.id)
    },

    [CH.deleteProject]: async (payload: unknown) => {
      const req = payload as DeleteProjectReq
      container.registry.remove(req.id)
      return { ok: true }
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

    [CH.generateProject]: async (payload: unknown) => {
      const req = payload as GenerateProjectReq
      return container.generateProject(req)
    },

    [CH.harnessRun]: async (payload: unknown) => {
      return container.harnessRun(payload as HarnessRunReq)
    },

    [CH.harnessResume]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      return container.harnessResume(req)
    },

    [CH.harnessGetRun]: async (payload: unknown) => {
      return container.harnessGetRun(payload as HarnessGetRunReq)
    },

    [CH.harnessPromote]: async (payload: unknown) => {
      // strict parse: only the declared fields reach the service (no arbitrary flag injection)
      const req = z.object({ runId: z.string(), allowSecrets: z.boolean().optional(), allowInvalid: z.boolean().optional() }).strict().parse(payload)
      return container.harnessPromote(req)
    },

    [CH.harnessPromoteCanonical]: async (payload: unknown) => {
      const req = z.object({ runId: z.string(), proposalRelPath: z.string(), lastReadHash: z.string(), allowSecrets: z.boolean().optional(), allowInvalid: z.boolean().optional() }).strict().parse(payload)
      return container.harnessPromoteCanonical(req)
    },

    [CH.harnessCanonicalProposals]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      return container.harnessCanonicalProposals(req)
    },

    [CH.generateRun]: async (payload: unknown) => {
      const req = payload as GenerateRunReq
      const run = container.runs.get(req.runId)
      if (!run) throw new Error(`Agent run not found: ${req.runId}`)
      const adapter = container.ingestAdapters.find((a) => a.agentKind === req.agent)
      if (!adapter) throw new Error(`No ingest adapter for engine: ${req.agent}`)
      const source: AgentSource = {
        id: `${req.agent}:${req.transcriptPath}`,
        agentKind: req.agent,
        kind: req.agent === 'opencode' ? 'sqlite-session' : 'jsonl-file',
        locator: req.transcriptPath,
      }
      const { session } = await adapter.parseSource(source)
      return container.runService.completeRun({
        run,
        session,
        projectId: req.projectId,
        engine: req.engine,
        currentCanonical: req.currentCanonical,
        endedAt: new Date().toISOString(),
      })
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
