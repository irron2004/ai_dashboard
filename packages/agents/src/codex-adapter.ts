import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AgentSourceSchema, NormalizedSessionSchema, type AgentSource, type NormalizedSession, type NormalizedTurn, type SourceCursor } from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'

function walkJsonl(dir: string): string[] {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkJsonl(abs))
    else if (e.name.endsWith('.jsonl')) out.push(abs)
  }
  return out
}

export class CodexAdapter implements AgentIngestAdapter {
  readonly agentKind = 'codex' as const
  constructor(private readonly sessionsDir: string = join(homedir(), '.codex', 'sessions')) {}

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    const out: AgentSource[] = []
    for (const locator of walkJsonl(this.sessionsDir)) {
      const st = statSync(locator)
      const id = `codex:${locator}`
      const cur = cursorFor(id)
      if (cur) {
        const pos = JSON.parse(cur.position) as { sizeBytes?: number; mtimeMs?: number }
        if (pos.sizeBytes === st.size && pos.mtimeMs === Math.floor(st.mtimeMs)) continue
      }
      out.push(AgentSourceSchema.parse({
        id, agentKind: 'codex', kind: 'jsonl-file', locator,
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

    for (const line of lines) {
      let obj: any
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.timestamp) { if (!startedAt) startedAt = obj.timestamp; endedAt = obj.timestamp }
      if (obj.type === 'session_meta') {
        id = obj.payload?.id ?? id
        repoPath = obj.payload?.cwd ?? repoPath
        branch = obj.payload?.git?.branch ?? branch
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
      transcriptPath: source.locator, turns, filesTouched: [],
    })
    return { session, position: JSON.stringify({ sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs }) }
  }
}
