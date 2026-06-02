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
import { join } from 'node:path'
import { generateRemote } from './remote-generate.js'
import type {
  GenerateProjectReq, GenerateProjectRes,
  HarnessRunReq, HarnessRunRes, HarnessGetRunReq, HarnessGetRunRes, HarnessPromoteReq, HarnessPromoteRes,
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
  /** Branches on project kind: ssh:// → run the engine on the remote; local → GenerateService. */
  generateProject: (req: GenerateProjectReq) => Promise<GenerateProjectRes>
  harness: HarnessService
  harnessRun: (req: HarnessRunReq) => Promise<HarnessRunRes>
  harnessGetRun: (req: HarnessGetRunReq) => HarnessGetRunRes
  harnessPromote: (req: HarnessPromoteReq) => HarnessPromoteRes
  dashboard: typeof getProjectDashboard
}

let _idCounter = 0
function nextId(): string {
  return `auto-${Date.now()}-${++_idCounter}`
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
  const generateProject = (req: GenerateProjectReq): Promise<GenerateProjectRes> => {
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
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => harness.run(req)
  const harnessGetRun = (req: HarnessGetRunReq): HarnessGetRunRes => harness.show(req)
  const harnessPromote = (req: HarnessPromoteReq): HarnessPromoteRes => harness.promote(req)

  return {
    db, registry, tasks, runs, reviews, cursors, searchIndex, vault, taskProfiles,
    ingest, ingestAdapters, runService, generate, generateProject,
    harness, harnessRun, harnessGetRun, harnessPromote, dashboard: getProjectDashboard,
  }
}
