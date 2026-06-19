import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, ProjectRegistry, IngestCursorStore } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore, ReviewService, VaultWriter } from '@apc/pm'
import { migrateHarness, TaskProfileStore } from '@apc/harness'
import { migrateKnowledge, KnowledgeStore, KnowledgeRetrieval, ProcessedSourceStore } from '@apc/knowledge'
import { SearchIndex } from '@apc/search'
import { VaultAdapter } from '@apc/vault'
import { getProjectDashboard } from '@apc/dashboard-api'
import { IngestService, RunService, GenerateService, HarnessService, KnowledgeIndexer, LocalWorkspaceVault, type WorkspaceVault } from '@apc/app-services'
import { WikiEngine, type AgentRunner } from '@apc/llm-wiki'
import { RoutingAgentRunner } from './ssh-agent-runner.js'
import { SshWorkspaceVault } from './remote-vault.js'
import { UnifiedSearch } from './unified-search.js'
import { ClaudeAdapter, CodexAdapter, OpenCodeAdapter, type AgentIngestAdapter } from '@apc/agents'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { generateRemote } from './remote-generate.js'
import { fetchRemoteProjectDocs } from './remote-docs.js'
import { fetchRemoteConversations } from './remote-conversations.js'
import type {
  GeneratePreflightCategory, GeneratePreflightReq, GeneratePreflightRes, GenerateProjectReq, GenerateProjectRes,
  GeneratePreflightCategoryId,
  HarnessRunReq, HarnessRunRes, HarnessResumeReq, HarnessConfirmNodesReq, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
  HarnessPromoteCanonicalReq, HarnessPromoteCanonicalRes, HarnessCanonicalProposalsReq, HarnessCanonicalProposalsRes,
  HarnessProposePolicyReq, HarnessProposePolicyRes, HarnessApprovePolicyReq, HarnessApprovePolicyRes,
  HarnessGetPolicyReq, HarnessGetPolicyRes, HarnessRevertPolicyReq, HarnessRevertPolicyRes,
  HarnessReadStagedDocReq, HarnessReadStagedDocRes, HarnessListStagedDocsReq, HarnessListStagedDocsRes,
  HarnessExportWikiReq, HarnessExportWikiRes,
  HarnessEngineLogEvent, HarnessNodesEvent,
  SearchReq,
} from '../shared/ipc-contract.js'
import type { UnifiedSearchResponse } from '@apc/shared'

/** Coalesces chunks for the same label/stream into 50ms batches so a chatty engine cannot flood the renderer. */
function batchEngineLog(emit?: (e: HarnessEngineLogEvent) => void): ((e: HarnessEngineLogEvent) => void) | undefined {
  if (!emit) return undefined
  let pending = new Map<string, HarnessEngineLogEvent>()
  let timer: ReturnType<typeof setTimeout> | null = null
  return (e) => {
    const key = `${e.label} ${e.stream}`
    const prev = pending.get(key)
    if (prev) prev.chunk += e.chunk
    else pending.set(key, { ...e })
    if (!timer) {
      timer = setTimeout(() => {
        const batch = [...pending.values()]; pending = new Map(); timer = null
        for (const ev of batch) emit(ev)
      }, 50)
    }
  }
}

export type Container = {
  vaultRoot: string
  db: ReturnType<typeof openDb>
  registry: ProjectRegistry
  tasks: TaskStore
  runs: AgentRunStore
  reviews: ReviewService
  cursors: IngestCursorStore
  searchIndex: SearchIndex
  search: (req: SearchReq) => UnifiedSearchResponse
  vault: VaultAdapter
  taskProfiles: TaskProfileStore
  ingest: IngestService
  ingestAdapters: AgentIngestAdapter[]
  runService: RunService
  generate: GenerateService
  /** Count selectable Generate inputs without parsing sessions or invoking an LLM. */
  generatePreflight: (req: GeneratePreflightReq) => Promise<GeneratePreflightRes>
  /** Branches on project kind: ssh:// → run the engine on the remote; local → GenerateService. */
  generateProject: (req: GenerateProjectReq) => Promise<GenerateProjectRes>
  harness: HarnessService
  harnessRun: (req: HarnessRunReq) => Promise<HarnessRunRes>
  harnessResume: (req: HarnessResumeReq) => Promise<HarnessRunRes>
  harnessConfirmNodes: (req: HarnessConfirmNodesReq) => Promise<HarnessRunRes>
  harnessGetRun: (req: HarnessGetRunReq) => HarnessGetRunRes
  harnessPromote: (req: HarnessPromoteReq) => Promise<HarnessPromoteRes>
  harnessPromoteCanonical: (req: HarnessPromoteCanonicalReq) => Promise<HarnessPromoteCanonicalRes>
  harnessCanonicalProposals: (req: HarnessCanonicalProposalsReq) => HarnessCanonicalProposalsRes
  harnessProposePolicy: (req: HarnessProposePolicyReq) => Promise<HarnessProposePolicyRes>
  harnessApprovePolicy: (req: HarnessApprovePolicyReq) => HarnessApprovePolicyRes
  harnessGetPolicy: (req: HarnessGetPolicyReq) => HarnessGetPolicyRes
  harnessRevertPolicy: (req: HarnessRevertPolicyReq) => HarnessRevertPolicyRes
  harnessReadStagedDoc: (req: HarnessReadStagedDocReq) => HarnessReadStagedDocRes
  harnessListStagedDocs: (req: HarnessListStagedDocsReq) => HarnessListStagedDocsRes
  harnessExportWiki: (req: HarnessExportWikiReq) => Promise<HarnessExportWikiRes>
  dashboard: typeof getProjectDashboard
}

let _idCounter = 0
function nextId(): string {
  return `auto-${Date.now()}-${++_idCounter}`
}

const PREFLIGHT_MARKDOWN_SCAN_LIMIT = 2_000
const PREFLIGHT_MARKDOWN_DEPTH_LIMIT = 12
const REQUIRED_GENERATE_PREFLIGHT_CATEGORIES: GeneratePreflightCategoryId[] = ['agent-conversations']

function countMarkdownFiles(roots: readonly string[]): number {
  const seen = new Set<string>()
  const visit = (path: string, depth: number): void => {
    if (seen.size >= PREFLIGHT_MARKDOWN_SCAN_LIMIT || depth > PREFLIGHT_MARKDOWN_DEPTH_LIMIT) return
    let st: import('node:fs').Stats | undefined
    try { st = statSync(path, { throwIfNoEntry: false }) } catch { return }
    if (!st) return
    if (st.isFile()) {
      if (/\.mdx?$/i.test(path)) seen.add(path)
      return
    }
    if (!st.isDirectory()) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      visit(join(path, entry.name), depth + 1)
      if (seen.size >= PREFLIGHT_MARKDOWN_SCAN_LIMIT) return
    }
  }
  for (const root of roots) visit(root, 0)
  return seen.size
}

function missingRequiredGenerateCategories(selected: readonly GeneratePreflightCategoryId[] | undefined): GeneratePreflightCategoryId[] {
  if (!selected) return REQUIRED_GENERATE_PREFLIGHT_CATEGORIES
  return REQUIRED_GENERATE_PREFLIGHT_CATEGORIES.filter((category) => !selected.includes(category))
}

export function buildContainer(opts: {
  dbFile: string
  vaultRoot: string
  ingestAdapters?: AgentIngestAdapter[]
  agentRunner?: AgentRunner
  /** runs/ root for harness artifacts; defaults to <vaultRoot>/.harness-runs. */
  harnessRunsRoot?: string
  emitHarnessProgress?: (e: { runId: string; state: string }) => void
  emitHarnessEngineLog?: (e: HarnessEngineLogEvent) => void
  emitHarnessNodes?: (e: HarnessNodesEvent) => void
}): Container {
  const db = openDb(opts.dbFile)
  migrate(db)
  migratePm(db)
  migrateHarness(db)
  migrateKnowledge(db)

  const searchDb = new DatabaseSync(':memory:')

  const registry = new ProjectRegistry(db)
  const tasks = new TaskStore(db)
  const runs = new AgentRunStore(db)
  const reviews = new ReviewService(db, tasks, nextId)
  const cursors = new IngestCursorStore(db)
  const searchIndex = new SearchIndex(searchDb)
  const knowledgeStore = new KnowledgeStore(db)
  const knowledgeRetrieval = new KnowledgeRetrieval(db)
  const processedSources = new ProcessedSourceStore(db)
  const unifiedSearch = new UnifiedSearch({
    sessions: searchIndex,
    knowledge: knowledgeRetrieval,
    projectIds: () => registry.list().map((p) => p.id),
  })
  const search = (req: SearchReq): UnifiedSearchResponse => unifiedSearch.search(req)
  const vault = new VaultAdapter(opts.vaultRoot)
  const taskProfiles = new TaskProfileStore(db)
  const ingest = new IngestService({
    registry,
    cursors,
    index: searchIndex,
    knowledge: new KnowledgeIndexer({ registry, store: knowledgeStore, vaultRoot: opts.vaultRoot }),
  })
  const ingestAdapters =
    opts.ingestAdapters ?? [new ClaudeAdapter(), new CodexAdapter(), new OpenCodeAdapter()]
  const vaultWriter = new VaultWriter(vault)
  const wiki = new WikiEngine(opts.agentRunner ?? new RoutingAgentRunner())
  const runService = new RunService({ wiki, vaultWriter, tasks, runs })
  const generate = new GenerateService({ adapters: ingestAdapters, registry, vault, vaultWriter, wiki })
  const generatePreflight = async (req: GeneratePreflightReq): Promise<GeneratePreflightRes> => {
    const project = registry.get(req.projectId)
    if (!project) return { ok: false, reason: 'project not found' }

    const allTasks = tasks.listByProject(project.id)
    const reviewRuns = allTasks.reduce((count, task) => count + runs.listByTask(task.id).length, 0)
    const vaultRoots = [...project.vaultPaths, join(opts.vaultRoot, 'projects', project.id)]
    const projectDocCount = countMarkdownFiles(vaultRoots)
    const agentSourceCount = await generate.countProjectSources(project.id)

    const categories: GeneratePreflightCategory[] = [
      {
        id: 'agent-conversations',
        label: 'LLM CLI conversations',
        description: 'Recent Claude, OpenCode, and Codex session sources used to build the work summary.',
        count: agentSourceCount,
        selectedByDefault: agentSourceCount > 0,
        required: true,
      },
      {
        id: 'project-docs',
        label: 'Project docs',
        description: 'Markdown documents found in this project vault area and registered vault paths.',
        count: projectDocCount,
        selectedByDefault: projectDocCount > 0,
      },
      {
        id: 'tasks',
        label: 'Tasks',
        description: 'Tracked todo, in-progress, review, and completed tasks for this project.',
        count: allTasks.length,
        selectedByDefault: allTasks.length > 0,
      },
      {
        id: 'review-runs',
        label: 'Agent runs / reviews',
        description: 'Recorded agent runs linked to this project’s tasks.',
        count: reviewRuns,
        selectedByDefault: reviewRuns > 0,
      },
    ]

    return {
      ok: true,
      projectId: project.id,
      projectName: project.name,
      categories,
      totalCount: categories.reduce((sum, category) => sum + category.count, 0),
      status: 'Scanned registered project docs, task metadata, run metadata, and available local agent sources.',
    }
  }
  const generateProject = (req: GenerateProjectReq): Promise<GenerateProjectRes> => {
    const missingRequired = missingRequiredGenerateCategories(req.selectedPreflightCategoryIds)
    if (missingRequired.length > 0) {
      return Promise.resolve({ ok: false, reason: 'Run Generate preflight and keep LLM CLI conversations selected for the current workflow.' })
    }
    const project = registry.get(req.projectId)
    if (project?.repoPaths[0]?.startsWith('ssh://')) {
      return generateRemote({ registry, vault, vaultWriter }, req)
    }
    return generate.generateForProject(req)
  }

  // Knowledge Harness — shares the injected AgentRunner (FakeAgentRunner in tests, RoutingAgentRunner in prod:
  // SSH for ssh:// projects, local CliAgentRunner otherwise).
  // runsRoot MUST live OUTSIDE the vault: StagingVault copies the whole vault into <runsRoot>/<id>/vault-staging,
  // so a runs dir nested inside the vault would make cpSync copy a directory into a subdirectory of itself.
  // The wiki's home lives IN each project's workspace: `<repo>/.apc-wiki` (internal state) +
  // `<repo>/wiki` (published). ssh:// projects keep a local working copy under this cache (verification
  // needs local files) that pull/push sync to the remote; local projects use `<repo>/.apc-wiki` directly.
  const workspaceCacheRoot = join(opts.vaultRoot, '..', 'apc-workspace-cache')
  const workspaceVaultFor = (projectId: string): WorkspaceVault | undefined => {
    const repo = registry.get(projectId)?.repoPaths?.[0]
    if (!repo) return undefined
    return repo.startsWith('ssh://')
      ? new SshWorkspaceVault(repo, projectId, workspaceCacheRoot)
      : new LocalWorkspaceVault(repo, projectId)
  }

  const harness = new HarnessService({
    runner: opts.agentRunner ?? new RoutingAgentRunner(),
    vaultRoot: opts.vaultRoot,
    runsRoot: opts.harnessRunsRoot ?? join(opts.vaultRoot, '..', 'apc-harness-runs'),
    workspaceVaultFor,
    // "전 문서로 위키 생성"의 materialize 단계가 이 프로젝트의 에이전트 대화도 Q&A 단위로 청킹하도록.
    conversationAdapters: ingestAdapters,
    // 이미 처리한 소스 문서는 재실행/재요청 시 건너뛰도록(변경된 문서만 재처리). wiki_processed_sources 테이블 기반.
    sourceLedger: processedSources,
    // ssh:// 프로젝트의 문서를 원격에서 raw/로 가져온다(로컬 fs로는 읽을 수 없으므로). 이게 없으면 SSH
    // 프로젝트는 raw/가 비어 EvidenceVerifier가 전부 막힌다.
    fetchRemoteDocs: fetchRemoteProjectDocs,
    // ssh:// 프로젝트면 대화 로그도 원격에서 가져온다(로컬 PC의 ~/.claude 등을 읽지 않도록).
    remoteConversationFetcher: fetchRemoteConversations,
  })
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => {
    const project = registry.get(req.projectId)
    return harness.run(
      { projectId: req.projectId, engine: req.engine, materialize: req.materialize, repoPaths: project?.repoPaths ?? [], engineOptions: req.engineOptions, workerConcurrency: req.workerConcurrency, fullRegen: req.fullRegen },
      (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }),
      batchEngineLog(opts.emitHarnessEngineLog),
      (e) => opts.emitHarnessNodes?.(e),
    )
  }
  const harnessResume = (req: HarnessResumeReq): Promise<HarnessRunRes> => harness.resume(req)
  const harnessConfirmNodes = (req: HarnessConfirmNodesReq): Promise<HarnessRunRes> => harness.confirmNodes(req)
  const harnessGetRun = (req: HarnessGetRunReq): HarnessGetRunRes => harness.show(req)
  // Promote writes into the local working vault; persist it to the workspace so an ssh project's next
  // run (which re-pulls and wipes the working copy) doesn't lose the approved draft. Best-effort — a
  // failed sync leaves the local promote intact, and a later export retries the push.
  const harnessPromote = async (req: HarnessPromoteReq): Promise<HarnessPromoteRes> => {
    const r = harness.promote(req)
    if (r.ok) { try { await harness.syncWorkspaceForRun(req.runId) } catch { /* export will retry */ } }
    return r
  }
  const harnessPromoteCanonical = async (req: HarnessPromoteCanonicalReq): Promise<HarnessPromoteCanonicalRes> => {
    const r = harness.promoteCanonical(req)
    if (r.ok) { try { await harness.syncWorkspaceForRun(req.runId) } catch { /* export will retry */ } }
    return r
  }
  const harnessCanonicalProposals = (req: HarnessCanonicalProposalsReq): HarnessCanonicalProposalsRes => harness.canonicalProposals(req)
  const harnessProposePolicy = (req: HarnessProposePolicyReq): Promise<HarnessProposePolicyRes> => harness.proposeWikiPolicy(req)
  const harnessApprovePolicy = (req: HarnessApprovePolicyReq): HarnessApprovePolicyRes => harness.approveWikiPolicy(req)
  const harnessGetPolicy = (req: HarnessGetPolicyReq): HarnessGetPolicyRes => harness.getWikiPolicy(req)
  const harnessRevertPolicy = (req: HarnessRevertPolicyReq): HarnessRevertPolicyRes => harness.revertWikiPolicy(req)
  const harnessReadStagedDoc = (req: HarnessReadStagedDocReq): HarnessReadStagedDocRes => harness.readStagedDoc(req)
  const harnessListStagedDocs = (req: HarnessListStagedDocsReq): HarnessListStagedDocsRes => harness.listStagedDocs(req)
  const harnessExportWiki = (req: HarnessExportWikiReq): Promise<HarnessExportWikiRes> => harness.exportWiki(req)

  return {
    vaultRoot: opts.vaultRoot,
    db, registry, tasks, runs, reviews, cursors, searchIndex, search, vault, taskProfiles,
    ingest, ingestAdapters, runService, generate, generatePreflight, generateProject,
    harness, harnessRun, harnessResume, harnessConfirmNodes, harnessGetRun, harnessPromote, harnessPromoteCanonical, harnessCanonicalProposals,
    harnessProposePolicy, harnessApprovePolicy, harnessGetPolicy, harnessRevertPolicy, harnessReadStagedDoc, harnessListStagedDocs, harnessExportWiki,
    dashboard: getProjectDashboard,
  }
}
