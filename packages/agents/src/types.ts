import type { AgentKind, AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'

export interface AgentIngestAdapter {
  readonly agentKind: AgentKind
  /** List sources whose data changed since their cursor. `cursorFor` returns the last saved cursor (or undefined). */
  discoverSources(cursorFor: (sourceId: string) => SourceCursor | undefined): Promise<AgentSource[]>
  /** Parse one source into a normalized session. Returns the session and the new cursor position string. */
  parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }>
}
