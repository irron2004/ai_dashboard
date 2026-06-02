import { AgentKind, type AgentType } from '@apc/shared'

export type ParsedArgs =
  | { cmd: 'run'; projectId: string; engine: AgentType }
  | { cmd: 'show'; runId: string }
  | { cmd: 'promote'; runId: string; allowSecrets: boolean }
  | { cmd: 'help' }
  | { cmd: 'error'; message: string }

const USAGE = `knowledge-harness — evidence-based wiki pipeline
  run --project <id> --engine <claude|codex|opencode>
  show <runId>
  promote <runId> [--allow-secrets]`

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

/** Pure argv parser. Never throws — invalid input returns a `{ cmd: 'error' }`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'run': {
      const projectId = flag(rest, 'project')
      if (!projectId) return { cmd: 'error', message: 'run requires --project <id>' }
      const engine = AgentKind.safeParse(flag(rest, 'engine'))
      if (!engine.success) return { cmd: 'error', message: `run requires --engine <${AgentKind.options.join('|')}>` }
      return { cmd: 'run', projectId, engine: engine.data }
    }
    case 'show':
      return rest[0] ? { cmd: 'show', runId: rest[0] } : { cmd: 'error', message: 'show requires <runId>' }
    case 'promote': {
      const runId = rest.find(a => !a.startsWith('--'))
      return runId ? { cmd: 'promote', runId, allowSecrets: rest.includes('--allow-secrets') } : { cmd: 'error', message: 'promote requires <runId>' }
    }
    case 'help': case '--help': case '-h': case undefined:
      return { cmd: 'help' }
    default:
      return { cmd: 'error', message: `unknown command: ${cmd}` }
  }
}

/** A structural port over HarnessService — kept minimal so the dispatcher is testable with a fake. */
export type HarnessCliPort = {
  run(input: { projectId: string; engine: AgentType }): Promise<{ ok: boolean; runId?: string; finalState?: string; reason?: string }>
  show(input: { runId: string }): { ok: boolean; runState?: unknown; reason?: string }
  promote(input: { runId: string; allowSecrets?: boolean }): { ok: boolean; promoted?: string[]; proposals?: string[]; reason?: string }
}

/** Dispatch a parsed command to the port, printing via `out`. Returns a process exit code. */
export async function runCli(argv: string[], port: HarnessCliPort, out: (line: string) => void): Promise<number> {
  const args = parseArgs(argv)
  switch (args.cmd) {
    case 'help':
      out(USAGE); return 0
    case 'error':
      out(`error: ${args.message}`); out(USAGE); return 2
    case 'run': {
      const r = await port.run({ projectId: args.projectId, engine: args.engine })
      if (!r.ok) { out(`run failed: ${r.reason ?? 'unknown'}`); return 1 }
      out(`run ${r.runId} → ${r.finalState}`); return 0
    }
    case 'show': {
      const r = port.show({ runId: args.runId })
      if (!r.ok) { out(`error: ${r.reason}`); return 1 }
      out(JSON.stringify(r.runState, null, 2)); return 0
    }
    case 'promote': {
      const r = port.promote({ runId: args.runId, allowSecrets: args.allowSecrets })
      if (!r.ok) { out(`promote failed: ${r.reason}`); return 1 }
      out(`promoted ${r.promoted?.length ?? 0} file(s), ${r.proposals?.length ?? 0} proposal(s)`); return 0
    }
  }
}
