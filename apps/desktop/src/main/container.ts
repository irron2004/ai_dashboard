import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, ProjectRegistry, IngestCursorStore } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore, ReviewService } from '@apc/pm'
import { migrateHarness, TaskProfileStore } from '@apc/harness'
import { SearchIndex } from '@apc/search'
import { VaultAdapter } from '@apc/vault'
import { getProjectDashboard } from '@apc/dashboard-api'

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
  dashboard: typeof getProjectDashboard
}

let _idCounter = 0
function nextId(): string {
  return `auto-${Date.now()}-${++_idCounter}`
}

export function buildContainer(opts: { dbFile: string; vaultRoot: string }): Container {
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

  return { db, registry, tasks, runs, reviews, cursors, searchIndex, vault, taskProfiles, dashboard: getProjectDashboard }
}
