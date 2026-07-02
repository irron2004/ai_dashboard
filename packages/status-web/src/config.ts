import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type StatusConfig = {
  db: string
  vault: string
  token: string
  tokenGenerated: boolean
  host: string
  port: number
}

/** Electron `appData` root per platform (userData = appData + appName). */
function appData(): string {
  if (process.platform === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
}

// Electron app.getName() === apps/desktop package.json "name" === "@apc/desktop".
const APP_NAME_SEGMENTS = ['@apc', 'desktop']
function userData(): string { return join(appData(), ...APP_NAME_SEGMENTS) }

/** Best-effort default mirroring apps/desktop/src/main/index.ts. --db overrides; cli.ts errors if missing. */
export function defaultDbPath(): string { return join(userData(), 'apc.db') }
export function defaultVaultPath(): string { return join(userData(), 'vault') }

/** Parse `--key value` pairs; a `--key` with no following value is dropped. */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) continue
    out[key] = next
    i++
  }
  return out
}

export function resolveConfig(argv: string[], env: NodeJS.ProcessEnv): StatusConfig {
  const a = parseArgs(argv)
  const explicitToken = a.token ?? env.APC_STATUS_TOKEN
  const token = explicitToken ?? randomBytes(24).toString('base64url')
  return {
    db: a.db ?? defaultDbPath(),
    vault: a.vault ?? defaultVaultPath(), // reserved for future vault-backed endpoints; unused today
    token,
    tokenGenerated: explicitToken === undefined,
    host: a.host ?? '127.0.0.1',
    port: a.port ? Number(a.port) : 4319,
  }
}
