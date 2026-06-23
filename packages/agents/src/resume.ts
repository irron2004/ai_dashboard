// packages/agents/src/resume.ts
import type { AgentKind } from '@apc/shared'
import type { AgentIngestAdapter } from './types.js'
import { ClaudeAdapter } from './claude-adapter.js'
import { CodexAdapter } from './codex-adapter.js'
import { OpenCodeAdapter } from './opencode-adapter.js'

export type ResumeOpts = { sessionId?: string }
export type LaunchSpec = { command: string; args: string[] }

/**
 * CLI별 resume 명령 매핑. sessionId가 있으면 특정 세션, 없으면 "가장 최근" 세션.
 * NOTE: 플래그는 각 CLI `--help`로 검증됨(2026-06). 변경 시 여기만 고친다.
 */
export function resumeCommand(agent: AgentKind, opts: ResumeOpts): LaunchSpec {
  const id = opts.sessionId
  switch (agent) {
    case 'claude':
      return { command: 'claude', args: id ? ['--resume', id] : ['--continue'] }
    case 'codex':
      return { command: 'codex', args: id ? ['resume', id] : ['resume', '--last'] }
    case 'opencode':
      return { command: 'opencode', args: id ? ['--session', id] : ['--continue'] }
    default:
      return { command: agent, args: [] }
  }
}

export function adapterFor(agent: AgentKind): AgentIngestAdapter {
  switch (agent) {
    case 'claude': return new ClaudeAdapter()
    case 'codex': return new CodexAdapter()
    case 'opencode': return new OpenCodeAdapter()
    default: throw new Error(`no adapter for agent: ${agent}`)
  }
}

const _t = (s?: string) => (s ? Date.parse(s) : 0)

/** repoPath와 일치하는 세션 중 가장 최근(endedAt||startedAt) 1건의 sessionId를 돌려준다. */
export async function findLatestSession(
  adapter: AgentIngestAdapter,
  repoPath: string,
): Promise<{ sessionId: string; startedAt?: string } | null> {
  const sources = await adapter.discoverSources(() => undefined)
  let best: { sessionId: string; startedAt?: string; rank: number } | null = null
  for (const source of sources) {
    // 빠른 경로: source.repoPath가 이미 채워져 있으면 parse 생략 가능하지만,
    // sessionId는 parse가 필요하므로 매칭 후보만 parse한다.
    if (source.repoPath && source.repoPath !== repoPath) continue
    const { session } = await adapter.parseSource(source)
    if (session.repoPath !== repoPath) continue
    const rank = Math.max(_t(session.endedAt), _t(session.startedAt), source.mtimeMs ?? 0)
    if (!best || rank > best.rank) best = { sessionId: session.id, startedAt: session.startedAt, rank }
  }
  return best ? { sessionId: best.sessionId, startedAt: best.startedAt } : null
}
