// packages/agents/src/resume.ts
import type { AgentKind } from '@apc/shared'

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
