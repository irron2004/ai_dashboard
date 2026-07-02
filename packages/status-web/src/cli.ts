import { existsSync } from 'node:fs'
import { ProjectRegistry } from '@apc/core'
import { TaskStore, AgentRunStore } from '@apc/pm'
import { buildWorkspaceOverview, type WorkspaceOverview } from '@apc/dashboard-api'
import { resolveConfig, type StatusConfig } from './config.js'
import { openReadOnlyDb } from './read-only-db.js'
import { createStatusServer } from './server.js'

type Stores = { registry: ProjectRegistry; tasks: TaskStore; runs: AgentRunStore }

/** Closure the server calls per (uncached) request. Isolated so it can be unit-tested with an in-memory DB. */
export function makeBuildOverview(stores: Stores): () => WorkspaceOverview {
  return () => buildWorkspaceOverview(stores)
}

export function describeMissingDb(dbPath: string): string {
  return [
    `[status-web] sqlite file not found: ${dbPath}`,
    `The status server reads the desktop's DB read-only but cannot resolve Electron's userData path itself.`,
    `Find the desktop's apc.db (it sits next to the desktop 'vault' folder under the app's userData dir) and pass it:`,
    `  pnpm status-web --db /absolute/path/to/apc.db`,
  ].join('\n')
}

function printStartup(cfg: StatusConfig): void {
  const url = `http://${cfg.host}:${cfg.port}`
  console.log(`[status-web] serving read-only overview at ${url}`)
  console.log(`[status-web] db: ${cfg.db}`)
  if (cfg.tokenGenerated) console.log(`[status-web] generated token (pass via ?/prompt): ${cfg.token}`)
  else console.log(`[status-web] token: (from --token / APC_STATUS_TOKEN)`)
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    console.log(`[status-web] WARNING: bound to ${cfg.host} — reachable on the LAN. Token auth is the only guard.`)
  }
  console.log(`[status-web] open ${url}/ on your phone (same network) and paste the token when prompted.`)
}

export function main(argv: string[], env: NodeJS.ProcessEnv): void {
  const cfg = resolveConfig(argv, env)
  if (!existsSync(cfg.db)) { console.error(describeMissingDb(cfg.db)); process.exit(1) }
  const db = openReadOnlyDb(cfg.db)
  const stores: Stores = { registry: new ProjectRegistry(db), tasks: new TaskStore(db), runs: new AgentRunStore(db) }
  const server = createStatusServer({ buildOverview: makeBuildOverview(stores), token: cfg.token })
  server.listen(cfg.port, cfg.host, () => printStartup(cfg))
}

