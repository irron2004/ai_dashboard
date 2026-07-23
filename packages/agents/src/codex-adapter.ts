import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentSourceSchema, NormalizedSessionSchema, SourceMetaSchema, type AgentSource, type NormalizedSession, type NormalizedTurn, type SourceCursor } from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'
import { cachedSourceMetadata, folderPathFor, readFilePrefix, walkFiles } from './source-discovery.js'

function discoverRepoPath(locator: string, signature: { size: number; mtimeMs: number }): string | undefined {
  return cachedSourceMetadata('codex-repo-path', locator, signature, () => {
    for (const line of readFilePrefix(locator).split('\n')) {
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line) as { type?: string; payload?: { cwd?: unknown } }
        if (item.type === 'session_meta' && typeof item.payload?.cwd === 'string') return item.payload.cwd
      } catch {
        // A prefix can end in the middle of a later JSONL row; the session_meta row is normally first.
      }
    }
    return undefined
  })
}

export class CodexAdapter implements AgentIngestAdapter {
  readonly agentKind = 'codex' as const
  constructor(private readonly sessionsDir: string | readonly string[] = join(homedir(), '.codex', 'sessions')) {}

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    const out: AgentSource[] = []
    const discoveredAt = new Date().toISOString()
    for (const locator of walkFiles(this.sessionsDir, (path) => path.endsWith('.jsonl'))) {
      const st = statSync(locator)
      const id = `codex:${locator}`
      const cur = cursorFor(id)
      if (cur) {
        try {
          const pos = JSON.parse(cur.position) as { sizeBytes?: number; mtimeMs?: number }
          if (pos.sizeBytes === st.size && pos.mtimeMs === Math.floor(st.mtimeMs)) continue
        } catch {
          // corrupted cursor — treat as changed so it will be re-ingested
        }
      }
      out.push(AgentSourceSchema.parse({
        id, agentKind: 'codex', kind: 'jsonl-file', locator,
        sourceDirPath: folderPathFor(locator),
        repoPath: discoverRepoPath(locator, { size: st.size, mtimeMs: st.mtimeMs }),
        discoveredAt,
        mtimeMs: Math.floor(st.mtimeMs), sizeBytes: st.size,
      }))
    }
    return out
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const lines = readFileSync(source.locator, 'utf8').split('\n').filter((l) => l.trim())
    const turns: NormalizedTurn[] = []
    let id: string | undefined
    let repoPath: string | undefined
    let branch: string | undefined
    let startedAt: string | undefined
    let endedAt: string | undefined
    let sessionMeta: Record<string, unknown> | undefined

    for (const line of lines) {
      let obj: any
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.timestamp) { if (!startedAt) startedAt = obj.timestamp; endedAt = obj.timestamp }
      if (obj.type === 'session_meta') {
        id = obj.payload?.id ?? id
        repoPath = obj.payload?.cwd ?? repoPath
        branch = obj.payload?.git?.branch ?? branch
        sessionMeta = obj.payload && typeof obj.payload === 'object' ? obj.payload as Record<string, unknown> : sessionMeta
      } else if (obj.type === 'response_item' && obj.payload?.type === 'message') {
        const role = obj.payload.role === 'assistant' ? 'assistant'
          : obj.payload.role === 'user' ? 'user' : 'system'
        const text = (obj.payload.content ?? [])
          .map((c: any) => (typeof c.text === 'string' ? c.text : '')).join('\n')
        turns.push({ role, text: redact(text), timestamp: obj.timestamp, toolCalls: [] })
      }
    }

    const session = NormalizedSessionSchema.parse({
      id: id ?? source.locator, agentType: 'codex', repoPath, branch, startedAt, endedAt,
      sourceDirPath: source.sourceDirPath ?? dirname(source.locator),
      sourceMeta: SourceMetaSchema.parse({
        provider: 'codex',
        sourceKind: 'jsonl-file',
        rawLocator: source.locator,
        sourceDirPath: source.sourceDirPath ?? dirname(source.locator),
        discoveredAt: source.discoveredAt,
        sessionHeader: {
          sessionId: id ?? source.locator,
          sessionMeta,
          transcriptPath: source.locator,
        },
      }),
      transcriptPath: source.locator, turns, filesTouched: [],
    })
    return { session, position: JSON.stringify({ sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs }) }
  }
}
