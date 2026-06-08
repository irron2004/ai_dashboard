import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, ProjectRegistry, IngestCursorStore } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore, ReviewService, VaultWriter } from '@apc/pm'
import { migrateHarness, TaskProfileStore } from '@apc/harness'
import { SearchIndex } from '@apc/search'
import { VaultAdapter } from '@apc/vault'
import { getProjectDashboard } from '@apc/dashboard-api'
import { IngestService, RunService, GenerateService, HarnessService } from '@apc/app-services'
import { WikiEngine, CliAgentRunner, type AgentRunner } from '@apc/llm-wiki'
import { ClaudeAdapter, CodexAdapter, OpenCodeAdapter, type AgentIngestAdapter } from '@apc/agents'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { generateRemote } from './remote-generate.js'
import type {
  GeneratePreflightCategory, GeneratePreflightReq, GeneratePreflightRes, GenerateProjectReq, GenerateProjectRes,
  GeneratePreflightCategoryId,
  HarnessRunReq, HarnessRunRes, HarnessResumeReq, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
  HarnessPromoteCanonicalReq, HarnessPromoteCanonicalRes, HarnessCanonicalProposalsReq, HarnessCanonicalProposalsRes,
} from '../shared/ipc-contract.js'

export type Container = {
  db: ReturnType<typeof openDb>
  registry: ProjectRegistry
  tasks: TaskStore
  runs: AgentRunStore
  reviews: ReviewService
  cursors: IngestCursorStore
  searchIndex: SearchIndex
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
  harnessGetRun: (req: HarnessGetRunReq) => HarnessGetRunRes
  harnessPromote: (req: HarnessPromoteReq) => HarnessPromoteRes
  harnessPromoteCanonical: (req: HarnessPromoteCanonicalReq) => HarnessPromoteCanonicalRes
  harnessCanonicalProposals: (req: HarnessCanonicalProposalsReq) => HarnessCanonicalProposalsRes
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
}): Container {
  const db = openDb(opts.dbFile)
  migrate(db)
  migratePm(db)
  migrateHarness(db)

  const searchDb = new DatabaseSync(':memory:')

  const registry = new ProjectRegistry(db)
  const tasks = new TaskStore(db)
  const runs = new AgentRunStore(db)
  const reviews = new ReviewService(db, tasks, nextId)
  const cursors = new IngestCursorStore(db)
  const searchIndex = new SearchIndex(searchDb)
  const vault = new VaultAdapter(opts.vaultRoot)
  const taskProfiles = new TaskProfileStore(db)
  const ingest = new IngestService({ registry, cursors, index: searchIndex })
  const ingestAdapters =
    opts.ingestAdapters ?? [new ClaudeAdapter(), new CodexAdapter(), new OpenCodeAdapter()]
  const vaultWriter = new VaultWriter(vault)
  const wiki = new WikiEngine(opts.agentRunner ?? new CliAgentRunner())
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

  // Knowledge Harness — shares the injected AgentRunner (FakeAgentRunner in tests, CliAgentRunner in prod).
  // runsRoot MUST live OUTSIDE the vault: StagingVault copies the whole vault into <runsRoot>/<id>/vault-staging,
  // so a runs dir nested inside the vault would make cpSync copy a directory into a subdirectory of itself.
  const harness = new HarnessService({
    runner: opts.agentRunner ?? new CliAgentRunner(),
    vaultRoot: opts.vaultRoot,
    runsRoot: opts.harnessRunsRoot ?? join(opts.vaultRoot, '..', 'apc-harness-runs'),
  })
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => {
    const project = registry.get(req.projectId)
    return harness.run({ projectId: req.projectId, engine: req.engine, materialize: req.materialize, repoPaths: project?.repoPaths ?? [] })
  }
  const harnessResume = (req: HarnessResumeReq): Promise<HarnessRunRes> => harness.resume(req)
  const harnessGetRun = (req: HarnessGetRunReq): HarnessGetRunRes => harness.show(req)
  const harnessPromote = (req: HarnessPromoteReq): HarnessPromoteRes => harness.promote(req)
  const harnessPromoteCanonical = (req: HarnessPromoteCanonicalReq): HarnessPromoteCanonicalRes => harness.promoteCanonical(req)
  const harnessCanonicalProposals = (req: HarnessCanonicalProposalsReq): HarnessCanonicalProposalsRes => harness.canonicalProposals(req)

  return {
    db, registry, tasks, runs, reviews, cursors, searchIndex, vault, taskProfiles,
    ingest, ingestAdapters, runService, generate, generatePreflight, generateProject,
    harness, harnessRun, harnessResume, harnessGetRun, harnessPromote, harnessPromoteCanonical, harnessCanonicalProposals,
    dashboard: getProjectDashboard,
  }
}
