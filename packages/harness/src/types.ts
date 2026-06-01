import type { AgentProfile } from '@apc/shared'

export interface AgentConfigAdapter {
  readonly provider: 'claude' | 'codex' | 'opencode'
  /** Read-only. Returns normalized profiles found in global + project scope. Never reads credential files. */
  discoverProfiles(opts: { projectPath?: string }): Promise<AgentProfile[]>
}
