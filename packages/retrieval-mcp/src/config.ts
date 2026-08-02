import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type RetrievalMcpConfig = {
  workspaceRoot: string
  manifestPath: string
  dbPath: string
}

function defaultCacheRoot(env: NodeJS.ProcessEnv): string {
  if (process.platform === 'win32') {
    return env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  }
  return env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
}

function defaultDbPath(workspaceRoot: string, env: NodeJS.ProcessEnv): string {
  const workspaceKey = createHash('sha256').update(workspaceRoot, 'utf8').digest('hex').slice(0, 16)
  return join(defaultCacheRoot(env), 'apc', 'workspace-retrieval', workspaceKey, 'index.sqlite')
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') continue
    if (!arg.startsWith('--')) continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`missing value for ${arg}`)
    }
    parsed.set(arg.slice(2), value)
    index++
  }
  return parsed
}

export function resolveRetrievalMcpConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): RetrievalMcpConfig {
  const args = parseArgs(argv)
  const workspaceRoot = resolve(args.get('workspace-root') ?? env.APC_WORKSPACE_ROOT ?? cwd)
  const manifestPath = resolve(
    args.get('manifest') ?? env.APC_WORKSPACE_MANIFEST ?? resolve(workspaceRoot, 'workspace.projects.yml'),
  )
  const dbPath = resolve(
    args.get('db') ?? env.APC_RETRIEVAL_DB ?? defaultDbPath(workspaceRoot, env),
  )
  return { workspaceRoot, manifestPath, dbPath }
}
