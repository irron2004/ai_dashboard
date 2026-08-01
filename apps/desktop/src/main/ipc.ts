import { z } from 'zod'
import { join } from 'node:path'
import { CH, WIKI_GENERATION_ENGINE } from '../shared/ipc-contract.js'
import type {
  RegisterProjectReq, UpdateProjectReq, DeleteProjectReq, ProjectDashboardReq, SearchReq, SearchEvidenceReq, ListProfilesReq, TasksListReq,
  ProjectContextConfirmReq,
  TaskCreateReq, TaskUpdateReq, TaskDeleteReq,
  SubmitReviewReq, PromoteCurrentReq, SelectProfileReq, GenerateRunReq, GeneratePreflightReq, GenerateProjectReq,
  HarnessRunReq, HarnessGetRunReq, HarnessPromoteReq, HarnessConfirmNodesReq,
  HarnessSetReviewDecisionsReq, HarnessReadSourceExcerptReq,
  DevHarnessRunReq, DevHarnessCancelReq,
  ConfigEditReq, ConfigRollbackReq,
  ResumeCardReq, QuestionLogReq, ConversationHistoryReq, NextNoteAddReq, NextNoteToggleReq, NextNoteDeleteReq,
  NextNotesListReq, NextNoteUpdateReq, NextNoteSetPinnedReq, NextNoteSetLifecycleReq, NextNoteConvertToTaskReq,
  AgentActivitySnapshotReq, AgentQuestionReconcileReq,
  HarnessListRunsReq, HarnessGetProgressReq, HarnessReadLogReq,
  FileRefsResolveReq, FilePreviewReadReq, TerminalSetPreferencesReq, TerminalDiagnosticsReq,
  GitStatusReq, GitWorktreesReq, GitFetchReq, GitPullReq, GitCommitReq, GitPushReq,
  RetroPrepareReq, RetroAnswerReq, RetroTargetNotesReq, RetroCompleteReq, ReceiptIssueReq,
  GateQueryReq, GateInstallReq,
  ProjectImportReq, ProjectImportKind,
} from '../shared/ipc-contract.js'
import type { AgentSource } from '@apc/shared'
import {
  AgentKind,
  FilePreviewReadReqSchema,
  FileRefsResolveReqSchema,
  ProjectDomain,
  ProjectType,
  TaskStatus,
} from '@apc/shared'
import type { Container } from './container.js'
import { readProjectDoc, listProjectDocs } from './project-files.js'
import { diffProjectFile, listProjectChanges } from './project-changes.js'
import { listGitWorktrees } from './git-worktrees.js'
import { importProjectSources } from './project-import.js'

export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void
}

export type ProjectImportPicker = (request: {
  kind: ProjectImportKind
  projectName: string
  destination: string
}) => Promise<readonly string[] | null>

export type IpcHandlerOptions = {
  pickProjectImportSources?: ProjectImportPicker
}

const ProjectContextFields = {
  goal: z.string().max(20_000).optional(),
  currentFocus: z.string().max(4_000).optional(),
}
const TaskPriority = z.enum(['low', 'medium', 'high'])

function blockLegacyWikiContinuation(container: Container, runId: string) {
  const shown = container.harnessGetRun({ runId })
  if (!shown.ok || !shown.runState || shown.runState.engine === WIKI_GENERATION_ENGINE) return null
  return {
    ok: false,
    runId,
    finalState: shown.runState.state,
    reason: `이 run은 ${shown.runState.engine}로 생성되어 이어갈 수 없습니다. 새 Codex 위키 run을 시작하세요.`,
  }
}

/** A renderer-supplied cwd is accepted only if Git reports it as a worktree of the registered root. */
export async function resolveGitRepoPath(
  container: Container,
  projectId: string,
  worktreePath?: string,
): Promise<{ ok: true; repoPath: string } | { ok: false; reason: string }> {
  const project = container.registry.get(projectId)
  if (!project) return { ok: false, reason: 'project not found' }
  const base = project.repoPaths[0]
  if (!base) return { ok: false, reason: '등록된 repo 경로가 없습니다' }
  if (!worktreePath || worktreePath === base) return { ok: true, repoPath: base }
  const listed = await listGitWorktrees(base)
  const matched = listed.worktrees.find((worktree) => worktree.path === worktreePath)
  return matched
    ? { ok: true, repoPath: matched.path }
    : { ok: false, reason: `등록되지 않은 worktree 경로입니다: ${worktreePath}` }
}

export function handlers(
  container: Container,
  options: IpcHandlerOptions = {},
): Record<string, (payload: unknown) => Promise<unknown>> {
  return {
    [CH.listProjects]: async (_payload: unknown) => {
      return container.registry.list()
    },

    [CH.registerProject]: async (payload: unknown) => {
      const req = z.object({
        name: z.string().trim().min(1).max(500),
        projectType: ProjectType,
        repoPath: z.string().max(8_192),
        domain: ProjectDomain.optional(),
        ...ProjectContextFields,
      }).strict().parse(payload) as RegisterProjectReq
      const id = `proj-${Date.now()}`
      container.registry.register({
        id,
        name: req.name,
        status: 'active',
        projectType: req.projectType as 'git' | 'obsidian' | 'hybrid',
        repoPaths: req.repoPath ? [req.repoPath] : [],
        vaultPaths: [],
        sourcePaths: [],
        domain: (req.domain ?? 'project-docs') as 'project-docs' | 'paper',
        goal: req.goal?.trim() || undefined,
        currentFocus: req.currentFocus?.trim() || undefined,
      })
      container.invalidateResumeCards(id)
      return container.registry.get(id)
    },

    [CH.updateProject]: async (payload: unknown) => {
      const req = z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(500),
        projectType: ProjectType,
        repoPath: z.string().max(8_192),
        domain: ProjectDomain.optional(),
        ...ProjectContextFields,
      }).strict().parse(payload) as UpdateProjectReq
      const existing = container.registry.get(req.id)
      if (!existing) throw new Error(`Project not found: ${req.id}`)
      container.registry.update({
        ...existing,
        name: req.name,
        projectType: req.projectType as 'git' | 'obsidian' | 'hybrid',
        repoPaths: req.repoPath ? [req.repoPath] : [],
        domain: (req.domain ?? existing.domain) as 'project-docs' | 'paper',
      })
      const patch: { goal?: string | null; currentFocus?: string | null } = {}
      if (Object.prototype.hasOwnProperty.call(req, 'goal')) patch.goal = req.goal ?? null
      if (Object.prototype.hasOwnProperty.call(req, 'currentFocus')) patch.currentFocus = req.currentFocus ?? null
      if (Object.keys(patch).length > 0) container.registry.updateUserContext(req.id, patch)
      container.invalidateResumeCards(req.id)
      return container.registry.get(req.id)
    },

    [CH.projectContextConfirm]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1),
        field: z.enum(['goal', 'currentFocus']),
      }).strict().parse(payload) as ProjectContextConfirmReq
      const result = container.registry.confirmContext(req.projectId, req.field)
      if (result.ok) container.invalidateResumeCards(req.projectId)
      return result
    },

    [CH.deleteProject]: async (payload: unknown) => {
      const req = z.object({ id: z.string().min(1) }).strict().parse(payload) as DeleteProjectReq
      container.registry.remove(req.id)
      container.invalidateResumeCards(req.id)
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
      const req = z.object({
        query: z.string().max(20_000),
        projectId: z.string().trim().min(1).max(512).optional(),
      }).strict().parse(payload) as SearchReq
      return container.search(req)
    },

    [CH.searchEvidence]: async (payload: unknown) => {
      const req = z.object({
        query: z.string().trim().min(1).max(20_000),
        projectId: z.string().trim().min(1).max(512).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict().parse(payload) as SearchEvidenceReq
      return container.searchEvidence(req)
    },

    [CH.listProfiles]: async (payload: unknown) => {
      const req = payload as ListProfilesReq
      const { OpenCodeConfigAdapter } = await import('@apc/harness')
      return new OpenCodeConfigAdapter().discoverProfiles({ projectPath: req.projectPath })
    },

    [CH.tasksList]: async (payload: unknown) => {
      const req = payload as TasksListReq
      return container.tasks.listByProject(req.projectId)
    },

    [CH.workspaceOverview]: async (_payload: unknown) => {
      return container.workspaceOverview()
    },

    [CH.configPreview]: async (payload: unknown) => {
      const req = payload as ConfigEditReq
      const { AgentConfigEditor } = await import('@apc/harness')
      return new AgentConfigEditor().previewEdit(req.rawConfigPath, req.rawFormat, req.profileName, req.edits)
    },
    [CH.configApply]: async (payload: unknown) => {
      const req = payload as ConfigEditReq
      const { AgentConfigEditor } = await import('@apc/harness')
      return new AgentConfigEditor().applyEdit(req.rawConfigPath, req.rawFormat, req.profileName, req.edits)
    },
    [CH.configRollback]: async (payload: unknown) => {
      const req = payload as ConfigRollbackReq
      const { AgentConfigEditor } = await import('@apc/harness')
      return new AgentConfigEditor().rollbackConfig(req.rawConfigPath)
    },

    [CH.ingestAll]: async (_payload: unknown) => {
      const r = await container.ingest.ingestAll(container.ingestAdapters)
      container.invalidateResumeCards()
      return r
    },

    [CH.generatePreflight]: async (payload: unknown) => {
      const req = payload as GeneratePreflightReq
      return container.generatePreflight(req)
    },

    [CH.generateProject]: async (payload: unknown) => {
      const req = payload as GenerateProjectReq
      return container.generateProject({ ...req, engine: WIKI_GENERATION_ENGINE })
    },

    [CH.harnessRun]: async (payload: unknown) => {
      const req = payload as HarnessRunReq
      return container.harnessRun({ ...req, engine: WIKI_GENERATION_ENGINE })
    },

    [CH.harnessResume]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      const blocked = blockLegacyWikiContinuation(container, req.runId)
      if (blocked) return blocked
      return container.harnessResume(req)
    },

    [CH.harnessConfirmNodes]: async (payload: unknown) => {
      const nodeSchema = z.object({ id: z.string().optional(), title: z.string(), type: z.string().optional(), source_proposal_id: z.string().optional() })
      const req = z.object({ runId: z.string(), approvedNodes: z.object({ nodes: z.array(nodeSchema) }) }).strict().parse(payload)
      const blocked = blockLegacyWikiContinuation(container, req.runId)
      if (blocked) return blocked
      return container.harnessConfirmNodes(req as HarnessConfirmNodesReq)
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

    [CH.harnessSetReviewDecisions]: async (payload: unknown) => {
      const decision = z.object({
        proposal_id: z.string().min(1),
        verdict: z.enum(['approved', 'excluded']),
        decided_at: z.string().min(1),
      }).strict()
      const req = z.object({
        runId: z.string().min(1).max(512),
        decisions: z.array(decision),
      }).strict().parse(payload) as HarnessSetReviewDecisionsReq
      return container.harnessSetReviewDecisions(req)
    },

    [CH.harnessProposePolicy]: async (payload: unknown) => {
      // strict parse: engine + repoPaths flow into the LLM runner, so validate at the boundary
      const req = z.object({ projectId: z.string(), engine: AgentKind, repoPaths: z.array(z.string()).optional() }).strict().parse(payload)
      return container.harnessProposePolicy({ ...req, engine: WIKI_GENERATION_ENGINE })
    },

    [CH.harnessApprovePolicy]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      return container.harnessApprovePolicy(req)
    },

    [CH.harnessGetPolicy]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      return container.harnessGetPolicy(req)
    },

    [CH.harnessRevertPolicy]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      return container.harnessRevertPolicy(req)
    },

    [CH.harnessReadStagedDoc]: async (payload: unknown) => {
      const req = z.object({ runId: z.string(), relPath: z.string() }).strict().parse(payload)
      return container.harnessReadStagedDoc(req)
    },

    [CH.harnessListStagedDocs]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      return container.harnessListStagedDocs(req)
    },

    [CH.harnessReadGraphEdges]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      return container.harnessReadGraphEdges(req)
    },

    [CH.readProjectWiki]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      return container.readProjectWiki(req)
    },

    [CH.harnessExportWiki]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      return container.harnessExportWiki(req)
    },
    [CH.devHarnessRun]: async (payload: unknown) => container.devHarnessRun(payload as DevHarnessRunReq),
    [CH.devHarnessCancel]: async (payload: unknown) => container.devHarnessCancel(payload as DevHarnessCancelReq),

    [CH.composeContext]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), taskId: z.string() }).strict().parse(payload)
      return container.composeContext(req)
    },

    [CH.devHarnessReadTranscript]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      return container.devHarnessReadTranscript(req)
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
        engine: WIKI_GENERATION_ENGINE,
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

    [CH.taskSetBlockedBy]: async (payload: unknown) => {
      const req = z.object({ taskId: z.string(), blockedBy: z.array(z.string()) }).strict().parse(payload)
      return container.taskSetBlockedBy(req)
    },

    [CH.taskCreate]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1),
        title: z.string().max(20_000),
        status: TaskStatus.optional(),
        priority: TaskPriority.optional(),
        dueDate: z.string().max(32).optional(),
      }).strict().parse(payload) as TaskCreateReq
      return container.taskCreate(req)
    },
    [CH.taskUpdate]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1),
        taskId: z.string().min(1),
        title: z.string().max(20_000),
        status: TaskStatus,
        priority: TaskPriority,
        dueDate: z.string().max(32).optional(),
      }).strict().parse(payload) as TaskUpdateReq
      return container.taskUpdate(req)
    },
    [CH.taskDelete]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), taskId: z.string().min(1) })
        .strict().parse(payload) as TaskDeleteReq
      return container.taskDelete(req)
    },

    [CH.resumeCard]: async (payload: unknown) => {
      return container.resumeCard(payload as ResumeCardReq)
    },
    [CH.questionLog]: async (payload: unknown) => {
      return container.questionLog(payload as QuestionLogReq)
    },
    [CH.conversationHistory]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1),
        agent: AgentKind,
        includeOlder: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict().parse(payload) as ConversationHistoryReq
      return container.conversationHistory(req)
    },
    [CH.nextNoteAdd]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), text: z.string().max(20_000) })
        .strict().parse(payload) as NextNoteAddReq
      return container.nextNoteAdd(req)
    },
    [CH.nextNoteToggle]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), id: z.string().min(1), done: z.boolean() })
        .strict().parse(payload) as NextNoteToggleReq
      return container.nextNoteToggle(req)
    },
    [CH.nextNoteDelete]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), id: z.string().min(1) })
        .strict().parse(payload) as NextNoteDeleteReq
      return container.nextNoteDelete(req)
    },
    [CH.nextNotesList]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1),
        includeCompleted: z.boolean().optional(),
        includeArchived: z.boolean().optional(),
      }).strict().parse(payload) as NextNotesListReq
      return container.nextNotesList(req)
    },
    [CH.nextNoteUpdate]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), noteId: z.string().min(1), text: z.string().max(20_000) })
        .strict().parse(payload) as NextNoteUpdateReq
      return container.nextNoteUpdate(req)
    },
    [CH.nextNoteSetPinned]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), noteId: z.string().min(1), pinned: z.boolean() })
        .strict().parse(payload) as NextNoteSetPinnedReq
      return container.nextNoteSetPinned(req)
    },
    [CH.nextNoteSetLifecycle]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1),
        noteId: z.string().min(1),
        lifecycle: z.enum(['active', 'completed', 'archived']),
      }).strict().parse(payload) as NextNoteSetLifecycleReq
      return container.nextNoteSetLifecycle(req)
    },
    [CH.nextNoteConvertToTask]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1),
        noteId: z.string().min(1),
        title: z.string().max(20_000).optional(),
        priority: TaskPriority.optional(),
        dueDate: z.string().max(32).optional(),
      }).strict().parse(payload) as NextNoteConvertToTaskReq
      return container.nextNoteConvertToTask(req)
    },

    [CH.agentActivitySnapshot]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1).optional() })
        .strict().parse(payload ?? {}) as AgentActivitySnapshotReq
      return container.agentActivitySnapshot(req)
    },
    [CH.agentQuestionReconcile]: async (payload: unknown) => {
      const req = z.object({
        paneId: z.string().min(1).max(2_048),
        launchId: z.string().min(1).max(2_048),
        sessionId: z.string().min(1).max(8_192).optional(),
      }).strict().parse(payload) as AgentQuestionReconcileReq
      return container.agentQuestionReconcile(req)
    },

    [CH.harnessListRuns]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1).max(2_048),
        limit: z.number().int().min(1).max(200).optional(),
      }).strict().parse(payload) as HarnessListRunsReq
      return container.harnessListRuns(req)
    },
    [CH.harnessGetProgress]: async (payload: unknown) => {
      const req = z.object({ runId: z.string().min(1).max(512) })
        .strict().parse(payload) as HarnessGetProgressReq
      return container.harnessGetProgress(req)
    },
    [CH.harnessReadLog]: async (payload: unknown) => {
      const req = z.object({
        runId: z.string().min(1).max(512),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(256 * 1024).optional(),
      }).strict().parse(payload) as HarnessReadLogReq
      return container.harnessReadLog(req)
    },
    [CH.harnessReadSourceExcerpt]: async (payload: unknown) => {
      const req = z.object({
        runId: z.string().min(1).max(512),
        sourcePath: z.string().min(1).max(8_192),
        quote: z.string().max(100_000).optional(),
      }).strict().parse(payload) as HarnessReadSourceExcerptReq
      return container.harnessReadSourceExcerpt(req)
    },

    [CH.fileRefsResolve]: async (payload: unknown) => {
      const req = FileRefsResolveReqSchema.parse(payload) as FileRefsResolveReq
      return container.fileRefsResolve(req)
    },
    [CH.filePreviewRead]: async (payload: unknown) => {
      const req = FilePreviewReadReqSchema.parse(payload) as FilePreviewReadReq
      return container.filePreviewRead(req)
    },
    [CH.clipboardReadText]: async (payload: unknown) => {
      z.undefined().parse(payload)
      return container.clipboardReadText()
    },
    [CH.terminalGetPreferences]: async (payload: unknown) => {
      z.undefined().parse(payload)
      return container.terminalGetPreferences()
    },
    [CH.terminalSetPreferences]: async (payload: unknown) => {
      const req = z.object({
        fontFamily: z.string().trim().min(1).max(1_024).optional(),
        fontSize: z.number().finite().min(8).max(32).optional(),
      }).strict().parse(payload) as TerminalSetPreferencesReq
      return container.terminalSetPreferences(req)
    },
    [CH.terminalDiagnostics]: async (payload: unknown) => {
      const req = z.object({ cwd: z.string().min(1).max(8_192) })
        .strict().parse(payload) as TerminalDiagnosticsReq
      return container.terminalDiagnostics(req)
    },

    [CH.fsReadDoc]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), relPath: z.string() }).strict().parse(payload)
      const project = container.registry.get(req.projectId)
      if (!project) return { ok: false, reason: 'project not found' }
      // Resolution order: vault project area (current.md etc.) → repoPaths → registered vaultPaths
      const roots = [join(container.vaultRoot, 'projects', project.id), ...project.repoPaths, ...project.vaultPaths]
      return readProjectDoc(roots, req.relPath)
    },

    [CH.fsListDocs]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      const project = container.registry.get(req.projectId)
      if (!project) return { docs: [] }
      // repoPaths only by design: vault-area docs (generated wiki, current.md) are surfaced via run
      // artifacts and the Home tab, not this project-doc listing. fsReadDoc still serves vault paths.
      return { docs: listProjectDocs(project.repoPaths) }
    },

    [CH.projectImport]: async (payload: unknown) => {
      const req = z.object({
        projectId: z.string().min(1).max(2_048),
        kind: z.enum(['files', 'folder']),
        worktreePath: z.string().min(1).max(8_192).optional(),
      }).strict().parse(payload) as ProjectImportReq
      const project = container.registry.get(req.projectId)
      if (!project) return { ok: false, reason: '프로젝트를 찾을 수 없습니다' }
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      if (resolved.repoPath.startsWith('ssh://')) {
        return { ok: false, reason: 'SSH 프로젝트로의 파일 가져오기는 아직 지원하지 않습니다' }
      }
      if (!options.pickProjectImportSources) {
        return { ok: false, reason: '파일 선택 기능을 사용할 수 없습니다' }
      }

      try {
        const selected = await options.pickProjectImportSources({
          kind: req.kind,
          projectName: project.name,
          destination: resolved.repoPath,
        })
        if (!selected || selected.length === 0) return { ok: true, canceled: true, items: [] }
        return importProjectSources(resolved.repoPath, selected, req.kind)
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },

    [CH.changesList]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      const project = container.registry.get(req.projectId)
      if (!project) return { ok: false, reason: 'project not found' }
      // NOTE: global MAX, not project-scoped. `ingest_cursors.source_id` is an opaque adapter string
      // (e.g. `opencode:<dbPath>#session:<id>`) with no FK to a project — source→project is resolved at
      // ingest time via repoPath, not stored — so there's no clean per-project join here. Ingestion also
      // runs globally (one pass over all sources). This over-suppresses `unreflected` for a project that
      // trails a more-recently-ingested one; proper per-project scoping needs a schema/semantic change.
      const row = container.db.prepare('SELECT MAX(updated_at) AS at FROM ingest_cursors').get() as { at: string | null } | undefined
      return listProjectChanges(project.repoPaths, row?.at ?? null)
    },

    [CH.changesDiff]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), relPath: z.string() }).strict().parse(payload)
      const project = container.registry.get(req.projectId)
      if (!project) return { ok: false, reason: 'project not found' }
      return diffProjectFile(project.repoPaths, req.relPath)
    },

    [CH.gitStatus]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), fetch: z.boolean().optional(), worktreePath: z.string().optional() }).strict().parse(payload) as GitStatusReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason, detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] }
      return container.gitSync.status(resolved.repoPath, { fetch: req.fetch })
    },

    [CH.gitWorktrees]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload) as GitWorktreesReq
      const project = container.registry.get(req.projectId)
      if (!project) return { ok: false, worktrees: [], reason: 'project not found' }
      return listGitWorktrees(project.repoPaths[0] ?? '')
    },

    [CH.gitFetch]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GitFetchReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gitSync.fetch(resolved.repoPath)
    },

    [CH.gitPull]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GitPullReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gitSync.pull(resolved.repoPath)
    },

    [CH.gitCommit]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), files: z.array(z.string()), message: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GitCommitReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gitSync.commit(resolved.repoPath, req.files, req.message)
    },

    [CH.gitPush]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GitPushReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gitSync.push(resolved.repoPath, {
        // GitSyncService fetches/rebases first. Checking here binds authorization to the final HEAD,
        // rather than to the pre-rebase SHA the renderer last displayed.
        beforePush: async (repoPath) => {
          const status = await container.gate.status(repoPath)
          if (!status.ok) return { ok: false, reason: '⛔ Learning Gate 상태를 확인할 수 없어 Push를 중단했습니다' }
          if (status.enabled && !status.headCovered) {
            return { ok: false, reason: '⛔ 리뷰되지 않은 커밋이 있습니다 — 회고 탭에서 해당 HEAD의 Receipt를 발급하세요' }
          }
          return { ok: true }
        },
      })
    },

    [CH.retroPrepare]: async (payload: unknown) => {
      const req = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        targets: z.array(z.object({
          projectId: z.string().min(1),
          worktreePath: z.string().min(1).optional(),
        }).strict()).max(100),
      }).strict().parse(payload) as RetroPrepareReq
      const targets: RetroPrepareReq['targets'] = []
      const seen = new Set<string>()
      for (const target of req.targets) {
        const resolved = await resolveGitRepoPath(container, target.projectId, target.worktreePath)
        if (!resolved.ok) return { ok: false, reason: resolved.reason }
        const key = target.projectId + '\0' + resolved.repoPath
        if (seen.has(key)) continue
        seen.add(key)
        targets.push({ projectId: target.projectId, worktreePath: resolved.repoPath })
      }
      return { ok: true, ...await container.retroService.prepare(req.date, targets) }
    },

    [CH.retroAnswer]: async (payload: unknown) => {
      const req = z.object({
        questionId: z.string().min(1),
        answer: z.string().max(20_000).optional(),
        skipped: z.boolean().optional(),
      }).strict().parse(payload) as RetroAnswerReq
      const ok = container.retroStore.answer(req.questionId, req.answer ?? null, req.skipped ?? false)
      return ok ? { ok: true } : { ok: false, reason: '질문을 찾을 수 없거나 이미 Receipt로 확정된 대상입니다' }
    },

    [CH.retroTargetNotes]: async (payload: unknown) => {
      const req = z.object({
        targetId: z.string().min(1),
        verificationEvidence: z.string().max(20_000),
        riskNotes: z.string().max(20_000),
      }).strict().parse(payload) as RetroTargetNotesReq
      return container.retroService.updateTargetNotes(req.targetId, req.verificationEvidence, req.riskNotes)
    },

    [CH.retroComplete]: async (payload: unknown) => {
      const req = z.object({ retroId: z.string().min(1) }).strict().parse(payload) as RetroCompleteReq
      return container.retroService.complete(req.retroId)
    },

    [CH.receiptIssue]: async (payload: unknown) => {
      const req = z.object({ targetId: z.string().min(1) }).strict().parse(payload) as ReceiptIssueReq
      return container.retroService.issueReceipt(req.targetId)
    },

    [CH.gateStatus]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), worktreePath: z.string().min(1).optional() }).strict().parse(payload) as GateQueryReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) {
        return { ok: false, reason: resolved.reason, enabled: false, hookInstalled: false, headSha: null, headCovered: false, reviewedCount: 0 }
      }
      return container.gate.status(resolved.repoPath)
    },

    [CH.gateInstall]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string().min(1), worktreePath: z.string().min(1).optional() }).strict().parse(payload) as GateInstallReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gate.installHook(resolved.repoPath)
    },
  }
}

export function registerIpc(ipcMain: IpcMainLike, container: Container, options: IpcHandlerOptions = {}): void {
  for (const [ch, fn] of Object.entries(handlers(container, options))) {
    ipcMain.handle(ch, (_e, payload) => fn(payload))
  }
}
